import {
  createImageResultNodes,
  createPendingImageResultNodes,
  getImageResultNodeDimensions,
} from "./graph";
import { getPromptNodeDimensions } from "./canvas-node-dimensions";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  AgentCanvasNodeData,
  AgentRunStatus,
  ArtifactRef,
  CanvasToolPart,
  GeneratedImage,
  ImageRequestPreview,
  RunStepTimelineItem,
  RunSummaryItem,
} from "../types/canvas";
import type { AgentEvent, CanvasOperation } from "../types/runtime";

const DEFAULT_PROMPT_POSITION = { x: 260, y: 210 };
const RUN_OFFSET_Y = 124;
const ARTIFACT_NODE_GAP_Y = 162;
const ARTIFACT_NODE_GAP_X = 257;
const DIRECT_TEXT_RESULT_OFFSET_Y = 360;

export type RunStepTraceEvent = AgentEvent;

export type GraphProjectionState = {
  projectId?: string;
  nodes: AgentCanvasNode[];
  edges: AgentCanvasEdge[];
};

export type GraphPatch =
  | {
      id: string;
      projectId?: string;
      type: "createNode";
      payload: { node: AgentCanvasNode };
    }
  | {
      id: string;
      projectId?: string;
      type: "updateNode";
      payload: {
        nodeId: string;
        position?: AgentCanvasNode["position"];
        data?: Partial<AgentCanvasNodeData>;
      };
    }
  | {
      id: string;
      projectId?: string;
      type: "createEdge";
      payload: { edge: AgentCanvasEdge };
    }
  | {
      id: string;
      projectId?: string;
      type: "setNodeStatus";
      payload: { nodeId: string; status: AgentRunStatus; error?: string };
    }
  ;

export type RejectedGraphPatch = {
  patch: GraphPatch;
  reason: string;
};

export type GraphPatchResult = {
  state: GraphProjectionState;
  rejected?: RejectedGraphPatch;
};

export function applyGraphPatches(
  state: GraphProjectionState,
  patches: GraphPatch[]
) {
  return patches.reduce(
    (result, patch) => {
      const next = applyGraphPatch(result.state, patch);
      return {
        state: next.state,
        rejected: next.rejected
          ? [...result.rejected, next.rejected]
          : result.rejected,
      };
    },
    { state, rejected: [] as RejectedGraphPatch[] }
  );
}

export function applyGraphPatch(
  state: GraphProjectionState,
  patch: GraphPatch
): GraphPatchResult {
  if (state.projectId && patch.projectId && state.projectId !== patch.projectId) {
    return rejectPatch(state, patch, "patch_project_mismatch");
  }

  if (patch.type === "createNode") {
    const node = patch.payload.node;
    if (!isValidNode(node)) {
      return rejectPatch(state, patch, "invalid_node_kind");
    }
    if (state.nodes.some((existing) => existing.id === node.id)) {
      return rejectPatch(state, patch, "duplicate_node");
    }

    return {
      state: {
        ...state,
        nodes: [...state.nodes, node],
      },
    };
  }

  if (patch.type === "updateNode") {
    const existing = state.nodes.find(
      (node) => node.id === patch.payload.nodeId
    );
    if (!existing) {
      return rejectPatch(state, patch, "missing_node");
    }
    if (
      patch.payload.data?.kind &&
      patch.payload.data.kind !== existing.data.kind
    ) {
      return rejectPatch(state, patch, "node_kind_change_denied");
    }

    return {
      state: {
        ...state,
        nodes: state.nodes.map((node) =>
          node.id === patch.payload.nodeId
            ? {
                ...node,
                position: patch.payload.position ?? node.position,
                data: patch.payload.data
                  ? ({ ...node.data, ...patch.payload.data } as AgentCanvasNodeData)
                  : node.data,
              }
            : node
        ),
      },
    };
  }

  if (patch.type === "createEdge") {
    const edge = patch.payload.edge;
    const nodeIds = new Set(state.nodes.map((node) => node.id));
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return rejectPatch(state, patch, "dangling_edge");
    }
    if (state.edges.some((existing) => existing.id === edge.id)) {
      return rejectPatch(state, patch, "duplicate_edge");
    }

    return {
      state: {
        ...state,
        edges: [...state.edges, edge],
      },
    };
  }

  if (patch.type === "setNodeStatus") {
    const existing = state.nodes.find(
      (node) => node.id === patch.payload.nodeId
    );
    if (!existing) {
      return rejectPatch(state, patch, "missing_node");
    }
    if (existing.data.kind !== "run") {
      return rejectPatch(state, patch, "status_target_not_run");
    }

    return {
      state: {
        ...state,
        nodes: state.nodes.map((node) =>
          node.id === patch.payload.nodeId && node.data.kind === "run"
            ? {
                ...node,
                data: {
                  ...node.data,
                  status: patch.payload.status,
                  error: patch.payload.error ?? node.data.error,
                },
              }
            : node
        ),
      },
    };
  }

  return rejectPatch(state, patch, "unknown_patch_type");
}

