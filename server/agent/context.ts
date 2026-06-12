import type { UIMessage, UIMessageStreamWriter } from "ai";

import { collectUpstreamContext } from "../../src/lib/graph.ts";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  ArtifactRef,
  UpstreamContextItem,
} from "../../src/types/canvas.ts";
import type { CanvasOperation } from "../../src/types/runtime.ts";
import type { AgentProject } from "../supabase.ts";

export type CanvasSnapshot = {
  nodes: AgentCanvasNode[];
  edges: AgentCanvasEdge[];
};

export type AgentRunRequestContext = {
  prompt: string;
  promptNodeId?: string | null;
  selectedNodeId?: string | null;
};

export type AgentRunInput = {
  userId: string;
  workspaceId?: string;
  projectId: string;
  canvasId: string;
  runNodeId: string;
  message: string;
  promptNodeId: string | null;
  selectedNodeId: string | null;
  upstreamContext: UpstreamContextItem[];
  canvasSnapshot: CanvasSnapshot;
  selectedNodeIds: string[];
  signal?: AbortSignal;
};

export type CucumberRunEvent =
  | { type: "text_delta"; text: string }
  | { type: "agent_active"; agentName: string }
  | { type: "handoff_requested"; fromAgent?: string; toAgent?: string }
  | { type: "handoff_completed"; fromAgent?: string; toAgent?: string }
  | { type: "tool_started"; toolName: string; toolCallId?: string; input?: unknown }
  | { type: "tool_completed"; toolName: string; toolCallId?: string; output?: unknown }
  | {
      type: "tool_failed";
      toolName: string;
      toolCallId?: string;
      input?: unknown;
      message: string;
    }
  | { type: "canvas_operation_proposed"; operations: CanvasOperation[] }
  | { type: "canvas_operation_applied"; operations: CanvasOperation[] }
  | {
      type: "canvas_operation_rejected";
      rejections: Array<{ operation: CanvasOperation; reason: string }>;
    }
  | {
      type: "artifact_created";
      artifact: ArtifactRef;
      canvasNodeId?: string;
      toolName?: string;
    }
  | { type: "run_completed"; finalOutput?: string; artifactIds: string[] }
  | { type: "error"; message: string };

export type PendingCucumberEvent = Exclude<
  CucumberRunEvent,
  | { type: "text_delta" }
  | { type: "run_completed" }
  | { type: "error" }
  | { type: "agent_active" }
  | { type: "handoff_requested" }
  | { type: "handoff_completed" }
  | { type: "tool_started" }
  | { type: "tool_completed" }
  | { type: "tool_failed" }
>;

export type CucumberAgentContext = {
  userId: string;
  workspaceId?: string;
  projectId: string;
  canvasId: string;
  runNodeId: string;
  canvasSnapshot: CanvasSnapshot;
  selectedNodeIds: string[];
  signal?: AbortSignal;
  knownNodeIds: string[];
  producedArtifacts: ArtifactRef[];
  pendingEvents: PendingCucumberEvent[];
  pushLiveEvent?: (event: PendingCucumberEvent) => void;
  prompt: string;
  selectedNodeId: string | null;
  upstreamContext: UpstreamContextItem[];
};

export type ExecuteAgentRunInput = {
  userId: string;
  projectId: string;
  runNodeId: string;
  canvasContext: AgentRunRequestContext;
  writer: UIMessageStreamWriter<UIMessage>;
  projectSnapshot: Pick<AgentProject, "id" | "nodes" | "edges">;
  signal?: AbortSignal;
};

export interface AgentRuntime {
  run(input: AgentRunInput): AsyncIterable<CucumberRunEvent>;
}

export function buildAgentRunInput({
  canvasContext,
  projectId,
  projectSnapshot,
  runNodeId,
  signal,
  userId,
}: Omit<ExecuteAgentRunInput, "writer">): AgentRunInput {
  if (projectSnapshot.id !== projectId) {
    throw new Error("Project snapshot does not match the requested project.");
  }

  const nodeIds = new Set(projectSnapshot.nodes.map((node) => node.id));
  assertProjectNode(nodeIds, runNodeId, "Run node");

  const promptNodeId = canvasContext.promptNodeId ?? null;
  if (promptNodeId) {
    assertProjectNode(nodeIds, promptNodeId, "Prompt node");
  }

  const selectedNodeId = canvasContext.selectedNodeId ?? null;
  if (selectedNodeId) {
    assertProjectNode(nodeIds, selectedNodeId, "Selected node");
  }

  const upstreamContext = collectUpstreamContext(
    selectedNodeId,
    projectSnapshot.nodes,
    projectSnapshot.edges
  );

  return {
    canvasId: projectId,
    canvasSnapshot: {
      nodes: projectSnapshot.nodes,
      edges: projectSnapshot.edges,
    },
    message: canvasContext.prompt,
    promptNodeId,
    projectId,
    runNodeId,
    selectedNodeId,
    selectedNodeIds: [selectedNodeId, ...upstreamContext.map((item) => item.nodeId)].filter(
      (id): id is string => Boolean(id)
    ),
    signal,
    upstreamContext,
    userId,
  };
}

export function buildCucumberAgentContext(input: AgentRunInput): CucumberAgentContext {
  const knownNodeIds = new Set(input.canvasSnapshot.nodes.map((node) => node.id));
  if (input.promptNodeId) {
    knownNodeIds.add(input.promptNodeId);
  }
  knownNodeIds.add(input.runNodeId);

  return {
    canvasId: input.canvasId,
    canvasSnapshot: input.canvasSnapshot,
    knownNodeIds: [...knownNodeIds],
    pendingEvents: [],
    producedArtifacts: [],
    projectId: input.projectId,
    prompt: input.message,
    runNodeId: input.runNodeId,
    selectedNodeId: input.selectedNodeId,
    selectedNodeIds: input.selectedNodeIds,
    signal: input.signal,
    upstreamContext: input.upstreamContext,
    userId: input.userId,
    workspaceId: input.workspaceId,
  };
}

function assertProjectNode(nodeIds: Set<string>, nodeId: string, label: string) {
  if (!nodeIds.has(nodeId)) {
    throw new Error(`${label} ${nodeId} is not part of the persisted project snapshot.`);
  }
}
