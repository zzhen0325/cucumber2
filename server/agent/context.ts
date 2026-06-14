import type { UIMessage, UIMessageStreamWriter } from "ai";

import {
  DEFAULT_UPSTREAM_CONTEXT_BUDGET,
  collectUpstreamContextWithTrace,
  getRunReferenceNodeIds,
} from "../../src/lib/graph.ts";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  ArtifactRef,
  UpstreamContextItem,
} from "../../src/types/canvas.ts";
import type { CanvasOperation } from "../../src/types/runtime.ts";
import type { AgentProject } from "../supabase.ts";
import type { NormalizedAgentInput } from "./input-normalizer.ts";
import type { ActivatedAgentSkill, AgentSkillCard } from "./skills/types.ts";

export type CanvasSnapshot = {
  nodes: AgentCanvasNode[];
  edges: AgentCanvasEdge[];
};

export type AgentRunRequestContext = {
  prompt: string;
  promptNodeId?: string | null;
  selectedNodeId?: string | null;
  selectedNodeIds?: string[];
};

export type AgentRunInput = {
  userId: string;
  workspaceId?: string;
  projectId: string;
  canvasId: string;
  runNodeId: string;
  message: string;
  normalizedInput?: NormalizedAgentInput;
  promptNodeId: string | null;
  selectedNodeId: string | null;
  upstreamContext: UpstreamContextItem[];
  contextSummary?: AgentRunContextSummary;
  canvasSnapshot: CanvasSnapshot;
  selectedNodeIds: string[];
  signal?: AbortSignal;
};

export type AgentRunContextNodeSummary = {
  id: string;
  kind: AgentCanvasNode["data"]["kind"];
  label?: string;
};

export type AgentRunOmittedContextNode = AgentRunContextNodeSummary & {
  reason: string;
};

