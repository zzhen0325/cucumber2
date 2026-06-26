import type { RunStreamEvent } from "@openai/agents";

import type {
  CucumberAgentContext,
  CucumberRunEvent,
  CucumberTextDeltaSource,
  PendingCucumberEvent,
} from "../context.ts";
import { getAgentErrorMessage } from "../errors.ts";

type StreamWithCompletion = AsyncIterable<RunStreamEvent> & {
  completed?: Promise<unknown>;
  finalOutput?: unknown;
};

type TextDelta = {
  normalized: boolean;
  source: CucumberTextDeltaSource;
  text: string;
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
  const recentlyNormalizedOutputTextDeltas: string[] = [];

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
            if (isDuplicateRawOutputTextDelta(delta)) {
              continue;
            }
            if (delta.normalized && delta.source === "output_text") {
              rememberNormalizedOutputTextDelta(delta.text);
            }
            push(
              delta.source === "output_text"
                ? { type: "text_delta", text: delta.text }
                : { type: "text_delta", text: delta.text, source: delta.source }
            );
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
      const message = getAgentErrorMessage(error);
      for (const pending of drainPendingEvents(context)) {
        push(pending);
      }
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

  function rememberNormalizedOutputTextDelta(text: string) {
    recentlyNormalizedOutputTextDeltas.push(text);
    if (recentlyNormalizedOutputTextDeltas.length > 24) {
      recentlyNormalizedOutputTextDeltas.shift();
    }
  }

  function isDuplicateRawOutputTextDelta(delta: TextDelta) {
    if (delta.normalized || delta.source !== "output_text") {
      return false;
    }
    const index = recentlyNormalizedOutputTextDeltas.indexOf(delta.text);
    if (index < 0) {
      return false;
    }
    recentlyNormalizedOutputTextDeltas.splice(index, 1);
    return true;
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

function readTextDelta(
  data: unknown
): TextDelta | null {
  if (!isRecord(data)) {
    return null;
  }

  if (data.type === "output_text_delta") {
    const text = readDeltaText(data.delta);
    return text
      ? { normalized: true, source: "output_text", text }
      : null;
  }

  const chatText = readChatCompletionsTextDelta(data);
  if (chatText) {
    return { normalized: false, source: "output_text", text: chatText };
  }

  const rawEvent = isRecord(data.event) ? data.event : data;
  const type = readString(rawEvent.type);
  if (type === "response.output_text.delta") {
    const text = readDeltaText(rawEvent.delta);
    return text
      ? { normalized: false, source: "output_text", text }
      : null;
  }

  if (
    type === "response.reasoning_summary_text.delta" ||
    type === "response.reasoning_summary.delta"
  ) {
    const text = readDeltaText(rawEvent.delta);
    return text
      ? { normalized: false, source: "reasoning_summary", text }
      : null;
  }

  if (type === "response.refusal.delta") {
    const text = readDeltaText(rawEvent.delta);
    return text
      ? { normalized: false, source: "refusal", text }
      : null;
  }

  return null;
}

function readChatCompletionsTextDelta(data: Record<string, unknown>) {
  const event = isRecord(data.event) ? data.event : data;
  const choices = readArray(event.choices);
  for (const choice of choices) {
    const delta = isRecord(choice) ? choice.delta : undefined;
    if (!isRecord(delta)) {
      continue;
    }
    const content = delta.content;
    if (typeof content === "string" && content) {
      return content;
    }
    const contentParts = readArray(content);
    const text = contentParts
      .flatMap((part) => {
        const record = isRecord(part) ? part : null;
        const value = record?.text ?? record?.content;
        return typeof value === "string" ? [value] : [];
      })
      .join("");
    if (text) {
      return text;
    }
  }
  return null;
}

function readDeltaText(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value)) {
    return readString(value.text) ?? readString(value.content);
  }
  return null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readToolName(item: unknown) {
  const rawItem = readRawItem(item);
  if (typeof rawItem?.name === "string") {
    return rawItem.name;
  }
  if (rawItem?.type === "web_search_call") {
    return "web_search";
  }
  if (isRecord(rawItem?.rawItem) && typeof rawItem.rawItem.name === "string") {
    return rawItem.rawItem.name;
  }
  if (isRecord(rawItem?.rawItem) && rawItem.rawItem.type === "web_search_call") {
    return "web_search";
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
  if (typeof rawItem?.id === "string") {
    return rawItem.id;
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
  if (isRecord(rawItem?.action)) {
    return rawItem.action;
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

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
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
