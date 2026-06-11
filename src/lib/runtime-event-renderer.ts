import {
  applyGraphPatch,
  applyGraphPatches,
  projectRunTraceToCanvas,
  type GraphPatch,
  type GraphProjectionState,
  type RejectedGraphPatch,
} from "./graph-projection";
import type { AgentCanvasEdge, AgentCanvasNode } from "@/types/canvas";
import {
  agentEventTypes,
  type AgentEvent,
  type CanvasOperation,
} from "@/types/runtime";

export type CanvasProjectionState = GraphProjectionState & {
  runSummaries: Record<string, { status: string; eventCount: number }>;
  rejectedOperations: RejectedGraphPatch[];
};

export type AgentEventsFromMessagesOptions = {
  runNodeId?: string;
  messageStartIndex?: number;
};

export function projectRuntimeEventsToCanvas({
  events,
  existingSnapshot,
  projectId,
  runNodeId,
}: {
  events: AgentEvent[];
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
  runNodeIdOrOptions?: string | AgentEventsFromMessagesOptions
) {
  const options =
    typeof runNodeIdOrOptions === "string"
      ? { runNodeId: runNodeIdOrOptions }
      : (runNodeIdOrOptions ?? {});
  return getMessageWindow(messages, options.messageStartIndex)
    .flatMap((message) => runtimeEventsFromMessageParts(message.parts))
    .filter((event) => !options.runNodeId || event.runNodeId === options.runNodeId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function runtimeEventsFromMessageParts(parts?: readonly unknown[]) {
  if (!parts?.length) {
    return [];
  }

  return parts.flatMap((part) => {
    if (!isRecord(part) || part.type !== "data-runtime-event") {
      return [];
    }
    return isAgentEvent(part.data) ? [part.data] : [];
  });
}

export function applyCanvasOperation(
  state: CanvasProjectionState,
  operation: CanvasOperation
) {
  const result = applyGraphPatch(state, operation as GraphPatch);
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
  const result = applyGraphPatches(state, operations as GraphPatch[]);
  return {
    ...state,
    nodes: result.state.nodes,
    edges: result.state.edges,
    rejectedOperations: [...state.rejectedOperations, ...result.rejected],
  };
}

function summarizeRuns(events: AgentEvent[]) {
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

const agentEventTypeSet = new Set<string>(agentEventTypes);

function isAgentEvent(value: unknown): value is AgentEvent {
  return Boolean(
    isRecord(value) &&
      typeof value.projectId === "string" &&
      typeof value.runNodeId === "string" &&
      typeof value.stepId === "string" &&
      typeof value.type === "string" &&
      agentEventTypeSet.has(value.type) &&
      isRecord(value.payload) &&
      typeof value.createdAt === "string"
  );
}

function getMessageWindow<T>(messages: T[], startIndex: number | undefined) {
  if (!Number.isFinite(startIndex)) {
    return messages;
  }
  return messages.slice(Math.max(0, Math.floor(startIndex ?? 0)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