export type AgentRunContextSummary = {
  selectedNodes: AgentRunContextNodeSummary[];
  referenceNodes: AgentRunContextNodeSummary[];
  upstreamPath: Array<{
    nodeId: string;
    type: UpstreamContextItem["type"];
    title?: string;
    summary?: string;
  }>;
  omittedNodes: AgentRunOmittedContextNode[];
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
  | { type: "skill_retrieved"; candidates: AgentSkillCard[] }
  | {
      type: "skill_activated";
      skill: Pick<
        ActivatedAgentSkill,
        "agentScope" | "id" | "name" | "purpose" | "scripts" | "tags"
      >;
    }
  | {
      type: "skill_script_started";
      input?: unknown;
      scriptName: string;
      skillId: string;
      skillName: string;
    }
  | {
      type: "skill_script_completed";
      output: unknown;
      scriptName: string;
      skillId: string;
      skillName: string;
    }
  | {
      type: "skill_script_failed";
      input?: unknown;
      message: string;
      scriptName: string;
      skillId: string;
      skillName: string;
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
  mcpRunContextId?: string;
  activatedSkills: ActivatedAgentSkill[];
  producedArtifacts: ArtifactRef[];
  pendingEvents: PendingCucumberEvent[];
  pushLiveEvent?: (event: PendingCucumberEvent) => void;
  skillCandidates: AgentSkillCard[];
  prompt: string;
  normalizedInput?: NormalizedAgentInput;
  selectedNodeId: string | null;
  upstreamContext: UpstreamContextItem[];
  contextSummary?: AgentRunContextSummary;
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

export class AgentContextValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentContextValidationError";
  }
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
    throw new AgentContextValidationError(
      "Project snapshot does not match the requested project."
    );
  }

  const nodeIds = new Set(projectSnapshot.nodes.map((node) => node.id));
  assertProjectNode(nodeIds, runNodeId, "Run node");

  const promptNodeId = canvasContext.promptNodeId ?? null;
  if (promptNodeId) {
    assertProjectNode(nodeIds, promptNodeId, "Prompt node");
  }

  const requestedSelectedNodeIds = normalizeRequestedSelectedNodeIds(
    canvasContext.selectedNodeIds,
    canvasContext.selectedNodeId ?? null
  );
  for (const nodeId of requestedSelectedNodeIds) {
    assertProjectNode(nodeIds, nodeId, "Selected node");
  }
  const nodesById = new Map(projectSnapshot.nodes.map((node) => [node.id, node]));
  const requestedSelectedNodes = requestedSelectedNodeIds.flatMap((nodeId) => {
    const node = nodesById.get(nodeId);
    return node ? [node] : [];
  });
  const referenceNodeIds = getRunReferenceNodeIds(requestedSelectedNodes);
  const selectedNodeId = referenceNodeIds[0] ?? null;

  const contextCollection = collectUpstreamContextWithTrace(
    referenceNodeIds,
    projectSnapshot.nodes,
    projectSnapshot.edges,
    { budget: DEFAULT_UPSTREAM_CONTEXT_BUDGET }
  );
  const upstreamContext = contextCollection.items;
  const contextNodeIds = uniqueNodeIds([
    ...referenceNodeIds,
    ...upstreamContext.map((item) => item.nodeId),
  ]);
  const nonReferenceSelectedNodes = requestedSelectedNodes.filter(
    (node) => !referenceNodeIds.includes(node.id)
  );
  const contextSummary: AgentRunContextSummary = {
    selectedNodes: requestedSelectedNodes.map(summarizeNodeForContext),
    referenceNodes: referenceNodeIds.flatMap((nodeId) => {
      const node = nodesById.get(nodeId);
      return node ? [summarizeNodeForContext(node)] : [];
    }),
    upstreamPath: upstreamContext.map((item) => ({
      nodeId: item.nodeId,
      type: item.type,
      title: item.title,
      summary: item.summary,
    })),
    omittedNodes: [
      ...nonReferenceSelectedNodes.map((node) => ({
        ...summarizeNodeForContext(node),
        reason: "not_referenceable",
      })),
      ...contextCollection.omittedItems.map((item) => {
        const node = nodesById.get(item.nodeId);
        return {
          ...(node
            ? summarizeNodeForContext(node)
            : { id: item.nodeId, kind: "artifact" as const }),
          reason: item.omittedReason ?? "omitted",
        };
      }),
    ],
  };

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
    selectedNodeIds: contextNodeIds,
    signal,
    upstreamContext,
    contextSummary,
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
    activatedSkills: [],
    pendingEvents: [],
    producedArtifacts: [],
    projectId: input.projectId,
    prompt: input.message,
    normalizedInput: input.normalizedInput,
    runNodeId: input.runNodeId,
    selectedNodeId: input.selectedNodeId,
    selectedNodeIds: input.selectedNodeIds,
    signal: input.signal,
    skillCandidates: [],
    contextSummary: input.contextSummary,
    upstreamContext: input.upstreamContext,
    userId: input.userId,
    workspaceId: input.workspaceId,
  };
}

function summarizeNodeForContext(node: AgentCanvasNode): AgentRunContextNodeSummary {
  return {
    id: node.id,
    kind: node.data.kind,
    label: getNodeContextLabel(node),
  };
}

function getNodeContextLabel(node: AgentCanvasNode) {
  const data = node.data;
  if (data.kind === "prompt") {
    return data.prompt;
  }
  if (data.kind === "run") {
    return data.prompt;
  }
  if (data.kind === "imageResult") {
    return data.image.title ?? data.prompt;
  }
  if (data.kind === "stickyNote") {
    return data.text;
  }
  if (data.kind === "shape") {
    return data.label;
  }
  if ("title" in data && typeof data.title === "string") {
    return data.title;
  }
  if ("summary" in data && typeof data.summary === "string") {
    return data.summary;
  }
  return undefined;
}

function normalizeRequestedSelectedNodeIds(
  selectedNodeIds: string[] | undefined,
  fallbackSelectedNodeId: string | null
) {
  if (selectedNodeIds?.length) {
    return uniqueNodeIds(selectedNodeIds);
  }

  return fallbackSelectedNodeId ? [fallbackSelectedNodeId] : [];
}

function uniqueNodeIds(nodeIds: string[]) {
  const seen = new Set<string>();
  return nodeIds.filter((nodeId) => {
    if (!nodeId || seen.has(nodeId)) {
      return false;
    }
    seen.add(nodeId);
    return true;
  });
}

function assertProjectNode(nodeIds: Set<string>, nodeId: string, label: string) {
  if (!nodeIds.has(nodeId)) {
    throw new AgentContextValidationError(
      `${label} ${nodeId} is not part of the persisted project snapshot.`
    );
  }
}
