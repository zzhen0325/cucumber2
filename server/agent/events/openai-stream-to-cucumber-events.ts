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
        if (event.type === "raw_model_stream_event") {
          const delta = readTextDelta(event.data);
          if (delta) {
            push({ type: "text_delta", text: delta });
          }
          continue;
        }

        if (event.type === "run_item_stream_event") {
          if (event.name === "tool_called") {
            push({
              type: "tool_started",
              toolCallId: readToolCallId(event.item),
              toolName: readToolName(event.item) ?? "unknown_tool",
              input: readToolInput(event.item),
            });
          }

          if (event.name === "tool_output") {
            push({
              type: "tool_completed",
              toolCallId: readToolCallId(event.item),
              toolName: readToolName(event.item) ?? "unknown_tool",
              output: readToolOutput(event.item),
            });
            for (const pending of drainPendingEvents(context)) {
              push(pending);
            }
          }
        }
      }

      for (const pending of drainPendingEvents(context)) {
        push(pending);
      }
      if (stream.completed) {
        await stream.completed;
      }
      push({ type: "run_completed", finalOutput: stringifyFinalOutput(stream.finalOutput) });
    } catch (error) {
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