export function projectRunTraceToCanvas({
  events,
  existingNodes = [],
  existingEdges = [],
  projectId,
  runNodeId,
  streamedAgentTextByRunId,
}: {
  events: RunStepTraceEvent[];
  existingNodes?: AgentCanvasNode[];
  existingEdges?: AgentCanvasEdge[];
  projectId?: string;
  runNodeId?: string;
  streamedAgentTextByRunId?: Map<string, string>;
}) {
  const orderedEvents = [...events].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  );
  const runCreated = orderedEvents.find(
    (event) => event.type === "run.created"
  );
  const runFailed = orderedEvents.findLast(
    (event) => event.type === "run.failed"
  );
  const targetRunNodeId = runNodeId ?? runCreated?.runNodeId ?? events[0]?.runNodeId;
  if (!targetRunNodeId) {
    return {
      nodes: [],
      edges: [],
      rejectedPatches: [] as RejectedGraphPatch[],
    };
  }

  const promptNodeId =
    readString(runCreated?.payload.promptNodeId) ??
    readString(runFailed?.payload.promptNodeId) ??
    getExistingPromptNodeId(existingEdges, existingNodes, targetRunNodeId) ??
    `prompt-${targetRunNodeId}`;
  const prompt =
    readString(runCreated?.payload.prompt) ??
    readString(runFailed?.payload.prompt) ??
    getExistingPrompt(existingNodes, promptNodeId, targetRunNodeId) ??
    "";
  const selectedNodeId =
    readNullableString(runCreated?.payload.selectedNodeId) ??
    readNullableString(runFailed?.payload.selectedNodeId);
  const promptPosition = getExistingPosition(existingNodes, promptNodeId) ??
    getProjectedPromptPosition(existingNodes, selectedNodeId);
  const runPosition =
    getExistingPosition(existingNodes, targetRunNodeId) ??
    {
      x: promptPosition.x,
      y: promptPosition.y + RUN_OFFSET_Y,
    };
  const streamedAgentText = readString(
    streamedAgentTextByRunId?.get(targetRunNodeId)
  );
  const projectedRunStatus = getProjectedRunStatus(orderedEvents);
  const runStatus =
    streamedAgentText && projectedRunStatus === "queued"
      ? "running"
      : projectedRunStatus;
  const toolParts = buildToolParts(orderedEvents, prompt);
  const agentText = buildAgentText(orderedEvents, runStatus, streamedAgentText);
  const directTextResult = readDirectTextResult(orderedEvents);
  const runWasAborted = isAbortedRun(orderedEvents);
  const promptDimensions = getPromptNodeDimensions(prompt);
  const promptNode: AgentCanvasNode = getExistingOrProjectedNode(
    existingNodes,
    promptNodeId,
    {
      height: promptDimensions.height,
      id: promptNodeId,
      type: "promptNode",
      position: promptPosition,
      style: promptDimensions,
      width: promptDimensions.width,
      data: {
        kind: "prompt",
        prompt,
        contextLabel: "Replayed requirement",
        createdAt: runCreated?.createdAt ?? new Date(0).toISOString(),
      },
    }
  );
  const runNode: AgentCanvasNode = getExistingOrProjectedNode(
    existingNodes,
    targetRunNodeId,
    {
      id: targetRunNodeId,
      type: "runNode",
      position: runPosition,
      data: {
        kind: "run",
        prompt,
        status: runStatus,
        agentText,
        toolPart: toolParts.at(-1),
        toolParts,
        stepTimeline: buildStepTimeline(orderedEvents),
        summaryItems: buildRunSummaryItems(orderedEvents),
        traceAvailable: true,
        error: readRunError(orderedEvents),
      },
    }
  );
  const expectedImageRequest = readExpectedImageRequest(orderedEvents, prompt);
  const pendingImageProjection = expectedImageRequest && !runWasAborted
    ? createPendingImageResultNodes(
        runNode,
        expectedImageRequest.count,
        existingNodes,
        {
          request: expectedImageRequest.preview,
          status: runStatus === "error" ? "error" : "loading",
        }
      )
    : { resultNodes: [], resultEdges: [] };
  const pendingImageNodes = [...pendingImageProjection.resultNodes];
  const projectedNodes = [promptNode, runNode];
  const projectedEdges: AgentCanvasEdge[] = [];
  const rejectedPatches: RejectedGraphPatch[] = [];
  const processedArtifactIds = new Set<string>();

  if (selectedNodeId) {
    projectedEdges.push(
      getExistingOrProjectedEdge(existingEdges, selectedNodeId, promptNodeId, {
        id: `edge-${selectedNodeId}-${promptNodeId}`,
        source: selectedNodeId,
        target: promptNodeId,
        type: "temporary",
      })
    );
  }

  projectedEdges.push(
    getExistingOrProjectedEdge(existingEdges, promptNodeId, targetRunNodeId, {
      id: `edge-${promptNodeId}-${targetRunNodeId}`,
      source: promptNodeId,
      target: targetRunNodeId,
      type: "animated",
      data: { active: runStatus === "running" },
    })
  );

  projectedNodes.push(...pendingImageProjection.resultNodes);
  projectedEdges.push(...pendingImageProjection.resultEdges);

  if (directTextResult) {
    const resultPromptNodeId = `prompt-result-${targetRunNodeId}`;
    const resultPromptDimensions = getPromptNodeDimensions(directTextResult.text);
    const resultPromptNode = getExistingOrProjectedNode(
      existingNodes,
      resultPromptNodeId,
      {
        height: resultPromptDimensions.height,
        id: resultPromptNodeId,
        type: "promptNode",
        position: getExistingPosition(existingNodes, resultPromptNodeId) ?? {
          x: runNode.position.x,
          y: runNode.position.y + DIRECT_TEXT_RESULT_OFFSET_Y,
        },
        style: resultPromptDimensions,
        width: resultPromptDimensions.width,
        data: {
          kind: "prompt",
          prompt: directTextResult.text,
          contextLabel: "Agent reply",
          createdAt: directTextResult.createdAt,
        },
      }
    );
    projectedNodes.push(resultPromptNode);
    projectedEdges.push(
      getExistingOrProjectedEdge(existingEdges, targetRunNodeId, resultPromptNodeId, {
        id: `edge-${targetRunNodeId}-${resultPromptNodeId}`,
        source: targetRunNodeId,
        target: resultPromptNodeId,
        type: "animated",
      })
    );
  }

  for (const event of orderedEvents) {
    if (event.type === "artifact.created") {
      const artifact = readArtifactRef(event.payload.artifact);
      if (!artifact) {
        continue;
      }
      if (processedArtifactIds.has(artifact.id)) {
        continue;
      }
      processedArtifactIds.add(artifact.id);

      const existingArtifactNodeId = findArtifactNodeId(existingNodes, artifact.id);
      const pendingImageNode =
        artifact.type === "image" ? pendingImageNodes.shift() : undefined;
      if (
        existingArtifactNodeId &&
        pendingImageNode &&
        pendingImageNode.id !== existingArtifactNodeId
      ) {
        removeProjectedNode(projectedNodes, projectedEdges, pendingImageNode.id);
      }
      const artifactNodeId =
        existingArtifactNodeId ??
        pendingImageNode?.id ??
        readString(event.payload.canvasNodeId) ?? getArtifactNodeId(artifact);
      const artifactNode = createArtifactCanvasNode({
        artifact,
        existingNodes,
        index: projectedNodes.length,
        nodeId: artifactNodeId,
        position: existingArtifactNodeId ? undefined : pendingImageNode?.position,
        request:
          pendingImageNode?.data.kind === "imageResult"
            ? pendingImageNode.data.request
            : undefined,
        runNode,
        sourceEvent: event,
      });
      const existingProjectedIndex = projectedNodes.findIndex(
        (node) => node.id === artifactNode.id
      );
      if (existingProjectedIndex >= 0) {
        projectedNodes[existingProjectedIndex] = artifactNode;
      } else {
        projectedNodes.push(artifactNode);
      }
      projectedEdges.push(
        getExistingOrProjectedEdge(existingEdges, targetRunNodeId, artifactNode.id, {
          id: `edge-${targetRunNodeId}-${artifactNode.id}`,
          source: targetRunNodeId,
          target: artifactNode.id,
          type: "animated",
        })
      );
    }

    if (event.type === "canvas.operation.applied") {
      const patch = readCanvasOperationPatch(event.payload.operation, projectId);
      if (!patch) {
        continue;
      }
      const result = applyGraphPatch(
        { projectId, nodes: projectedNodes, edges: projectedEdges },
        patch
      );
      projectedNodes.splice(0, projectedNodes.length, ...result.state.nodes);
      projectedEdges.splice(0, projectedEdges.length, ...result.state.edges);
      if (result.rejected) {
        rejectedPatches.push(result.rejected);
      }
    }

  }

  return {
    nodes: dedupeNodes(projectedNodes),
    edges: dedupeEdges(
      projectedEdges.filter((edge) =>
        projectedNodes.some((node) => node.id === edge.source) &&
        projectedNodes.some((node) => node.id === edge.target)
      )
    ),
    rejectedPatches,
  };
}

