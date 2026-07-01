import type { UIMessage, UIMessageStreamWriter } from "ai";

import type { AgentEvent } from "../../../src/types/runtime.ts";
import { recordAgentEvent } from "../../supabase.ts";
import { redactToolTraceValue } from "../trace-redaction.ts";
import { getToolTraceMetadata } from "../tool-registry.ts";

export type AgentEventWriter = {
  flush: () => Promise<void>;
  writeEvent: (event: Omit<AgentEvent, "createdAt"> & { createdAt?: string }) => Promise<AgentEvent>;
  writeToolInput: (input: {
    stepId: string;
    toolCallId: string;
    toolName: string;
    toolInput: unknown;
    metadata?: Record<string, string>;
  }) => Promise<AgentEvent>;
  writeToolOutput: (input: {
    durationMs?: number;
    stepId: string;
    toolCallId: string;
    toolName: string;
    output: unknown;
    metadata?: Record<string, string>;
  }) => Promise<AgentEvent>;
  writeToolError: (input: {
    durationMs?: number;
    stepId: string;
    toolCallId: string;
    toolName: string;
    input?: unknown;
    inputWritten?: boolean;
    errorText: string;
    errorCode?: string;
    metadata?: Record<string, string>;
  }) => Promise<AgentEvent>;
};

export function createAgentEventWriter({
  projectId,
  runNodeId,
  writer,
}: {
  projectId: string;
  runNodeId: string;
  writer: UIMessageStreamWriter<UIMessage>;
}): AgentEventWriter {
  const pendingPersistence: Promise<void>[] = [];
  const persistenceErrors: unknown[] = [];
  let persistenceChain = Promise.resolve();

  const queuePersistence = (event: AgentEvent) => {
    persistenceChain = persistenceChain
      .then(() => recordAgentEvent(event))
      .catch((error: unknown) => {
        persistenceErrors.push(error);
      });
    pendingPersistence.push(persistenceChain);
  };

  return {
    async flush() {
      await Promise.all(pendingPersistence);
      if (persistenceErrors.length) {
        throw persistenceErrors[0];
      }
    },

    async writeEvent(input) {
      const event: AgentEvent = {
        ...input,
        projectId: input.projectId || projectId,
        runNodeId: input.runNodeId || runNodeId,
        createdAt: input.createdAt ?? new Date().toISOString(),
      };

      safeWrite(writer, {
        type: "data-runtime-event",
        id: getAgentEventStreamId(event),
        data: event,
        transient: false,
      });
      queuePersistence(event);
      return event;
    },

    async writeToolInput(input) {
      const redacted = redactToolTraceValue({
        direction: "input",
        toolName: input.toolName,
        value: input.toolInput,
      });
      const metadata = mergeMetadata(
        input.metadata,
        getToolTraceMetadata(input.toolName),
        redacted.metadata
      );
      safeWrite(writer, {
        type: "tool-input-available",
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        input: redacted.value,
        toolMetadata: metadata,
      });
      return this.writeEvent({
        projectId,
        runNodeId,
        stepId: input.stepId,
        type: "tool.input",
        payload: {
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          input: redacted.value,
          metadata,
          redaction: redacted.summary,
        },
      });
    },

    async writeToolOutput(input) {
      const redacted = redactToolTraceValue({
        direction: "output",
        toolName: input.toolName,
        value: input.output,
      });
      const metadata = mergeMetadata(
        input.metadata,
        getToolTraceMetadata(input.toolName),
        redacted.metadata
      );
      safeWrite(writer, {
        type: "tool-output-available",
        toolCallId: input.toolCallId,
        output: redacted.value,
      });
      return this.writeEvent({
        projectId,
        runNodeId,
        stepId: input.stepId,
        type: "tool.output",
        payload: {
          durationMs: input.durationMs,
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          output: redacted.value,
          metadata,
          redaction: redacted.summary,
        },
      });
    },

    async writeToolError(input) {
      const redactedInput = redactToolTraceValue({
        direction: "input",
        toolName: input.toolName,
        value: input.input,
      });
      const metadata = mergeMetadata(
        input.metadata,
        getToolTraceMetadata(input.toolName),
        redactedInput.metadata
      );
      safeWrite(
        writer,
        input.inputWritten
          ? {
              type: "tool-output-error",
              toolCallId: input.toolCallId,
              errorText: input.errorText,
            }
          : {
              type: "tool-input-error",
              toolCallId: input.toolCallId,
              toolName: input.toolName,
              input: redactedInput.value,
              errorText: input.errorText,
          }
      );
      return this.writeEvent({
        projectId,
        runNodeId,
        stepId: input.stepId,
        type: "tool.error",
        payload: {
          durationMs: input.durationMs,
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          input: redactedInput.value,
          errorText: input.errorText,
          errorCode: input.errorCode,
          metadata,
          redaction: redactedInput.summary,
        },
        errorText: input.errorText,
      });
    },
  };
}

function mergeMetadata(
  ...items: Array<Record<string, string> | undefined>
): Record<string, string> {
  return Object.assign({}, ...items.filter(Boolean));
}

function getAgentEventStreamId(event: AgentEvent) {
  return event.id ?? `${event.runNodeId}-${event.stepId}-${event.type}-${event.createdAt}`;
}

function safeWrite(
  writer: UIMessageStreamWriter<UIMessage>,
  part: Parameters<UIMessageStreamWriter<UIMessage>["write"]>[0]
) {
  try {
    writer.write(part);
  } catch {
    // A browser may leave the project while the run continues in-process.
    // Persistence remains the source of truth for later hydration.
  }
}
