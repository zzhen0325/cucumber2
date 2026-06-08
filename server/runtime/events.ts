import type { UIMessage, UIMessageStreamWriter } from "ai";

import { recordRunStepEvent } from "../supabase.ts";
import type { RuntimeEvent } from "../../src/types/runtime.ts";
import { runtimeEventSchema } from "./schemas.ts";

export type RuntimeEventWriter = {
  writeEvent: (event: Omit<RuntimeEvent, "createdAt"> & { createdAt?: string }) => Promise<RuntimeEvent>;
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
    durationMs?: number;
    logs?: unknown[];
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
    errorDetails?: Record<string, unknown>;
    durationMs?: number;
    logs?: unknown[];
    metadata?: Record<string, string>;
  }) => Promise<void>;
};

export function createRuntimeEventWriter({
  projectId,
  runNodeId,
  writer,
}: {
  projectId: string;
  runNodeId: string;
  writer: UIMessageStreamWriter<UIMessage>;
}): RuntimeEventWriter {
  return {
    async writeEvent(input) {
      const event = runtimeEventSchema.parse({
        ...input,
        projectId: input.projectId ?? projectId,
        runNodeId: input.runNodeId ?? runNodeId,
        createdAt: input.createdAt ?? new Date().toISOString(),
      });

      await recordRunStepEvent({
        projectId: event.projectId,
        runNodeId: event.runNodeId,
        stepId: event.stepId,
        type: event.type,
        payload: event.payload,
        errorText: event.errorText,
        createdAt: event.createdAt,
      });

      writer.write({
        type: "data-runtime-event",
        id: event.id ?? `${event.runNodeId}-${event.stepId}-${event.type}-${event.createdAt}`,
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
          durationMs: input.durationMs,
          logs: input.logs,
          metadata: input.metadata,
        },
      });
    },

    async writeToolError(input) {
      if (input.inputWritten) {
        writer.write({
          type: "tool-output-error",
          toolCallId: input.toolCallId,
          errorText: input.errorText,
        });
      } else {
        writer.write({
          type: "tool-input-error",
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          input: input.input,
          errorText: input.errorText,
        });
      }

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
          errorDetails: input.errorDetails,
          durationMs: input.durationMs,
          logs: input.logs,
          failedStepId: input.stepId,
          metadata: input.metadata,
        },
        errorText: input.errorText,
      });
    },
  };
}