function rejectPatch(
  state: GraphProjectionState,
  patch: GraphPatch,
  reason: string
): GraphPatchResult {
  return {
    state,
    rejected: { patch, reason },
  };
}

function removeProjectedNode(
  nodes: AgentCanvasNode[],
  edges: AgentCanvasEdge[],
  nodeId: string
) {
  const nodeIndex = nodes.findIndex((node) => node.id === nodeId);
  if (nodeIndex >= 0) {
    nodes.splice(nodeIndex, 1);
  }

  for (let index = edges.length - 1; index >= 0; index -= 1) {
    if (edges[index].source === nodeId || edges[index].target === nodeId) {
      edges.splice(index, 1);
    }
  }
}

function findArtifactNodeId(nodes: AgentCanvasNode[], artifactId: string) {
  return nodes.find((node) => getNodeArtifactId(node) === artifactId)?.id;
}

function getNodeArtifactId(node: AgentCanvasNode) {
  if (node.data.kind === "imageResult") {
    return node.data.artifact?.id ?? node.data.image.artifact?.id ?? node.data.image.id;
  }
  if ("artifact" in node.data) {
    return node.data.artifact.id;
  }
  return null;
}

function isValidNode(node: AgentCanvasNode) {
  const expectedType = getNodeTypeForKind(node.data.kind);
  return Boolean(expectedType && node.type === expectedType);
}

