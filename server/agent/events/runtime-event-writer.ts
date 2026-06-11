import type { UIMessage, UIMessageStreamWriter } from "ai";

import type { AgentEvent } from "../../../src/types/runtime.ts";
import { recordAgentEvent } from "../../supabase.ts";

export type AgentEventWriter = {
  writeEvent: (event: Omit<AgentEvent, "createdAt"> & { createdAt?: string }) => Promise<AgentEvent>;
  writeToolInput: (input: {
    stepId: string;
    toolCallId: string;
    toolName: string;
    toolInput: unknown;
    metadata?: Record<string, string>;
  }) => Promise<void>;
  writeToolOutput: (input: {
    stepId: string;
    toolCallId: string;
    toolName: string;
    output: unknown;
    metadata?: Record<string, string>;
  }) => Promise<void>;
  writeToolError: (input: {
    stepId: string;
    toolCallId: string;
    toolName: string;
    input?: unknown;
    inputWritten?: boolean;
    errorText: string;
    errorCode?: string;
    metadata?: Record<string, string>;
  }) => Promise<void>;
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
  return {
    async writeEvent(input) {
      const event: AgentEvent = {
        ...input,
        projectId: input.projectId || projectId,
        runNodeId: input.runNodeId || runNodeId,
        createdAt: input.createdAt ?? new Date().toISOString(),
      };

      await recordAgentEvent(event);
      writer.write({
        type: "data-runtime-event",
        id: getAgentEventStreamId(event),
        data: event,
        transient: false,
      });
      return event;
    },

    async writeToolInput(input) {
      writer.write({
        type: "tool-input-available",
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        input: input.toolInput,
        toolMetadata: input.metadata,
      });
      await this.writeEvent({
        projectId,
        runNodeId,
        stepId: input.stepId,
        type: "tool.input",
        payload: {
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          input: input.toolInput,
          metadata: input.metadata,
        },
      });
    },

    async writeToolOutput(input) {
      writer.write({
        type: "tool-output-available",
        toolCallId: input.toolCallId,
        output: input.output,
      });
      await this.writeEvent({
        projectId,
        runNodeId,
        stepId: input.stepId,
        type: "tool.output",
        payload: {
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          output: input.output,
          metadata: input.metadata,
        },
      });
    },

    async writeToolError(input) {
      writer.write(
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
              input: input.input,
              errorText: input.errorText,
            }
      );
      await this.writeEvent({
        projectId,
        runNodeId,
        stepId: input.stepId,
        type: "tool.error",
        payload: {
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          input: input.input,
          errorText: input.errorText,
          errorCode: input.errorCode,
          metadata: input.metadata,
        },
        errorText: input.errorText,
      });
    },
  };
}

function getAgentEventStreamId(event: AgentEvent) {
  return event.id ?? `${event.runNodeId}-${event.stepId}-${event.type}-${event.createdAt}`;
}
