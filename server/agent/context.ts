import type { UIMessage } from "ai";

import type { AgentCanvasEdge, AgentCanvasNode, ArtifactRef } from "../../src/types/canvas.ts";
import type { CanvasOperation } from "../../src/types/runtime.ts";
import type { ModelProviderId } from "../model-providers.ts";
import type { PromptCanvasContext, PromptUpstreamContextItem } from "../prompts.ts";
import type { AgentProject } from "../supabase.ts";

export type CanvasSnapshot = {
  nodes: AgentCanvasNode[];
  edges: AgentCanvasEdge[];
};

export type AgentRunInput = {
  userId: string;
  workspaceId?: string;
  projectId: string;
  canvasId: string;
  runNodeId: string;
  message: string;
  canvasContext: PromptCanvasContext;
  canvasSnapshot: CanvasSnapshot;
  selectedNodeIds?: string[];
  messages: UIMessage[];
  modelProvider: ModelProviderId;
  attachments?: unknown[];
};

export type CucumberRunEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; toolName: string; toolCallId?: string; input?: unknown }
  | { type: "tool_completed"; toolName: string; toolCallId?: string; output?: unknown }
  | { type: "canvas_operation_proposed"; operations: CanvasOperation[] }
  | { type: "canvas_operation_applied"; operations: CanvasOperation[] }
  | {
      type: "canvas_operation_rejected";
      rejections: Array<{ operation: CanvasOperation; reason: string }>;
    }
  | { type: "artifact_created"; artifact: ArtifactRef; canvasNodeId?: string }
  | { type: "run_completed"; finalOutput?: string }
  | { type: "error"; message: string };

export type PendingCucumberEvent = Exclude<CucumberRunEvent, { type: "text_delta" | "run_completed" | "error" }>;

export type CucumberAgentContext = {
  userId: string;
  workspaceId?: string;
  projectId: string;
  canvasId: string;
  runNodeId: string;
  canvasSnapshot: CanvasSnapshot;
  selectedNodeIds: string[];
  knownNodeIds: string[];
  producedArtifacts: ArtifactRef[];
  pendingEvents: PendingCucumberEvent[];
  // Optional live event sink wired up by the runtime stream merger. When set,
  // tools can emit events (e.g. each image the moment it finishes) that are
  // streamed to the client immediately instead of being buffered in
  // `pendingEvents` until the tool call returns.
  pushLiveEvent?: (event: PendingCucumberEvent) => void;
  // Image-generation context. Reference image urls live in `upstreamContext`
  // and are forwarded directly to the image service; they are never surfaced to
  // the language model (see generate-image.tool.ts).
  prompt: string;
  selectedNodeId: string | null;
  upstreamContext: PromptUpstreamContextItem[];
};

export type ExecuteAgentRunV2Input = {
  userId: string;
  projectId: string;
  runNodeId: string;
  canvasContext: PromptCanvasContext;
  messages: UIMessage[];
  modelProvider: ModelProviderId;
  writer: import("ai").UIMessageStreamWriter<UIMessage>;
  attachments?: unknown[];
  projectSnapshot?: Pick<AgentProject, "id" | "nodes" | "edges">;
};

export interface AgentRuntime {
  run(input: AgentRunInput): AsyncIterable<CucumberRunEvent>;
}

export function buildAgentRunInputV2({
  attachments = [],
  canvasContext,
  messages,
  modelProvider,
  projectId,
  projectSnapshot,
  runNodeId,
  userId,
}: Omit<ExecuteAgentRunV2Input, "writer">): AgentRunInput {
  return {
    attachments,
    canvasContext,
    canvasId: projectId,
    canvasSnapshot: {
      nodes: projectSnapshot?.nodes ?? [],
      edges: projectSnapshot?.edges ?? [],
    },
    message: canvasContext.prompt,
    messages,
    modelProvider,
    projectId,
    runNodeId,
    selectedNodeIds: [
      canvasContext.selectedNodeId,
      ...canvasContext.upstreamContext.map((item) => item.nodeId),
    ].filter((id): id is string => Boolean(id)),
    userId,
  };
}

export function buildCucumberAgentContext(input: AgentRunInput): CucumberAgentContext {
  const knownNodeIds = new Set<string>();
  for (const node of input.canvasSnapshot.nodes) {
    knownNodeIds.add(node.id);
  }
  for (const edge of input.canvasSnapshot.edges) {
    knownNodeIds.add(edge.source);
    knownNodeIds.add(edge.target);
  }
  for (const item of input.canvasContext.upstreamContext) {
    knownNodeIds.add(item.nodeId);
  }
  if (input.canvasContext.promptNodeId) {
    knownNodeIds.add(input.canvasContext.promptNodeId);
  }
  if (input.canvasContext.selectedNodeId) {
    knownNodeIds.add(input.canvasContext.selectedNodeId);
  }
  knownNodeIds.add(input.runNodeId);

  return {
    canvasId: input.canvasId,
    canvasSnapshot: input.canvasSnapshot,
    knownNodeIds: [...knownNodeIds],
    pendingEvents: [],
    producedArtifacts: [],
    projectId: input.projectId,
    prompt: input.canvasContext.prompt,
    runNodeId: input.runNodeId,
    selectedNodeId: input.canvasContext.selectedNodeId ?? null,
    selectedNodeIds: input.selectedNodeIds ?? [],
    upstreamContext: input.canvasContext.upstreamContext ?? [],
    userId: input.userId,
    workspaceId: input.workspaceId,
  };
}