function getNodeTypeForKind(kind: AgentCanvasNodeData["kind"]) {
  const nodeTypes: Record<AgentCanvasNodeData["kind"], string> = {
    artifact: "artifactNode",
    code: "codeNode",
    decision: "decisionNode",
    document: "documentNode",
    imageResult: "imageResultNode",
    markdown: "markdownNode",
    memory: "memoryNode",
    prompt: "promptNode",
    run: "runNode",
    shape: "shapeNode",
    stickyNote: "stickyNoteNode",
    toolResult: "toolResultNode",
    webpage: "webpageNode",
  };

  return nodeTypes[kind];
}

function buildToolParts(
  events: RunStepTraceEvent[],
  prompt: string
): CanvasToolPart[] {
  const toolParts = new Map<string, CanvasToolPart>();

  for (const event of events) {
    if (
      event.type !== "tool.input" &&
      event.type !== "tool.output" &&
      event.type !== "tool.error"
    ) {
      continue;
    }

    const toolName = readToolName(event.payload.toolName);
    const toolCallId = readString(event.payload.toolCallId) ?? event.stepId;
    if (!toolName) {
      continue;
    }

    const previous = toolParts.get(toolCallId);
    if (event.type === "tool.input") {
      toolParts.set(toolCallId, {
        ...previous,
        type: `tool-${toolName}`,
        state: "input-available",
        input: event.payload.input ?? previous?.input,
      });
    }

    if (event.type === "tool.output") {
      toolParts.set(toolCallId, {
        ...previous,
        type: `tool-${toolName}`,
        state: "output-available",
        input: previous?.input,
        output: event.payload.output,
      });
    }

    if (event.type === "tool.error") {
      const rawErrorText = event.errorText ?? readString(event.payload.errorText);
      toolParts.set(toolCallId, {
        ...previous,
        type: `tool-${toolName}`,
        state: "output-error",
        input: previous?.input,
        output: previous?.output,
        errorText: summarizeRunError(rawErrorText, {
          errorSource: /generate_image|upscale_image/.test(toolName)
            ? "seedream"
            : "tool",
          toolName,
        }),
      });
    }
  }

  const failure = events.findLast((event) => event.type === "run.failed");
  const errorText = readString(failure?.payload.errorText) ?? failure?.errorText;
  if (!toolParts.size && errorText) {
    toolParts.set("run-failed", {
      type: "tool-runtime",
      state: "output-error",
      input: { prompt },
      errorText: summarizeRunError(errorText, {
        errorCode: readString(failure?.payload.errorCode),
        errorSource: readString(failure?.payload.errorSource),
      }),
    });
  }

  return Array.from(toolParts.values());
}

function buildStepTimeline(events: RunStepTraceEvent[]): RunStepTimelineItem[] {
  const timeline = new Map<string, RunStepTimelineItem>();
  const completed = events.some((event) => event.type === "run.completed");

  for (const event of events) {
    if (event.type === "tool.input" || event.type === "tool.output") {
      const previous = timeline.get(event.stepId);
      timeline.set(event.stepId, {
        id: event.stepId,
        label: previous?.label ?? event.stepId,
        status: event.type === "tool.output" ? "success" : "running",
        startedAt: previous?.startedAt,
        completedAt: event.type === "tool.output" ? event.createdAt : undefined,
        toolName: readString(event.payload.toolName) ?? previous?.toolName,
      });
    }

    if (event.type === "tool.error") {
      const previous = timeline.get(event.stepId);
      timeline.set(event.stepId, {
        id: event.stepId,
        label: previous?.label ?? event.stepId,
        status: "error",
        startedAt: previous?.startedAt,
        completedAt: event.createdAt,
        toolName: readString(event.payload.toolName) ?? previous?.toolName,
        errorText: event.errorText ?? readString(event.payload.errorText),
      });
    }
  }

  return Array.from(timeline.values()).map((step) => {
    if (step.status !== "running") {
      return step;
    }

    if (completed) {
      return { ...step, status: "success" };
    }
    return step;
  });
}

