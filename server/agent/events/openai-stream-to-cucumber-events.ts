import type { RunStreamEvent } from "@openai/agents";

import type { CucumberAgentContext, CucumberRunEvent, PendingCucumberEvent } from "../context.ts";

type StreamWithCompletion = AsyncIterable<RunStreamEvent> & {
  completed?: Promise<unknown>;
  finalOutput?: unknown;
};

export async function* openAIStreamToCucumberEvents(
  stream: StreamWithCompletion,
  context: CucumberAgentContext
): AsyncIterable<CucumberRunEvent> {
  // Merge two producers into one ordered queue:
  //   1. the SDK run stream (text deltas, tool lifecycle, final output)
  //   2. live tool events pushed via `context.pushLiveEvent` while a tool is
  //      still running (e.g. each Seedream image the moment it finishes).
  // Without this merge the SDK `for await` loop is suspended inside the tool's
  // `await`, so per-image events could not surface until the tool returned.
  const queue: CucumberRunEvent[] = [];
  let notify: (() => void) | null = null;
  let finished = false;
  let streamError: unknown = null;
  const activeTools = new Map<string, { toolName: string; input?: unknown }>();

  const wake = () => {
    if (notify) {
      const resolve = notify;
      notify = null;
      resolve();
    }
  };
  const push = (event: CucumberRunEvent) => {
    queue.push(event);
    wake();
  };

  context.pushLiveEvent = (event) => push(event);

  const pump = (async () => {
    try {
      for await (const event of stream) {
        if (event.type === "agent_updated_stream_event") {
          const agentName = readAgentName(event.agent);
          if (agentName) {
            push({ type: "agent_active", agentName });
          }
          continue;
        }

        if (event.type === "raw_model_stream_event") {
          const delta = readTextDelta(event.data);
          if (delta) {
            push({ type: "text_delta", text: delta });
          }
          continue;
        }

        if (event.type === "run_item_stream_event") {
          if (event.name === "tool_called") {
            const toolCallId = readToolCallId(event.item) ?? crypto.randomUUID();
            const toolName = readToolName(event.item) ?? "unknown_tool";
            const input = readToolInput(event.item);
            activeTools.set(toolCallId, { toolName, input });
            push({
              type: "tool_started",
              toolCallId,
              toolName,
              input,
            });
          }

          if (event.name === "tool_output") {
            const toolCallId = readToolCallId(event.item);
            const activeTool = toolCallId ? activeTools.get(toolCallId) : undefined;
            if (toolCallId) {
              activeTools.delete(toolCallId);
            }
            push({
              type: "tool_completed",
              toolCallId,
              toolName: readToolName(event.item) ?? activeTool?.toolName ?? "unknown_tool",
              output: readToolOutput(event.item),
            });
            for (const pending of drainPendingEvents(context)) {
              push(pending);
            }
          }

          if (event.name === "handoff_requested") {
            push({
              type: "handoff_requested",
              fromAgent: readAgentName(readRecordValue(event.item, "sourceAgent")),
              toAgent: readAgentName(readRecordValue(event.item, "targetAgent")),
            });
          }

          if (event.name === "handoff_occurred") {
            push({
              type: "handoff_completed",
              fromAgent: readAgentName(readRecordValue(event.item, "sourceAgent")),
              toAgent: readAgentName(readRecordValue(event.item, "targetAgent")),
            });
          }
        }
      }

      for (const pending of drainPendingEvents(context)) {
        push(pending);
      }
      if (stream.completed) {
        await stream.completed;
      }
      context.signal?.throwIfAborted();
      push({
        type: "run_completed",
        artifactIds: context.producedArtifacts.map((artifact) => artifact.id),
        finalOutput: stringifyFinalOutput(stream.finalOutput),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const [toolCallId, tool] of activeTools) {
        push({
          type: "tool_failed",
          toolCallId,
          toolName: tool.toolName,
          input: tool.input,
          message,
        });
      }
      streamError = error;
    } finally {
      finished = true;
      context.pushLiveEvent = undefined;
      wake();
    }
  })();

  while (true) {
    while (queue.length) {
      yield queue.shift() as CucumberRunEvent;
    }
    if (finished) {
      break;
    }
    await new Promise<void>((resolve) => {
      notify = resolve;
    });
  }

  await pump;
  if (streamError) {
    throw streamError;
  }
}

function* drainPendingEvents(context: CucumberAgentContext): Iterable<PendingCucumberEvent> {
  while (context.pendingEvents.length) {
    const event = context.pendingEvents.shift();
    if (event) {
      yield event;
    }
  }
}

function readTextDelta(data: unknown) {
  if (!isRecord(data) || data.type !== "response.output_text.delta") {
    return null;
  }
  return typeof data.delta === "string" ? data.delta : null;
}

function readToolName(item: unknown) {
  const rawItem = readRawItem(item);
  if (typeof rawItem?.name === "string") {
    return rawItem.name;
  }
  if (isRecord(rawItem?.rawItem) && typeof rawItem.rawItem.name === "string") {
    return rawItem.rawItem.name;
  }
  return null;
}

function readToolCallId(item: unknown) {
  const rawItem = readRawItem(item);
  if (typeof rawItem?.callId === "string") {
    return rawItem.callId;
  }
  if (typeof rawItem?.call_id === "string") {
    return rawItem.call_id;
  }
  return undefined;
}

function readToolInput(item: unknown) {
  const rawItem = readRawItem(item);
  if (typeof rawItem?.arguments === "string") {
    try {
      return JSON.parse(rawItem.arguments);
    } catch {
      return rawItem.arguments;
    }
  }
  return undefined;
}

function readToolOutput(item: unknown) {
  if (isRecord(item) && "output" in item) {
    return item.output;
  }
  const rawItem = readRawItem(item);
  if (rawItem && "output" in rawItem) {
    return rawItem.output;
  }
  return undefined;
}

function readRawItem(item: unknown): Record<string, unknown> | null {
  if (!isRecord(item)) {
    return null;
  }
  if (isRecord(item.rawItem)) {
    return item.rawItem;
  }
  return item;
}

function readAgentName(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }
  return typeof value.name === "string" ? value.name : undefined;
}

function readRecordValue(value: unknown, key: string) {
  if (!isRecord(value)) {
    return undefined;
  }
  if (key in value) {
    return value[key];
  }
  const rawItem = readRawItem(value);
  return rawItem?.[key];
}

function stringifyFinalOutput(output: unknown) {
  if (typeof output === "string") {
    return output;
  }
  if (output === undefined || output === null) {
    return undefined;
  }
  return JSON.stringify(output);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
