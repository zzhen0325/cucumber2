import {
  applyGraphPatch,
  applyGraphPatches,
  projectRunTraceToCanvas,
  type GraphPatch,
  type GraphProjectionState,
  type RejectedGraphPatch,
} from "./graph-projection";
import {
  extractHtmlPagesFromToolOutput,
  extractImagesFromToolOutput,
  extractMarkdownDocumentsFromToolOutput,
  toolPartsFromMessageParts,
} from "./graph";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  ArtifactRef,
} from "@/types/canvas";
import {
  runtimeEventTypes,
  type CanvasOperation,
  type RuntimeEvent,
} from "@/types/runtime";

export type CanvasProjectionState = GraphProjectionState & {
  runSummaries: Record<string, { status: string; eventCount: number }>;
  rejectedOperations: RejectedGraphPatch[];
};

export type RuntimeEventsFromMessagesOptions = {
  runNodeId?: string;
  projectId?: string;
  prompt?: string;
  promptNodeId?: string;
  selectedNodeId?: string | null;
  includeLegacyToolParts?: boolean;
};

export function projectRuntimeEventsToCanvas({
  events,
  existingSnapshot,
  projectId,
  runNodeId,
}: {
  events: RuntimeEvent[];
  existingSnapshot?: {
    nodes: AgentCanvasNode[];
    edges: AgentCanvasEdge[];
  };
  projectId?: string;
  runNodeId?: string;
}): CanvasProjectionState {
  const projection = projectRunTraceToCanvas({
    events,
    existingNodes: existingSnapshot?.nodes,
    existingEdges: existingSnapshot?.edges,
    projectId,
    runNodeId,
  });

  return {
    projectId,
    nodes: projection.nodes,
    edges: projection.edges,
    rejectedOperations: projection.rejectedPatches,
    runSummaries: summarizeRuns(events),
  };
}

export function runtimeEventsFromMessages(
  messages: Array<{ parts?: readonly unknown[] }>,
  runNodeIdOrOptions?: string | RuntimeEventsFromMessagesOptions
) {
  const options =
    typeof runNodeIdOrOptions === "string"
      ? { runNodeId: runNodeIdOrOptions }
      : (runNodeIdOrOptions ?? {});
  const dataPartEvents = messages
    .flatMap((message) => runtimeEventsFromMessageParts(message.parts))
    .filter((event) => !options.runNodeId || event.runNodeId === options.runNodeId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  if (dataPartEvents.length || !options.includeLegacyToolParts) {
    return dataPartEvents;
  }

  return legacyRuntimeEventsFromToolParts(messages, options).sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  );
}

export function runtimeEventsFromMessageParts(parts?: readonly unknown[]) {
  if (!parts?.length) {
    return [];
  }

  return parts.flatMap((part) => {
    const event = readRuntimeEventDataPart(part);
    return event ? [event] : [];
  });
}

export function applyCanvasOperation(
  state: CanvasProjectionState,
  operation: CanvasOperation
) {
  const patch = canvasOperationToGraphPatch(operation);
  const result = applyGraphPatch(state, patch);
  return {
    ...state,
    nodes: result.state.nodes,
    edges: result.state.edges,
    rejectedOperations: result.rejected
      ? [...state.rejectedOperations, result.rejected]
      : state.rejectedOperations,
  };
}

export function applyCanvasOperations(
  state: CanvasProjectionState,
  operations: CanvasOperation[]
) {
  const result = applyGraphPatches(
    state,
    operations.map(canvasOperationToGraphPatch)
  );
  return {
    ...state,
    nodes: result.state.nodes,
    edges: result.state.edges,
    rejectedOperations: [...state.rejectedOperations, ...result.rejected],
  };
}

function summarizeRuns(events: RuntimeEvent[]) {
  const summaries: CanvasProjectionState["runSummaries"] = {};
  for (const event of events) {
    const previous = summaries[event.runNodeId] ?? {
      status: "running",
      eventCount: 0,
    };
    summaries[event.runNodeId] = {
      status:
        event.type === "run.completed"
          ? "completed"
          : event.type === "run.failed"
            ? "failed"
            : previous.status,
      eventCount: previous.eventCount + 1,
    };
  }

  return summaries;
}

const runtimeEventTypeSet = new Set<string>(runtimeEventTypes);

function readRuntimeEventDataPart(part: unknown): RuntimeEvent | null {
  if (!isRecord(part) || part.type !== "data-runtime-event") {
    return null;
  }

  return isRuntimeEvent(part.data) ? part.data : null;
}

function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isOptionalString(value.id) &&
    typeof value.projectId === "string" &&
    typeof value.runNodeId === "string" &&
    typeof value.stepId === "string" &&
    typeof value.type === "string" &&
    runtimeEventTypeSet.has(value.type) &&
    isRecord(value.payload) &&
    isOptionalStringOrNull(value.errorText) &&
    typeof value.createdAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isOptionalStringOrNull(value: unknown) {
  return value === undefined || value === null || typeof value === "string";
}