function buildRunSummaryItems(events: RunStepTraceEvent[]): RunSummaryItem[] {
  const items: RunSummaryItem[] = [];
  const agents = events
    .filter((event) => event.type === "agent.active")
    .map((event) => readString(event.payload.agentName))
    .filter((name): name is string => Boolean(name));
  if (agents.length) {
    items.push({
      kind: "agent",
      label: "Agent",
      detail: [...new Set(agents)].join(" -> "),
    });
  }

  const handoffs = events.filter((event) => event.type === "handoff.completed");
  if (handoffs.length) {
    items.push({
      kind: "handoff",
      label: "Handoff",
      detail: handoffs
        .map((event) => readString(event.payload.toAgent) ?? "specialist")
        .join(" -> "),
    });
  }

  const skills = events.flatMap((event) => {
    if (event.type !== "skill.activated") {
      return [];
    }
    const skill = readRecord(event.payload.skill);
    const name = readString(skill?.name);
    return name ? [name] : [];
  });
  if (skills.length) {
    items.push({
      kind: "skill",
      label: "技能",
      detail: [...new Set(skills)].join("，"),
    });
  }

  const artifactTypes = events.flatMap((event) => {
    if (event.type !== "artifact.created") {
      return [];
    }
    const artifact = readRecord(event.payload.artifact);
    const type = readString(artifact?.type);
    return type ? [type] : [];
  });
  if (artifactTypes.length) {
    const counts = new Map<string, number>();
    for (const type of artifactTypes) {
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    const detail = Array.from(counts.entries())
      .map(([type, count]) => `${count} ${humanizeRuntimeLabel(type)}`)
      .join("，");

    items.push({
      kind: "artifact",
      label: "产物",
      detail,
    });
  }

  const appliedOperations = events.filter(
    (event) => event.type === "canvas.operation.applied"
  ).length;
  if (appliedOperations) {
    items.push({
      kind: "canvas",
      label: "画布",
      detail: `${appliedOperations} 项操作`,
    });
  }

  return items;
}

function readExpectedImageRequest(
  events: RunStepTraceEvent[],
  prompt: string
): { count: number; preview: Omit<ImageRequestPreview, "index" | "count"> } | null {
  const generateInput = events
    .filter((event) => event.type === "tool.input")
    .findLast((event) => readToolName(event.payload.toolName) === "generate_image");
  if (!generateInput) {
    return null;
  }
  const input = readRecord(generateInput.payload.input);
  const requestedCount = readNumber(input?.resultCount);
  const imagePrompt = readString(input?.prompt) ?? prompt;
  const explicitWidth = readNumber(input?.width);
  const explicitHeight = readNumber(input?.height);
  const explicitAspectRatio = readString(input?.aspectRatio);

  return {
    count: Math.max(1, requestedCount ? Math.floor(requestedCount) : 1),
    preview:
      explicitWidth && explicitHeight
        ? {
            width: explicitWidth,
            height: explicitHeight,
            aspectRatio: simplifyAspectRatio(explicitWidth, explicitHeight),
          }
        : explicitAspectRatio
          ? { aspectRatio: explicitAspectRatio }
          : readImageRequestPreview(imagePrompt),
  };
}

function readImageRequestPreview(
  prompt: string
): Omit<ImageRequestPreview, "index" | "count"> {
  const dimensions = prompt.match(/\b(\d{3,5})\s*(?:x|×|\*)\s*(\d{3,5})\b/i);
  if (dimensions) {
    return {
      width: Number(dimensions[1]),
      height: Number(dimensions[2]),
      aspectRatio: simplifyAspectRatio(
        Number(dimensions[1]),
        Number(dimensions[2])
      ),
    };
  }

  const ratio = prompt.match(/\b(\d{1,2})\s*[:：]\s*(\d{1,2})\b/);
  if (ratio) {
    return {
      aspectRatio: `${Number(ratio[1])}:${Number(ratio[2])}`,
      size: inferImageAreaFromPrompt(prompt),
    };
  }

  const orientationRatio =
    /(横版|横图|宽屏|landscape|wide)/i.test(prompt)
      ? "16:9"
      : /(竖版|竖图|纵向|portrait|vertical)/i.test(prompt)
        ? "9:16"
        : /(方图|方形|正方形|square)/i.test(prompt)
          ? "1:1"
          : undefined;

  return {
    aspectRatio: orientationRatio,
    size: inferImageAreaFromPrompt(prompt),
  };
}

function inferImageAreaFromPrompt(prompt: string) {
  if (/\b4\s*k\b|4k|4K|４K|４k/.test(prompt)) {
    return 4096 * 4096;
  }
  if (/\b2\s*k\b|2k|2K|２K|２k/.test(prompt)) {
    return 2048 * 2048;
  }
  if (/\b1\s*k\b|1k|1K|１K|１k/.test(prompt)) {
    return 1024 * 1024;
  }

  return undefined;
}

function simplifyAspectRatio(width: number, height: number) {
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }

  return a || 1;
}

