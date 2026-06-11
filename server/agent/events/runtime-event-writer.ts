import type { UIMessage, UIMessageStreamWriter } from "ai";

import { recordRunStepEvent } from "../supabase.ts";
import type {
  ArtifactCreatedDataPart,
  CanvasOperationDataPart,
  RunStatusDataPart,
  RuntimeEvent,
  TracePointerDataPart,
} from "../../src/types/runtime.ts";
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
      const eventId = getRuntimeEventStreamId(event);

      writeRuntimeDataPart(writer, event, eventId);

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
        type: "data-trace-pointer",
        id: `trace-${eventId}`,
        data: {
          projectId: event.projectId,
          runNodeId: event.runNodeId,
          stepId: event.stepId,
          eventId: event.id,
          eventType: event.type,
          createdAt: event.createdAt,
        } satisfies TracePointerDataPart,
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

function writeRuntimeDataPart(
  writer: UIMessageStreamWriter<UIMessage>,
  event: RuntimeEvent,
  eventId: string
) {
  const specialized = runtimeEventToSpecializedPart(event);
  if (specialized) {
    writer.write({
      type: specialized.type,
      id: eventId,
      data: specialized.data,
      transient: false,
    });
    return;
  }

  if (event.type.startsWith("graph.patch.")) {
    return;
  }

  writer.write({
    type: "data-runtime-event",
    id: eventId,
    data: event,
    transient: false,
  });
}

function runtimeEventToSpecializedPart(event: RuntimeEvent):
  | { type: "data-artifact-created"; data: ArtifactCreatedDataPart }
  | { type: "data-canvas-operation"; data: CanvasOperationDataPart }
  | { type: "data-run-status"; data: RunStatusDataPart }
  | null {
  if (event.type === "artifact.created") {
    const artifact = event.payload.artifact;
    if (!isRecord(artifact)) {
      return null;
    }

    return {
      type: "data-artifact-created",
      data: {
        projectId: event.projectId,
        runNodeId: event.runNodeId,
        stepId: event.stepId,
        eventId: event.id,
        artifact: artifact as ArtifactCreatedDataPart["artifact"],
        canvasNodeId: readString(event.payload.canvasNodeId),
        toolCallId: readString(event.payload.toolCallId),
        toolName: readString(event.payload.toolName),
        createdAt: event.createdAt,
      },
    };
  }

  if (event.type.startsWith("canvas.operation.")) {
    const operation = event.payload.operation;
    if (!isRecord(operation)) {
      return null;
    }

    const status = event.type.endsWith(".applied")
      ? "applied"
      : event.type.endsWith(".rejected")
        ? "rejected"
        : "proposed";

    return {
      type: "data-canvas-operation",
      data: {
        projectId: event.projectId,
        runNodeId: event.runNodeId,
        stepId: event.stepId,
        eventId: event.id,
        eventType: event.type as CanvasOperationDataPart["eventType"],
        status,
        operation: operation as CanvasOperationDataPart["operation"],
        reason: readString(event.payload.reason),
        errorCode: readString(event.payload.errorCode),
        errorText: event.errorText ?? readString(event.payload.errorText),
        createdAt: event.createdAt,
      },
    };
  }

  if (
    event.type === "run.created" ||
    event.type === "run.completed" ||
    event.type === "run.failed"
  ) {
    return {
      type: "data-run-status",
      data: {
        projectId: event.projectId,
        runNodeId: event.runNodeId,
        stepId: event.stepId,
        eventId: event.id,
        eventType: event.type,
        status: readRunStatus(event),
        prompt: readString(event.payload.prompt),
        promptNodeId: readNullableString(event.payload.promptNodeId),
        selectedNodeId: readNullableString(event.payload.selectedNodeId),
        upstreamContext: Array.isArray(event.payload.upstreamContext)
          ? (event.payload.upstreamContext as RunStatusDataPart["upstreamContext"])
          : undefined,
        contextTrace: isRecord(event.payload.contextTrace)
          ? (event.payload.contextTrace as RunStatusDataPart["contextTrace"])
          : undefined,
        artifactIds: readStringArray(event.payload.artifactIds),
        evaluation: isRecord(event.payload.evaluation)
          ? (event.payload.evaluation as RunStatusDataPart["evaluation"])
          : undefined,
        runtime: readString(event.payload.runtime),
        errorCode: readString(event.payload.errorCode),
        errorText: event.errorText ?? readString(event.payload.errorText),
        failedStepId: readString(event.payload.failedStepId),
        createdAt: event.createdAt,
      },
    };
  }

  return null;
}

function getRuntimeEventStreamId(event: RuntimeEvent) {
  return (
    event.id ??
    `${event.runNodeId}-${event.stepId}-${event.type}-${event.createdAt}`
  );
}

function readRunStatus(event: RuntimeEvent): RunStatusDataPart["status"] {
  if (event.type === "run.created") {
    return "running";
  }

  if (event.type === "run.completed") {
    return "completed";
  }

  return "failed";
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNullableString(value: unknown) {
  return value === null || typeof value === "string" ? value : undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