function canvasOperationToGraphPatch(operation: CanvasOperation): GraphPatch {
  if (operation.type !== "attachArtifact") {
    return operation as GraphPatch;
  }

  return {
    id: operation.id,
    projectId: operation.projectId,
    type: "attachArtifact",
    payload: {
      nodeId: operation.payload.nodeId,
      artifact: operation.payload.artifact ?? {
        id: operation.payload.artifactId,
        type: "image",
      },
    },
  };
}

function legacyRuntimeEventsFromToolParts(
  messages: Array<{ parts?: readonly unknown[] }>,
  options: RuntimeEventsFromMessagesOptions
) {
  if (!options.projectId || !options.runNodeId) {
    return [];
  }

  const events: RuntimeEvent[] = [
    legacyEvent(options, 0, "run", "run.created", {
      prompt: options.prompt ?? "",
      promptNodeId: options.promptNodeId ?? null,
      selectedNodeId: options.selectedNodeId ?? null,
    }),
  ];
  const parts = messages.flatMap((message) => [...(message.parts ?? [])]);
  const toolParts = toolPartsFromMessageParts(parts);

  toolParts.forEach((part, index) => {
    const stepId = readLegacyToolStepId(part.type, index);
    const toolName = part.type.slice("tool-".length);
    const toolCallId = part.toolCallId ?? `${toolName}-${index}`;
    const basePayload = { toolCallId, toolName };

    if (part.input !== undefined) {
      events.push(
        legacyEvent(options, events.length, stepId, "tool.input", {
          ...basePayload,
          input: part.input,
        })
      );
    }

    if (part.state === "output-available") {
      events.push(
        legacyEvent(options, events.length, stepId, "tool.output", {
          ...basePayload,
          output: part.output,
        })
      );

      for (const artifact of legacyArtifactsFromToolOutput(part.output)) {
        events.push(
          legacyEvent(options, events.length, stepId, "artifact.created", {
            artifact,
            canvasNodeId: getLegacyArtifactCanvasNodeId(artifact),
            toolCallId,
            toolName,
          })
        );
      }
    }

    if (part.state === "output-error" || part.state === "output-denied") {
      events.push(
        legacyEvent(
          options,
          events.length,
          stepId,
          "tool.error",
          {
            ...basePayload,
            errorText: part.errorText,
            state: part.state,
          },
          part.errorText
        )
      );
    }
  });

  if (toolParts.some((part) => part.state === "output-error" || part.state === "output-denied")) {
    events.push(
      legacyEvent(
        options,
        events.length,
        "run",
        "run.failed",
        { status: "error" },
        toolParts.find((part) => part.errorText)?.errorText
      )
    );
  } else if (toolParts.some((part) => part.state === "output-available")) {
    events.push(
      legacyEvent(options, events.length, "run", "run.completed", {
        status: "success",
      })
    );
  }

  return events;
}

function legacyEvent(
  options: RuntimeEventsFromMessagesOptions,
  index: number,
  stepId: string,
  type: RuntimeEvent["type"],
  payload: Record<string, unknown>,
  errorText?: string
): RuntimeEvent {
  return {
    id: `legacy-${options.runNodeId}-${index}`,
    projectId: options.projectId ?? "unknown-project",
    runNodeId: options.runNodeId ?? "unknown-run",
    stepId,
    type,
    payload,
    errorText,
    createdAt: new Date(index).toISOString(),
  };
}

function readLegacyToolStepId(toolType: string, index: number) {
  return toolType.startsWith("tool-")
    ? toolType.slice("tool-".length)
    : `legacy-tool-${index}`;
}

function legacyArtifactsFromToolOutput(output: unknown): ArtifactRef[] {
  return [
    ...extractImagesFromToolOutput(output).map((image) => ({
      id: image.artifact?.id ?? image.id,
      type: "image" as const,
      uri: image.artifact?.uri ?? image.url,
      title: image.artifact?.title ?? image.title,
      metadata: image.artifact?.metadata ?? image.metadata,
    })),
    ...extractMarkdownDocumentsFromToolOutput(output).map((document) => ({
      id: document.artifact?.id ?? document.id,
      type: "doc" as const,
      title: document.artifact?.title ?? document.title,
      metadata: {
        ...(document.artifact?.metadata ?? {}),
        content: document.content,
        format: "markdown",
        markdown: document.content,
        mimeType: "text/markdown",
        summary: document.summary,
      },
    })),
    ...extractHtmlPagesFromToolOutput(output).map((page) => ({
      id: page.artifact?.id ?? page.id,
      type: "webpage" as const,
      title: page.artifact?.title ?? page.title,
      contentRef: page.artifact?.contentRef ?? page.previewUrl,
      metadata: {
        ...(page.artifact?.metadata ?? {}),
        format: "html",
        html: page.html,
        mimeType: "text/html",
        summary: page.summary,
      },
    })),
  ];
}

function getLegacyArtifactCanvasNodeId(artifact: ArtifactRef) {
  if (artifact.type === "image") {
    return `image-${artifact.id}`;
  }
  if (artifact.type === "doc") {
    return `markdown-${artifact.id}`;
  }
  if (artifact.type === "webpage") {
    return `webpage-${artifact.id}`;
  }
  return `artifact-${artifact.id}`;
}