function createArtifactCanvasNode({
  artifact,
  existingNodes,
  index,
  nodeId,
  position,
  request,
  runNode,
  sourceEvent,
}: {
  artifact: ArtifactRef;
  existingNodes: AgentCanvasNode[];
  index: number;
  nodeId: string;
  position?: AgentCanvasNode["position"];
  request?: ImageRequestPreview;
  runNode: AgentCanvasNode;
  sourceEvent: RunStepTraceEvent;
}): AgentCanvasNode {
  const title = artifact.title ?? getArtifactFallbackTitle(artifact);
  const basePosition = {
    x: runNode.position.x + (index - 2) * ARTIFACT_NODE_GAP_X,
    y: runNode.position.y + ARTIFACT_NODE_GAP_Y,
  };
  const existingPosition = getExistingPosition(existingNodes, nodeId);

  if (artifact.type === "image" && artifact.uri) {
    const prompt = readArtifactPrompt(sourceEvent, artifact);
    const image: GeneratedImage = {
      id: artifact.id,
      url: artifact.uri,
      title,
      metadata: artifact.metadata,
      artifact,
    };
    const projected = createImageResultNodes(runNode, [image], existingNodes)
      .resultNodes[0];
    const dimensions =
      pendingImageDimensions(position, existingNodes, nodeId) ??
      getImageResultNodeDimensions({ image, request });

    return getExistingOrProjectedNode(existingNodes, nodeId, {
      id: nodeId,
      type: "imageResultNode",
      position: existingPosition ?? position ?? projected?.position ?? basePosition,
      width: dimensions.width,
      height: dimensions.height,
      style: {
        width: dimensions.width,
        height: dimensions.height,
      },
      data: {
        kind: "imageResult",
        artifact,
        image,
        prompt,
        request,
        runId: runNode.id,
        status: "ready",
      },
    });
  }

  const kind = getArtifactNodeKind(artifact);
  const nodeType = getNodeTypeForKind(kind);
  const baseData = {
    artifact,
    createdAt: sourceEvent.createdAt,
    prompt: readArtifactPrompt(sourceEvent, artifact),
    runId: runNode.id,
    summary: getArtifactSummary(artifact),
    title,
  };

  return getExistingOrProjectedNode(existingNodes, nodeId, {
    id: nodeId,
    type: nodeType,
    position: existingPosition ?? basePosition,
    data:
      kind === "markdown"
        ? {
            ...baseData,
            kind,
            content: readMarkdownArtifactContent(artifact) ?? "",
          }
        : kind === "decision"
        ? { ...baseData, kind, decision: baseData.summary ?? title }
        : kind === "memory"
          ? { ...baseData, kind, memory: baseData.summary ?? title }
          : kind === "toolResult"
            ? {
                ...baseData,
                kind,
                toolName: readString(sourceEvent.payload.toolName),
              }
            : kind === "code"
              ? {
                  ...baseData,
                  kind,
                  language: readString(artifact.metadata?.language),
                }
              : kind === "webpage"
                ? {
                    ...baseData,
                    kind,
                    html: readHtmlArtifactContent(artifact),
                    previewUrl: artifact.contentRef ?? artifact.uri,
                  }
              : { ...baseData, kind },
  } as AgentCanvasNode);
}

function pendingImageDimensions(
  position: AgentCanvasNode["position"] | undefined,
  existingNodes: AgentCanvasNode[],
  nodeId: string
) {
  const node = existingNodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.data.kind !== "imageResult" || !position) {
    return null;
  }

  const width = readNodeDimension(node, "width");
  const height = readNodeDimension(node, "height");
  return width && height ? { width, height } : null;
}

