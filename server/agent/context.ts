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
import type { CanvasProject } from "../canvas-store.ts";
import type { ImageProviderSelection } from "../provider-config.ts";
import {
  finalizeNormalizedAgentInput,
  type NormalizedAgentInput,
} from "./input-normalizer.ts";
import type { ActivatedAgentSkill, AgentSkillCard } from "./skills/types.ts";
import { getTextArtifactContentForUser } from "../artifact-content-store.ts";

export type CanvasSnapshot = {
  nodes: AgentCanvasNode[];
  edges: AgentCanvasEdge[];
};

export type AgentRunRequestContext = {
  forcedSkillId?: string;
  forcedSkillName?: string;
  imageAspectRatio?: ImageAspectRatioSelection;
  imageResultCount?: ImageResultCountSelection;
  imageProvider?: ImageProviderSelection;
  inputMode?: AgentRunInputMode;
  prompt: string;
  promptNodeId?: string | null;
  retryFrom?: AgentRetryContext | null;
  selectedNodeId?: string | null;
  selectedNodeIds?: string[];
};

export type AgentRunInput = {
  userId: string;
  workspaceId?: string;
  projectId: string;
  canvasPatchApplied?: boolean;
  canvasId: string;
  runNodeId: string;
  message: string;
  forcedSkillId?: string;
  forcedSkillName?: string;
  imageAspectRatio?: ImageAspectRatioSelection;
  imageResultCount?: ImageResultCountSelection;
  imageProvider?: ImageProviderSelection;
  inputMode?: AgentRunInputMode;
  normalizedInput?: NormalizedAgentInput;
  promptNodeId: string | null;
  projectVersion?: number;
  retryFrom?: AgentRetryContext | null;
  selectedNodeId: string | null;
  upstreamContext: UpstreamContextItem[];
  contextSummary?: AgentRunContextSummary;
  canvasSnapshot: CanvasSnapshot;
  selectedNodeIds: string[];
  signal?: AbortSignal;
};

export type AgentRunInputMode = "agent" | "image";
export type ImageAspectRatioSelection = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
export type ImageResultCountSelection = 1 | 2 | 3 | 4;

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

export type AgentRetryContext = {
  failedRunNodeId: string;
  stepId: string;
  label?: string;
  toolName?: string;
  errorText?: string;
};

export type CucumberTextDeltaSource =
  | "output_text"
  | "reasoning_summary"
  | "refusal";

export type CucumberRunEvent =
  | { type: "text_delta"; text: string; source?: CucumberTextDeltaSource }
  | {
      type: "run_phase_started";
      details?: Record<string, unknown>;
      label: string;
      phase: "prepare" | "route" | "execute" | "materialize";
      startedAt: string;
      stepId: string;
    }
  | {
      type: "run_phase_completed";
      completedAt: string;
      details?: Record<string, unknown>;
      durationMs: number;
      label: string;
      phase: "prepare" | "route" | "execute" | "materialize";
      startedAt: string;
      stepId: string;
    }
  | {
      type: "run_phase_failed";
      details?: Record<string, unknown>;
      durationMs: number;
      errorText: string;
      failedAt: string;
      label: string;
      phase: "prepare" | "route" | "execute" | "materialize";
      startedAt: string;
      stepId: string;
    }
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
  | { type: "run_phase_started" }
  | { type: "run_phase_completed" }
  | { type: "run_phase_failed" }
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
  activatedSkills: ActivatedAgentSkill[];
  producedArtifacts: ArtifactRef[];
  pendingEvents: PendingCucumberEvent[];
  pushLiveEvent?: (event: PendingCucumberEvent) => void;
  skillCandidates: AgentSkillCard[];
  forcedSkillId?: string;
  forcedSkillName?: string;
  prompt: string;
  imageAspectRatio?: ImageAspectRatioSelection;
  imageResultCount?: ImageResultCountSelection;
  imageProvider?: ImageProviderSelection;
  inputMode?: AgentRunInputMode;
  normalizedInput?: NormalizedAgentInput;
  retryFrom?: AgentRetryContext | null;
  selectedNodeId: string | null;
  upstreamContext: UpstreamContextItem[];
  contextSummary?: AgentRunContextSummary;
};

export type ExecuteAgentRunInput = {
  userId: string;
  projectId: string;
  runNodeId: string;
  canvasContext: AgentRunRequestContext;
  canvasPatchApplied?: boolean;
  writer: UIMessageStreamWriter<UIMessage>;
  projectSnapshot: Pick<CanvasProject, "id" | "nodes" | "edges"> &
    Partial<Pick<CanvasProject, "version">>;
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
  canvasPatchApplied,
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
    canvasPatchApplied,
    canvasSnapshot: {
      nodes: projectSnapshot.nodes,
      edges: projectSnapshot.edges,
    },
    message: canvasContext.prompt,
    forcedSkillId: canvasContext.forcedSkillId,
    forcedSkillName: canvasContext.forcedSkillName,
    imageAspectRatio: canvasContext.imageAspectRatio,
    imageResultCount: canvasContext.imageResultCount,
    imageProvider: canvasContext.imageProvider,
    inputMode: canvasContext.inputMode,
    normalizedInput: buildExplicitImageModeInput(canvasContext),
    promptNodeId,
    projectVersion: projectSnapshot.version,
    projectId,
    retryFrom: normalizeRetryContext(canvasContext.retryFrom),
    runNodeId,
    selectedNodeId,
    selectedNodeIds: contextNodeIds,
    signal,
    upstreamContext,
    contextSummary,
    userId,
  };
}

