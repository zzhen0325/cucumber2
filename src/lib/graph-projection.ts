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
  CanvasAgentMessage,
  ArtifactRef,
  ArtifactPreviewKind,
  CanvasToolPart,
  GeneratedImage,
  ImageRequestPreview,
  RunPlanItem,
  RunNodeData,
  RunStepTimelineItem,
  RunSummaryItem,
} from "../types/canvas";
import type { AgentEvent, CanvasOperation } from "../types/runtime";

const DEFAULT_PROMPT_POSITION = { x: 260, y: 210 };
const RUN_OFFSET_Y = 124;
const ARTIFACT_NODE_GAP_Y = 162;
const ARTIFACT_NODE_GAP_X = 257;

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
  const plan = buildRunPlanItems(orderedEvents, runStatus);
  const stepTimeline = buildStepTimeline(orderedEvents);
  const currentStep = getCurrentRunStep(orderedEvents, runStatus, stepTimeline, plan);
  const agentMessages = buildAgentMessages(orderedEvents);
  const agentText = buildAgentText(
    orderedEvents,
    runStatus,
    streamedAgentText,
    agentMessages
  );
  const outputKind = getRunOutputKind(orderedEvents, runStatus);
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
        agentMessages,
        outputKind,
        currentStep,
        plan,
        toolPart: toolParts.at(-1),
        toolParts,
        stepTimeline,
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
        requests: expectedImageRequest.previews,
        status: runStatus === "error" ? "error" : "loading",
      }
    )
    : { resultNodes: [], resultEdges: [] };
  const pendingImageNodes = [...pendingImageProjection.resultNodes];
  const pendingArtifactProjection = !runWasAborted
    ? createPendingArtifactResultNodes({
        existingNodes,
        requests: readExpectedArtifactRequests(orderedEvents, prompt),
        runNode,
        runStatus,
      })
    : { resultNodes: [], resultEdges: [] };
  const pendingArtifactNodes = [...pendingArtifactProjection.resultNodes];
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
  projectedNodes.push(...pendingArtifactProjection.resultNodes);
  projectedEdges.push(...pendingArtifactProjection.resultEdges);

  for (const event of orderedEvents) {
    if (event.type === "artifact.created") {
      const artifact = readArtifactRef(event.payload.artifact);
      if (!artifact) {
        continue;
      }
      if (isLegacyFinalOutputArtifact(event, artifact)) {
        continue;
      }
      if (processedArtifactIds.has(artifact.id)) {
        continue;
      }
      processedArtifactIds.add(artifact.id);

      const existingArtifactNodeId = findArtifactNodeId(existingNodes, artifact.id);
      const pendingImageNode =
        artifact.type === "image" ? pendingImageNodes.shift() : undefined;
      const pendingArtifactNode =
        artifact.type === "image"
          ? undefined
          : shiftPendingArtifactNodeForArtifact(pendingArtifactNodes, artifact);
      if (
        existingArtifactNodeId &&
        pendingImageNode &&
        pendingImageNode.id !== existingArtifactNodeId
      ) {
        removeProjectedNode(projectedNodes, projectedEdges, pendingImageNode.id);
      }
      if (
        existingArtifactNodeId &&
        pendingArtifactNode &&
        pendingArtifactNode.id !== existingArtifactNodeId
      ) {
        removeProjectedNode(projectedNodes, projectedEdges, pendingArtifactNode.id);
      }
      const artifactNodeId =
        existingArtifactNodeId ??
        pendingImageNode?.id ??
        pendingArtifactNode?.id ??
        readString(event.payload.canvasNodeId) ?? getArtifactNodeId(artifact);
      const artifactNode = createArtifactCanvasNode({
        artifact,
        existingNodes,
        index: projectedNodes.length,
        nodeId: artifactNodeId,
        position: existingArtifactNodeId
          ? undefined
          : pendingImageNode?.position ?? pendingArtifactNode?.position,
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
        toolCallId,
        input: event.payload.input ?? previous?.input,
      });
    }

    if (event.type === "tool.output") {
      toolParts.set(toolCallId, {
        ...previous,
        type: `tool-${toolName}`,
        state: "output-available",
        toolCallId,
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
        toolCallId,
        input: previous?.input,
        output: previous?.output,
        errorText: summarizeRunError(rawErrorText, {
          errorSource: /coze/i.test(rawErrorText ?? "")
            ? "coze"
            : /byteartist/i.test(rawErrorText ?? "")
              ? "byteartist"
            : /generate_image|image_matting|upscale_image/.test(toolName)
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
    if (
      event.type === "run.step.started" ||
      event.type === "run.step.completed" ||
      event.type === "run.step.failed"
    ) {
      const previous = timeline.get(event.stepId);
      const label = readString(event.payload.label) ?? previous?.label ?? event.stepId;
      timeline.set(event.stepId, {
        id: event.stepId,
        label,
        status:
          event.type === "run.step.failed"
            ? "error"
            : event.type === "run.step.completed"
              ? "success"
              : "running",
        startedAt:
          readString(event.payload.startedAt) ??
          previous?.startedAt ??
          event.createdAt,
        completedAt:
          event.type === "run.step.completed"
            ? readString(event.payload.completedAt) ?? event.createdAt
            : event.type === "run.step.failed"
              ? readString(event.payload.failedAt) ?? event.createdAt
              : undefined,
        toolName: previous?.toolName,
        errorText: event.errorText ?? readString(event.payload.errorText),
      });
    }

    if (event.type === "tool.input" || event.type === "tool.output") {
      const previous = timeline.get(event.stepId);
      timeline.set(event.stepId, {
        id: event.stepId,
        label: previous?.label ?? event.stepId,
        status: event.type === "tool.output" ? "success" : "running",
        startedAt: previous?.startedAt ?? event.createdAt,
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
        startedAt: previous?.startedAt ?? event.createdAt,
        completedAt: event.createdAt,
        toolName: readString(event.payload.toolName) ?? previous?.toolName,
        errorText: event.errorText ?? readString(event.payload.errorText),
      });
    }

    if (
      event.type === "skill.script.started" ||
      event.type === "skill.script.completed" ||
      event.type === "skill.script.failed"
    ) {
      const previous = timeline.get(event.stepId);
      const scriptName = readString(event.payload.scriptName) ?? event.stepId;
      timeline.set(event.stepId, {
        id: event.stepId,
        label: scriptName,
        status:
          event.type === "skill.script.failed"
            ? "error"
            : event.type === "skill.script.completed"
              ? "success"
              : "running",
        startedAt: previous?.startedAt ?? event.createdAt,
        completedAt:
          event.type === "skill.script.completed" ||
          event.type === "skill.script.failed"
            ? event.createdAt
            : undefined,
        toolName: scriptName,
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

function buildRunPlanItems(
  events: RunStepTraceEvent[],
  runStatus: AgentRunStatus
): RunPlanItem[] {
  const planEvent = events.findLast((event) => event.type === "run.plan.created");
  if (!planEvent) {
    return [];
  }
  const rawItems = readArray(planEvent?.payload.items).flatMap((item) => {
    const record = readRecord(item);
    const id = readString(record?.id);
    const label = readString(record?.label);
    const phase = readRunPlanPhase(record?.phase);
    return id && label ? [{ id, label, ...(phase ? { phase } : {}) }] : [];
  });
  const failure = events.findLast(
    (event) =>
      event.type === "tool.error" ||
      event.type === "skill.script.failed" ||
      event.type === "run.failed"
  );
  const hasInput = events.some((event) => event.type === "input.normalized");
  const hasRoute = events.some(
    (event) =>
      event.type === "agent.active" ||
      event.type === "handoff.requested" ||
      event.type === "handoff.completed" ||
      event.type === "skill.retrieved"
  );
  const hasExecution = events.some(
    (event) =>
      event.type === "tool.input" ||
      event.type === "tool.output" ||
      event.type === "tool.error" ||
      event.type === "skill.script.started" ||
      event.type === "skill.script.completed" ||
      event.type === "skill.script.failed" ||
      event.type === "artifact.created" ||
      event.type === "canvas.operation.applied"
  );
  const hasMaterialized = events.some(
    (event) =>
      event.type === "artifact.created" ||
      event.type === "canvas.operation.applied" ||
      event.type === "run.completed"
  );

  return rawItems.map((item) => ({
    ...item,
    status: getPlanItemStatus(item.phase ?? item.id, {
      failure,
      hasExecution,
      hasInput,
      hasMaterialized,
      hasRoute,
      runStatus,
    }),
  }));
}

function getPlanItemStatus(
  itemId: string,
  state: {
    failure: RunStepTraceEvent | undefined;
    hasExecution: boolean;
    hasInput: boolean;
    hasMaterialized: boolean;
    hasRoute: boolean;
    runStatus: AgentRunStatus;
  }
): AgentRunStatus {
  if (state.runStatus === "success") {
    return "success";
  }

  if (state.runStatus === "error") {
    if (itemId === "materialize" && state.hasMaterialized) {
      return "success";
    }
    if (itemId === "execute" || itemId === "materialize") {
      return itemId === "execute" ? "error" : "queued";
    }
  }

  if (itemId === "prepare") {
    return state.hasInput ? "success" : "running";
  }
  if (itemId === "route") {
    if (!state.hasInput) {
      return "queued";
    }
    return state.hasRoute || state.hasExecution ? "success" : "running";
  }
  if (itemId === "execute") {
    if (!state.hasRoute && !state.hasExecution) {
      return "queued";
    }
    return state.hasMaterialized ? "success" : "running";
  }
  if (itemId === "materialize") {
    if (!state.hasMaterialized) {
      return "queued";
    }
    return state.failure ? "running" : "success";
  }

  return "queued";
}

function readRunPlanPhase(value: unknown): RunPlanItem["phase"] | undefined {
  const phase = readString(value);
  if (
    phase === "prepare" ||
    phase === "route" ||
    phase === "execute" ||
    phase === "materialize"
  ) {
    return phase;
  }
  return undefined;
}

function getCurrentRunStep(
  events: RunStepTraceEvent[],
  runStatus: AgentRunStatus,
  timeline: RunStepTimelineItem[],
  plan: RunPlanItem[]
): RunStepTimelineItem | undefined {
  const failedStep = timeline.findLast((step) => step.status === "error");
  if (failedStep) {
    return failedStep;
  }
  if (runStatus === "error") {
    return {
      id: "run",
      label: readRunError(events) ?? "运行失败",
      status: "error",
      completedAt: events.findLast((event) => event.type === "run.failed")?.createdAt,
    };
  }
  if (runStatus === "success") {
    return {
      id: "run",
      label: "完成",
      status: "success",
      completedAt: events.findLast((event) => event.type === "run.completed")?.createdAt,
    };
  }

  const runningStep = timeline.findLast((step) => step.status === "running");
  if (runningStep) {
    return runningStep;
  }
  const runningPlan = plan.find((item) => item.status === "running");
  if (runningPlan) {
    return {
      id: runningPlan.id,
      label: runningPlan.label,
      status: "running",
    };
  }

  const queuedPlan = plan.find((item) => item.status === "queued");
  return queuedPlan
    ? {
        id: queuedPlan.id,
        label: queuedPlan.label,
        status: "queued",
      }
    : undefined;
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
): {
  count: number;
  preview: Omit<ImageRequestPreview, "index" | "count">;
  previews?: Array<Omit<ImageRequestPreview, "index" | "count">>;
} | null {
  const generateInput = events
    .filter((event) => event.type === "tool.input")
    .findLast((event) => readToolName(event.payload.toolName) === "generate_image");
  const normalizedImageRequest = readNormalizedImageRequest(events);
  if (!generateInput && events.some((event) => event.type === "artifact.created")) {
    return null;
  }
  if (!generateInput && !normalizedImageRequest) {
    return null;
  }
  if (!generateInput) {
    return normalizedImageRequest;
  }

  const input = readRecord(generateInput.payload.input);
  const requestedCount = readNumber(input?.resultCount);
  const imagePrompt = readString(input?.prompt) ?? prompt;
  const variantPreviews = readImageVariantPreviews(input?.variants);
  if (variantPreviews.length) {
    return {
      count: variantPreviews.length,
      preview: variantPreviews[0],
      previews: variantPreviews,
    };
  }
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

function readExpectedArtifactRequests(
  events: RunStepTraceEvent[],
  prompt: string
): PendingArtifactRequest[] {
  const inputEvent = events.findLast((event) => event.type === "input.normalized");
  const normalizedInput = readRecord(inputEvent?.payload.normalizedInput);
  const artifact = readRecord(normalizedInput?.artifact);
  const kind = readString(artifact?.kind);
  if (!kind || kind === "image" || kind === "canvas") {
    return [];
  }

  const request = pendingRequestFromNormalizedArtifact({
    format: readString(artifact?.format),
    kind,
    prompt,
    subtype: readString(artifact?.subtype),
  });
  return request ? [request] : [];
}

function pendingRequestFromNormalizedArtifact({
  format,
  kind,
  prompt,
  subtype,
}: {
  format?: string;
  kind: string;
  prompt: string;
  subtype?: string;
}): PendingArtifactRequest | null {
  const title = getPendingArtifactTitle({ format, kind, prompt, subtype });
  const summary = "正在生成，结果会自动写入这个节点。";

  if (kind === "markdown" || kind === "document" || kind === "diagram") {
    return {
      artifactType: "doc",
      format: kind === "diagram" ? (format ?? "mermaid") : (format ?? "markdown"),
      kind: "markdown",
      nodeIdPrefix: "markdown",
      previewKind: "markdown",
      summary,
      title,
    };
  }
  if (kind === "code") {
    return {
      artifactType: "code",
      format: format ?? "markdown",
      kind: "code",
      nodeIdPrefix: "code",
      previewKind: "code",
      summary,
      title,
    };
  }
  if (kind === "webpage") {
    return {
      artifactType: "webpage",
      format: format ?? "html",
      kind: "webpage",
      nodeIdPrefix: "webpage",
      previewKind: "webpage",
      summary,
      title,
    };
  }
  if (kind === "data") {
    return {
      artifactType: "dataset",
      format,
      kind: "artifact",
      nodeIdPrefix: "dataset",
      previewKind: "dataset",
      summary,
      title,
    };
  }

  return null;
}

function getPendingArtifactTitle({
  format,
  kind,
  prompt,
  subtype,
}: {
  format?: string;
  kind: string;
  prompt: string;
  subtype?: string;
}) {
  if (kind === "diagram") {
    if (subtype === "sequenceDiagram") {
      return "Sequence diagram";
    }
    if (subtype === "flowchart") {
      return "Flowchart";
    }
    return "Diagram";
  }
  if (kind === "webpage") {
    return format === "html" ? "HTML page" : "Webpage";
  }
  if (kind === "code") {
    return "Code artifact";
  }
  if (kind === "data") {
    return "Dataset";
  }
  const promptTitle = prompt.trim().replace(/\s+/g, " ").slice(0, 42);
  return promptTitle || (kind === "markdown" ? "Markdown document" : "Document");
}

function readNormalizedImageRequest(
  events: RunStepTraceEvent[]
): {
  count: number;
  preview: Omit<ImageRequestPreview, "index" | "count">;
  previews?: Array<Omit<ImageRequestPreview, "index" | "count">>;
} | null {
  const inputEvent = events.findLast((event) => event.type === "input.normalized");
  const normalizedInput = readRecord(inputEvent?.payload.normalizedInput);
  const artifact = readRecord(normalizedInput?.artifact);
  if (readString(artifact?.kind) !== "image") {
    return null;
  }
  const image = readRecord(normalizedInput?.image);
  const dimensions = readRecord(image?.dimensions);
  const width = readNumber(dimensions?.width);
  const height = readNumber(dimensions?.height);
  const aspectRatio = readString(image?.aspectRatio);
  const prompt = readString(image?.contentPrompt) ?? readString(normalizedInput?.rawPrompt) ?? "";
  const variantPreviews = readImageVariantPreviews(image?.variants);
  const count = Math.max(
    1,
    Math.floor(variantPreviews.length || readNumber(image?.resultCount) || 1)
  );
  if (variantPreviews.length) {
    return {
      count: variantPreviews.length,
      preview: variantPreviews[0],
      previews: variantPreviews,
    };
  }

  return {
    count,
    preview:
      width && height
        ? {
            width,
            height,
            aspectRatio: simplifyAspectRatio(width, height),
          }
        : aspectRatio
          ? { aspectRatio }
          : readImageRequestPreview(prompt),
  };
}

function readImageRequestPreview(
  prompt: string
): Omit<ImageRequestPreview, "index" | "count"> {
  const dimensions = prompt.match(/\b(\d{3,5})\s*(?:x|×|\*|-|–|—)\s*(\d{3,5})\b/i);
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

function readImageVariantPreviews(value: unknown) {
  return readArray(value).flatMap((item) => {
    const variant = readRecord(item);
    const width = readNumber(variant?.width);
    const height = readNumber(variant?.height);
    if (!width || !height) {
      return [];
    }
    return [{
      width,
      height,
      aspectRatio: simplifyAspectRatio(width, height),
    }];
  });
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

type PendingArtifactRequest = {
  artifactType: ArtifactRef["type"];
  format?: string;
  kind: PendingArtifactNodeKind;
  nodeIdPrefix: string;
  previewKind?: ArtifactPreviewKind;
  summary: string;
  title: string;
};
type PendingArtifactNodeKind =
  | "artifact"
  | "markdown"
  | "decision"
  | "memory"
  | "toolResult"
  | "document"
  | "code"
  | "webpage";

function createPendingArtifactResultNodes({
  existingNodes,
  requests,
  runNode,
  runStatus,
}: {
  existingNodes: AgentCanvasNode[];
  requests: PendingArtifactRequest[];
  runNode: AgentCanvasNode;
  runStatus: AgentRunStatus;
}) {
  if (!requests.length) {
    return { resultNodes: [], resultEdges: [] };
  }

  const resultNodes: AgentCanvasNode[] = [];
  const resultEdges: AgentCanvasEdge[] = [];
  const baseY = runNode.position.y + ARTIFACT_NODE_GAP_Y;

  requests.forEach((request, index) => {
    const nodeId = `${request.nodeIdPrefix}-pending-${runNode.id}-${index + 1}`;
    const existingPosition = getExistingPosition(existingNodes, nodeId);
    const preferredRect = {
      x: runNode.position.x + index * ARTIFACT_NODE_GAP_X,
      y: baseY,
      width: request.kind === "markdown" || request.kind === "webpage" ? 420 : 240,
      height: request.kind === "markdown" ? 360 : request.kind === "webpage" ? 320 : 132,
    };
    const x = resolvePendingArtifactX(preferredRect, [
      ...existingNodes,
      ...resultNodes,
    ]);
    const artifact = createPendingArtifactRef(runNode, request, index);
    const title =
      runStatus === "error"
        ? `${request.title} 生成失败`
        : request.title;
    const summary =
      runStatus === "error"
        ? "生成失败，请查看 Run 详情。"
        : request.summary;

    resultNodes.push(
      getExistingOrProjectedNode(existingNodes, nodeId, {
        id: nodeId,
        type: getNodeTypeForKind(request.kind),
        position: existingPosition ?? { x, y: preferredRect.y },
        width: preferredRect.width,
        height: preferredRect.height,
        style: {
          width: preferredRect.width,
          height: preferredRect.height,
        },
        data: createPendingArtifactNodeData({
          artifact,
          kind: request.kind,
          runNode,
          summary,
          title,
        }),
      } as AgentCanvasNode)
    );
    resultEdges.push({
      id: `edge-${runNode.id}-${nodeId}`,
      source: runNode.id,
      target: nodeId,
      type: "animated",
    });
  });

  return { resultNodes, resultEdges };
}

function createPendingArtifactNodeData({
  artifact,
  kind,
  runNode,
  summary,
  title,
}: {
  artifact: ArtifactRef;
  kind: PendingArtifactRequest["kind"];
  runNode: AgentCanvasNode;
  summary: string;
  title: string;
}): AgentCanvasNodeData {
  const baseData = {
    artifact,
    prompt: runNode.data.kind === "run" ? runNode.data.prompt : undefined,
    runId: runNode.id,
    summary,
    title,
  };

  if (kind === "markdown") {
    return {
      ...baseData,
      kind,
      content: summary,
    };
  }
  if (kind === "decision") {
    return { ...baseData, kind, decision: summary };
  }
  if (kind === "memory") {
    return { ...baseData, kind, memory: summary };
  }
  if (kind === "toolResult") {
    return { ...baseData, kind };
  }
  if (kind === "code") {
    return {
      ...baseData,
      kind,
      language: readString(artifact.metadata?.language) ?? readString(artifact.metadata?.format),
    };
  }
  if (kind === "webpage") {
    return {
      ...baseData,
      kind,
    };
  }
  return { ...baseData, kind };
}

function createPendingArtifactRef(
  runNode: AgentCanvasNode,
  request: PendingArtifactRequest,
  index: number
): ArtifactRef {
  return {
    id: `pending-${runNode.id}-${request.nodeIdPrefix}-${index + 1}`,
    type: request.artifactType,
    title: request.title,
    summary: request.summary,
    preview: request.summary,
    previewKind: request.previewKind,
    metadata: {
      format: request.format,
      pending: true,
      previewKind: request.previewKind,
      sourceRunNodeId: runNode.id,
      summary: request.summary,
    },
  };
}

function resolvePendingArtifactX(
  preferredRect: {
    height: number;
    width: number;
    x: number;
    y: number;
  },
  nodes: AgentCanvasNode[]
) {
  const rects = nodes.map((node) => ({
    height: readNodeDimension(node, "height") ?? 132,
    width: readNodeDimension(node, "width") ?? 240,
    x: node.position.x,
    y: node.position.y,
  }));
  if (!rects.some((rect) => rectsOverlap(preferredRect, rect))) {
    return preferredRect.x;
  }
  return preferredRect.x + ARTIFACT_NODE_GAP_X;
}

function rectsOverlap(
  left: { height: number; width: number; x: number; y: number },
  right: { height: number; width: number; x: number; y: number }
) {
  return !(
    left.x + left.width < right.x ||
    right.x + right.width < left.x ||
    left.y + left.height < right.y ||
    right.y + right.height < left.y
  );
}

function shiftPendingArtifactNodeForArtifact(
  pendingNodes: AgentCanvasNode[],
  artifact: ArtifactRef
) {
  const targetKind = getArtifactNodeKind(artifact);
  const index = pendingNodes.findIndex((node) => node.data.kind === targetKind);
  if (index < 0) {
    return undefined;
  }
  const [node] = pendingNodes.splice(index, 1);
  return node;
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

function isLegacyFinalOutputArtifact(
  event: RunStepTraceEvent,
  artifact: ArtifactRef
) {
  return (
    readString(event.payload.toolName) === "final_output" ||
    readString(artifact.metadata?.sourceToolName) === "final_output"
  );
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
  streamedAgentText?: string,
  agentMessages: CanvasAgentMessage[] = buildAgentMessages(
    events
  )
): string | undefined {
  const assistantText = formatAgentMessageText(agentMessages, {
    includeProgress: false,
  });
  if (assistantText) {
    return assistantText;
  }

  const finalOutput = readString(
    events.findLast((event) => event.type === "run.completed")?.payload.finalOutput
  );
  if (finalOutput) {
    return finalOutput;
  }

  const persistedText = formatAgentMessageText(agentMessages);
  if (persistedText) {
    return persistedText;
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

function buildAgentMessages(
  events: RunStepTraceEvent[]
): CanvasAgentMessage[] {
  const messages = new Map<
    string,
    CanvasAgentMessage & {
      deltaIndexes: Set<number>;
      order: number;
    }
  >();
  let nextOrder = 0;

  for (const event of events) {
    if (
      event.type !== "agent.message.delta" &&
      event.type !== "agent.message.completed"
    ) {
      continue;
    }

    const messageId =
      readString(event.payload.messageId) ?? `${event.runNodeId}-agent-message`;
    const previous = messages.get(messageId);
    const message =
      previous ??
      ({
        id: messageId,
        role: "assistant",
        content: "",
        kind: readAgentMessageKind(event.payload.messageKind),
        deltaIndexes: new Set<number>(),
        order: nextOrder++,
      } satisfies CanvasAgentMessage & {
        deltaIndexes: Set<number>;
        order: number;
      });
    const agentName = readString(event.payload.agentName);
    if (agentName) {
      message.agentName = agentName;
    }
    const messageKind = readAgentMessageKind(event.payload.messageKind);
    if (messageKind) {
      message.kind = messageKind;
    }

    if (event.type === "agent.message.delta") {
      const delta = readRawString(event.payload.delta);
      const index = readNumber(event.payload.index);
      if (delta && (index === undefined || !message.deltaIndexes.has(index))) {
        message.content += delta;
        if (index !== undefined) {
          message.deltaIndexes.add(index);
        }
      }
      message.status = "streaming";
    }

    if (event.type === "agent.message.completed") {
      const content = readRawString(event.payload.content);
      if (content) {
        message.content = content;
      }
      message.status = "completed";
    }

    messages.set(messageId, message);
  }

  const projectedMessages = Array.from(messages.values())
    .sort((left, right) => left.order - right.order)
    .flatMap((message) => {
      const content = message.content.trim();
      return content
        ? [
            {
              id: message.id,
              role: message.role,
              content,
              agentName: message.agentName,
              kind: message.kind,
              status: message.status,
            },
          ]
        : [];
    });

  return projectedMessages;
}

function formatAgentMessageText(
  messages: CanvasAgentMessage[],
  options: { includeProgress?: boolean } = { includeProgress: true }
) {
  if (!messages.length) {
    return undefined;
  }

  return messages
    .filter((message) => options.includeProgress !== false || message.kind !== "progress")
    .map((message) => {
      const content = message.content.trim();
      if (!content) {
        return "";
      }
      return message.agentName ? `${message.agentName}\n${content}` : content;
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function readAgentMessageKind(value: unknown): CanvasAgentMessage["kind"] {
  const kind = readString(value);
  return kind === "progress" ? "progress" : kind === "assistant" ? "assistant" : undefined;
}

function getRunOutputKind(
  events: RunStepTraceEvent[],
  status: AgentRunStatus
): RunNodeData["outputKind"] {
  if (status !== "success") {
    return undefined;
  }

  const finalOutput = readString(
    events.findLast((event) => event.type === "run.completed")?.payload.finalOutput
  );
  if (!finalOutput) {
    return undefined;
  }

  return hasMaterializedRunOutput(events) ? "artifact" : "simple";
}

function hasMaterializedRunOutput(events: RunStepTraceEvent[]) {
  return events.some((event) => {
    if (event.type === "canvas.operation.applied") {
      return true;
    }
    if (event.type !== "artifact.created") {
      return false;
    }

    const artifact = readArtifactRef(event.payload.artifact);
    return Boolean(artifact && !isLegacyFinalOutputArtifact(event, artifact));
  });
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
  if (
    errorSource === "trace_storage" ||
    errorCode === "agent_trace_persistence_failed"
  ) {
    return "Trace 存储失败。";
  }
  if (errorSource === "skill_script" || errorCode === "skill_script_failed") {
    return "技能脚本失败。";
  }
  const safeDetail = sanitizeRunErrorDetail(detail);
  if (errorSource === "seedream" || /seedream/i.test(detail ?? "")) {
    return safeDetail ? `Seedream 调用失败：${safeDetail}` : "Seedream 调用失败。";
  }
  if (errorSource === "coze" || /coze/i.test(detail ?? "")) {
    return safeDetail ? `Coze 调用失败：${safeDetail}` : "Coze 调用失败。";
  }
  if (errorSource === "byteartist" || /byteartist/i.test(detail ?? "")) {
    return safeDetail
      ? `ByteArtist 调用失败：${safeDetail}`
      : "ByteArtist 调用失败。";
  }
  if (errorSource === "tool" || toolName) {
    const label = toolName ? humanizeRuntimeLabel(toolName) ?? "工具" : "工具";
    return safeDetail ? `${label} 调用失败：${safeDetail}` : `${label} 调用失败。`;
  }
  if (errorSource === "model") {
    return safeDetail ? `模型调用失败：${safeDetail}` : "模型调用失败。";
  }

  return truncateRunError(detail ?? "运行失败。");
}

function truncateRunError(text: string) {
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function sanitizeRunErrorDetail(text: string | undefined) {
  const cleaned = text
    ?.replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "[image]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? truncateRunError(cleaned) : "";
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

function readRawString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