function readNodeDimension(
  node: AgentCanvasNode,
  dimension: "height" | "width"
) {
  const styleValue =
    node.style && typeof node.style === "object" ? node.style[dimension] : null;
  const value = node[dimension] ?? styleValue ?? node.measured?.[dimension];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function getExistingOrProjectedNode(
  existingNodes: AgentCanvasNode[],
  nodeId: string,
  projected: AgentCanvasNode
) {
  const existing = existingNodes.find((node) => node.id === nodeId);
  if (!existing) {
    return projected;
  }

  return {
    ...projected,
    position: existing.position,
    selected: existing.selected,
  };
}

function getExistingOrProjectedEdge(
  existingEdges: AgentCanvasEdge[],
  source: string,
  target: string,
  projected: AgentCanvasEdge
) {
  const existing = existingEdges.find(
    (edge) => edge.source === source && edge.target === target
  );
  if (!existing) {
    return projected;
  }

  return {
    ...existing,
    ...projected,
    id: existing.id,
    data: {
      ...existing.data,
      ...projected.data,
    },
  };
}

function getArtifactNodeKind(
  artifact: ArtifactRef
): Exclude<AgentCanvasNodeData["kind"], "prompt" | "run" | "imageResult"> {
  if (artifact.type === "doc" && isMarkdownArtifact(artifact)) {
    return "markdown";
  }
  if (artifact.type === "doc") {
    return "document";
  }
  if (artifact.type === "code") {
    return "code";
  }
  if (artifact.type === "webpage") {
    return "webpage";
  }
  if (artifact.type === "decision") {
    return "decision";
  }
  if (artifact.type === "memory") {
    return "memory";
  }
  if (artifact.type === "tool_result") {
    return "toolResult";
  }

  return "artifact";
}

function getArtifactNodeId(artifact: ArtifactRef) {
  if (artifact.type === "doc") {
    return isMarkdownArtifact(artifact)
      ? `markdown-${artifact.id}`
      : `document-${artifact.id}`;
  }
  if (artifact.type === "tool_result") {
    return `tool-result-${artifact.id}`;
  }

  return `${getArtifactNodeKind(artifact)}-${artifact.id}`;
}

function isMarkdownArtifact(artifact: ArtifactRef) {
  const format = readString(artifact.metadata?.format)?.toLowerCase();
  const mimeType = readString(artifact.metadata?.mimeType)?.toLowerCase();

  return (
    format === "markdown" ||
    format === "md" ||
    mimeType === "text/markdown" ||
    artifact.uri?.endsWith(".md") ||
    artifact.contentRef?.endsWith(".md")
  );
}

function readMarkdownArtifactContent(artifact: ArtifactRef) {
  return (
    readString(artifact.metadata?.markdown) ??
    readString(artifact.metadata?.content) ??
    readString(artifact.metadata?.text) ??
    readString(artifact.metadata?.preview)
  );
}

function readHtmlArtifactContent(artifact: ArtifactRef) {
  return (
    readString(artifact.metadata?.html) ??
    readString(artifact.metadata?.content) ??
    readHtmlFromDataUrl(artifact.contentRef) ??
    readHtmlFromDataUrl(artifact.uri)
  );
}

function readHtmlFromDataUrl(value: string | undefined) {
  if (!value?.startsWith("data:text/html")) {
    return undefined;
  }

  const [, payload = ""] = value.split(",", 2);
  if (!payload) {
    return undefined;
  }

  try {
    return decodeURIComponent(payload);
  } catch {
    return undefined;
  }
}

function getArtifactFallbackTitle(artifact: ArtifactRef) {
  const titles: Record<ArtifactRef["type"], string> = {
    code: "Code artifact",
    dataset: "Dataset",
    decision: "Decision",
    doc: "Document",
    file: "File artifact",
    image: "Generated image",
    memory: "Memory",
    tool_result: "Tool result",
    webpage: "Webpage",
  };

  return titles[artifact.type];
}

function getArtifactSummary(artifact: ArtifactRef) {
  const summary = artifact.metadata?.summary;
  if (typeof summary === "string" && summary.trim()) {
    return summary.trim();
  }

  return artifact.title ?? artifact.contentRef ?? artifact.uri;
}

function getProjectedPromptPosition(
  existingNodes: AgentCanvasNode[],
  selectedNodeId: string | null
) {
  const selectedNode = selectedNodeId
    ? existingNodes.find((node) => node.id === selectedNodeId)
    : undefined;
  if (selectedNode) {
    return {
      x: selectedNode.position.x,
      y: selectedNode.position.y + 310,
    };
  }

  return DEFAULT_PROMPT_POSITION;
}

function getExistingPosition(nodes: AgentCanvasNode[], nodeId: string) {
  return nodes.find((node) => node.id === nodeId)?.position;
}

function getExistingPromptNodeId(
  edges: AgentCanvasEdge[],
  nodes: AgentCanvasNode[],
  runNodeId: string
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return edges
    .filter((edge) => edge.target === runNodeId)
    .map((edge) => nodeById.get(edge.source))
    .find((node) => node?.data.kind === "prompt")?.id;
}

function getExistingPrompt(
  nodes: AgentCanvasNode[],
  promptNodeId: string,
  runNodeId: string
) {
  const promptNode = nodes.find(
    (node) => node.id === promptNodeId && node.data.kind === "prompt"
  );
  if (promptNode?.data.kind === "prompt" && promptNode.data.prompt.trim()) {
    return promptNode.data.prompt;
  }

  const runNode = nodes.find(
    (node) => node.id === runNodeId && node.data.kind === "run"
  );
  if (runNode?.data.kind === "run" && runNode.data.prompt.trim()) {
    return runNode.data.prompt;
  }

  return undefined;
}

function getProjectedRunStatus(events: RunStepTraceEvent[]): AgentRunStatus {
  if (events.some((event) => event.type === "run.failed")) {
    return "error";
  }
  if (events.some((event) => event.type === "run.completed")) {
    return "success";
  }
  if (events.some((event) => event.type !== "run.created")) {
    return "running";
  }

  return "queued";
}

function buildAgentText(
  events: RunStepTraceEvent[],
  status: AgentRunStatus,
  streamedAgentText?: string
): string | undefined {
  const finalOutput = readString(
    events.findLast((event) => event.type === "run.completed")?.payload.finalOutput
  );
  if (finalOutput) {
    return finalOutput;
  }

  if (streamedAgentText) {
    return streamedAgentText;
  }

  if (status === "success") {
    return "已完成，结果已写入画布。";
  }
  if (status === "error") {
    return "运行失败，请查看错误详情。";
  }
  if (events.some((event) => event.type === "tool.input")) {
    return "正在调用工具，结果会自动写入画布。";
  }
  return undefined;
}

function readDirectTextResult(events: RunStepTraceEvent[]) {
  const completed = events.findLast((event) => event.type === "run.completed");
  const finalOutput = readString(completed?.payload.finalOutput);
  if (!finalOutput) {
    return undefined;
  }

  const hasCanvasArtifact = events.some((event) => event.type === "artifact.created");
  const hasAppliedCanvasOperation = events.some(
    (event) => event.type === "canvas.operation.applied"
  );
  const hasToolLifecycle = events.some(
    (event) =>
      event.type === "tool.input" ||
      event.type === "tool.output" ||
      event.type === "tool.error"
  );
  if (hasCanvasArtifact || hasAppliedCanvasOperation || hasToolLifecycle) {
    return undefined;
  }

  return {
    createdAt: completed?.createdAt ?? new Date(0).toISOString(),
    text: finalOutput,
  };
}

function readRunError(events: RunStepTraceEvent[]) {
  const failed = events.find((event) => event.type === "run.failed");
  const detail =
    readString(failed?.payload.errorText) ??
    readString(events.find((event) => event.type === "tool.error")?.errorText);
  const errorCode = readString(failed?.payload.errorCode);
  const errorSource = readString(failed?.payload.errorSource);
  const toolName = readString(
    events.findLast((event) => event.type === "tool.error")?.payload.toolName
  );

  return summarizeRunError(detail, { errorCode, errorSource, toolName });
}

function isAbortedRun(events: RunStepTraceEvent[]) {
  const failed = events.findLast((event) => event.type === "run.failed");
  return readString(failed?.payload.errorCode) === "agent_run_aborted";
}

function summarizeRunError(
  detail: string | undefined,
  {
    errorCode,
    errorSource,
    toolName,
  }: {
    errorCode?: string;
    errorSource?: string;
    toolName?: string;
  } = {}
) {
  if (!detail && !errorCode && !errorSource) {
    return undefined;
  }

  if (errorCode === "agent_run_aborted" || errorSource === "user") {
    return "运行已停止。";
  }
  if (errorCode === "context_validation_failed" || errorSource === "context") {
    return "上下文校验失败。";
  }
  if (errorSource === "canvas_policy") {
    return "画布操作被拒绝。";
  }
  if (errorSource === "skill_script" || errorCode === "skill_script_failed") {
    return "技能脚本失败。";
  }
  if (errorSource === "seedream" || /seedream/i.test(detail ?? "")) {
    return "Seedream 调用失败。";
  }
  if (errorSource === "tool" || toolName) {
    return toolName ? `${humanizeRuntimeLabel(toolName) ?? "工具"} 调用失败。` : "工具调用失败。";
  }
  if (errorSource === "model") {
    return "模型调用失败。";
  }

  return truncateRunError(detail ?? "运行失败。");
}

function truncateRunError(text: string) {
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}

function readToolName(value: unknown) {
  return readString(value) ?? null;
}

function readArtifactRef(value: unknown): ArtifactRef | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const id = readString(candidate.id);
  const type = readArtifactType(candidate.type);
  if (!id || !type) {
    return null;
  }

  return {
    id,
    type,
    uri: readString(candidate.uri),
    title: readString(candidate.title),
    metadata:
      candidate.metadata && typeof candidate.metadata === "object"
        ? (candidate.metadata as Record<string, unknown>)
        : undefined,
    contentRef: readString(candidate.contentRef),
  };
}