function buildExplicitImageModeInput(
  canvasContext: AgentRunRequestContext
): NormalizedAgentInput | undefined {
  if (canvasContext.inputMode !== "image") {
    return undefined;
  }

  return finalizeNormalizedAgentInput(
    {
      rawPrompt: canvasContext.prompt,
      userGoal: canvasContext.prompt,
      operation: "create",
      artifact: { kind: "image", format: "png" },
      domain: "visual-design",
      requiredCapabilities: ["image-generation"],
      negativeCapabilities: [],
      image: {
        contentPrompt: canvasContext.prompt,
        aspectRatio: canvasContext.imageAspectRatio,
        resultCount: canvasContext.imageResultCount,
      },
    },
    canvasContext.prompt
  );
}

const maxHydratedArtifactContentChars = 12_000;

export async function hydrateAgentRunInputArtifacts(
  input: AgentRunInput
): Promise<AgentRunInput> {
  const hydratedContext = await Promise.all(
    input.upstreamContext.map((item) =>
      hydrateUpstreamContextItem({
        item,
        projectId: input.projectId,
        userId: input.userId,
      })
    )
  );

  const upstreamContext = hydratedContext.map((result) => result.item);
  const contentByNodeId = new Map(
    upstreamContext
      .filter((item) => item.content)
      .map((item) => [item.nodeId, item.content as string])
  );

  return {
    ...input,
    upstreamContext,
    contextSummary: input.contextSummary
      ? {
          ...input.contextSummary,
          upstreamPath: input.contextSummary.upstreamPath.map((item) => {
            const content = contentByNodeId.get(item.nodeId);
            return content ? { ...item, summary: content } : item;
          }),
        }
      : input.contextSummary,
  };
}

async function hydrateUpstreamContextItem({
  item,
  projectId,
  userId,
}: {
  item: UpstreamContextItem;
  projectId: string;
  userId: string;
}): Promise<{ item: UpstreamContextItem }> {
  if (!shouldHydrateArtifactContent(item)) {
    return { item };
  }

  const artifactId = item.artifact?.id;
  if (!artifactId) {
    return { item };
  }

  const result = await getTextArtifactContentForUser({
    artifactId,
    projectId,
    userId,
  });
  const content = result ? readArtifactContentText(result.content) : null;
  if (!content) {
    return { item };
  }

  const cappedContent = limitArtifactContentForContext(content);
  return {
    item: {
      ...item,
      content: cappedContent,
      contentFormat: result?.content.contentFormat,
      mimeType: result?.content.mimeType ?? item.artifact?.mimeType,
    },
  };
}

function shouldHydrateArtifactContent(item: UpstreamContextItem) {
  const artifactType = item.artifact?.type;
  return Boolean(
    item.artifact?.id &&
      (artifactType === "doc" ||
        artifactType === "code" ||
        artifactType === "webpage" ||
        artifactType === "tool_result" ||
        item.type === "doc" ||
        item.type === "code" ||
        item.type === "webpage" ||
        item.type === "tool_result")
  );
}

function readArtifactContentText(
  content: NonNullable<
    Awaited<ReturnType<typeof getTextArtifactContentForUser>>
  >["content"]
) {
  const text =
    readNonEmptyString(content.plainText) ??
    readNonEmptyString(content.contentText) ??
    stringifyContentJson(content.contentJson);
  return text?.trim() || null;
}

function stringifyContentJson(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value.trim() || null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function limitArtifactContentForContext(content: string) {
  if (content.length <= maxHydratedArtifactContentChars) {
    return content;
  }
  return `${content.slice(0, maxHydratedArtifactContentChars)}\n...[artifact content truncated]`;
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
    imageAspectRatio: input.imageAspectRatio,
    imageResultCount: input.imageResultCount,
    imageProvider: input.imageProvider,
    inputMode: input.inputMode,
    normalizedInput: input.normalizedInput,
    retryFrom: input.retryFrom ?? null,
    runNodeId: input.runNodeId,
    selectedNodeId: input.selectedNodeId,
    selectedNodeIds: input.selectedNodeIds,
    signal: input.signal,
    skillCandidates: [],
    forcedSkillId: input.forcedSkillId,
    forcedSkillName: input.forcedSkillName,
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

function normalizeRetryContext(
  retryFrom: AgentRetryContext | null | undefined
): AgentRetryContext | null {
  if (!retryFrom?.failedRunNodeId || !retryFrom.stepId) {
    return null;
  }

  return {
    failedRunNodeId: retryFrom.failedRunNodeId,
    stepId: retryFrom.stepId,
    label: normalizeOptionalText(retryFrom.label),
    toolName: normalizeOptionalText(retryFrom.toolName),
    errorText: normalizeOptionalText(retryFrom.errorText),
  };
}

function normalizeOptionalText(value: string | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