function readArtifactPrompt(
  sourceEvent: RunStepTraceEvent,
  artifact: ArtifactRef
) {
  return (
    readString(sourceEvent.payload.prompt) ??
    readString(artifact.metadata?.prompt) ??
    readString(artifact.metadata?.sourcePrompt) ??
    ""
  );
}

function readArtifactType(value: unknown): ArtifactRef["type"] | null {
  if (
    value === "image" ||
    value === "file" ||
    value === "doc" ||
    value === "code" ||
    value === "webpage" ||
    value === "dataset" ||
    value === "decision" ||
    value === "tool_result" ||
    value === "memory"
  ) {
    return value;
  }

  return null;
}

function readGraphPatch(
  value: unknown,
  projectId: string | undefined
): GraphPatch | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as GraphPatch;
  if (
    candidate.type !== "createNode" &&
    candidate.type !== "updateNode" &&
    candidate.type !== "createEdge" &&
    candidate.type !== "setNodeStatus"
  ) {
    return null;
  }

  return {
    ...candidate,
    projectId: candidate.projectId ?? projectId,
  } as GraphPatch;
}

function readCanvasOperationPatch(
  value: unknown,
  projectId: string | undefined
): GraphPatch | null {
  return readGraphPatch(value as CanvasOperation, projectId);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function humanizeRuntimeLabel(value: string | undefined) {
  return value
    ?.replace(/[_:.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function dedupeNodes(nodes: AgentCanvasNode[]) {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    if (seen.has(node.id)) {
      return false;
    }

    seen.add(node.id);
    return true;
  });
}

function dedupeEdges(edges: AgentCanvasEdge[]) {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.source}->${edge.target}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
