import {
  createHtmlPageNodes,
  createImageResultNodes,
  createMarkdownDocumentNodes,
  createPendingImageResultNodes,
  extractHtmlPagesFromToolOutput,
  extractImagesFromToolOutput,
  extractMarkdownDocumentsFromToolOutput,
} from "@/lib/graph";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  AgentCanvasNodeData,
  AgentRunStatus,
  ArtifactRef,
  CanvasToolPart,
  GeneratedImage,
  ImageRequestPreview,
  RunEvaluationSummary,
  RunStepTimelineItem,
  RunSummaryItem,
} from "@/types/canvas";
import type { RuntimeEvent } from "@/types/runtime";

const DEFAULT_PROMPT_POSITION = { x: 260, y: 210 };
const RUN_OFFSET_Y = 124;
const ARTIFACT_NODE_GAP_Y = 162;
const ARTIFACT_NODE_GAP_X = 257;

export type RunStepTraceEvent = RuntimeEvent;

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
  | {
      id: string;
      projectId?: string;
      type: "attachArtifact";
      payload: { nodeId: string; artifact: ArtifactRef };
    };

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

  const existing =
    state.nodes.find((node) => node.id === patch.payload.nodeId) ??
    findNodeByArtifactId(state.nodes, patch.payload.artifact.id);
  if (!existing) {
    return rejectPatch(state, patch, "missing_node");
  }

  return {
    state: {
      ...state,
      nodes: state.nodes.map((node) =>
        node.id === existing.id
          ? attachArtifactToNode(node, patch.payload.artifact)
          : node
      ),
    },
  };
}

export function projectToolOutputToCanvas(
  runNode: AgentCanvasNode,
  output: unknown,
  existingNodes: AgentCanvasNode[]
) {
  const images = extractImagesFromToolOutput(output);
  const imageProjection = createImageResultNodes(runNode, images, existingNodes);
  const markdownDocuments = extractMarkdownDocumentsFromToolOutput(output);
  const markdownProjection = createMarkdownDocumentNodes(
    runNode,
    markdownDocuments,
    [...existingNodes, ...imageProjection.resultNodes]
  );
  const htmlPages = extractHtmlPagesFromToolOutput(output);
  const htmlProjection = createHtmlPageNodes(
    runNode,
    htmlPages,
    [
      ...existingNodes,
      ...imageProjection.resultNodes,
      ...markdownProjection.resultNodes,
    ]
  );

  return {
    resultNodes: [
      ...imageProjection.resultNodes,
      ...markdownProjection.resultNodes,
      ...htmlProjection.resultNodes,
    ],
    resultEdges: [
      ...imageProjection.resultEdges,
      ...markdownProjection.resultEdges,
      ...htmlProjection.resultEdges,
    ],
  };
}

export function projectRunTraceToCanvas({
  events,
  existingNodes = [],
  existingEdges = [],
  projectId,
  runNodeId,
}: {
  events: RunStepTraceEvent[];
  existingNodes?: AgentCanvasNode[];
  existingEdges?: AgentCanvasEdge[];
  projectId?: string;
  runNodeId?: string;
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
  const runStatus = getProjectedRunStatus(orderedEvents);
  const toolParts = buildToolParts(orderedEvents, prompt);
  const promptNode: AgentCanvasNode = getExistingOrProjectedNode(
    existingNodes,
    promptNodeId,
    {
      id: promptNodeId,
      type: "promptNode",
      position: promptPosition,
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
        toolPart: toolParts.at(-1),
        toolParts,
        stepTimeline: buildStepTimeline(orderedEvents),
        evaluation: readEvaluationSummary(orderedEvents),
        summaryItems: buildRunSummaryItems(orderedEvents),
        traceAvailable: true,
        error: readRunError(orderedEvents),
      },
    }
  );
  const expectedImageRequest = readExpectedImageRequest(orderedEvents, prompt);
  const pendingImageProjection = expectedImageRequest
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

  for (const event of orderedEvents) {
    if (event.type === "artifact.created") {
      const artifact = readArtifactRef(event.payload.artifact);
      if (!artifact) {
        continue;
      }

      const pendingImageNode =
        artifact.type === "image" ? pendingImageNodes.shift() : undefined;
      const artifactNodeId =
        pendingImageNode?.id ??
        readString(event.payload.canvasNodeId) ?? getArtifactNodeId(artifact);
      const artifactNode = createArtifactCanvasNode({
        artifact,
        existingNodes,
        index: projectedNodes.length,
        nodeId: artifactNodeId,
        position: pendingImageNode?.position,
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

    if (event.type === "graph.patch.applied") {
      const patch = readGraphPatch(event.payload.patch, projectId);
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
    toolResult: "toolResultNode",
    webpage: "webpageNode",
  };

  return nodeTypes[kind];
}

function attachArtifactToNode(
  node: AgentCanvasNode,
  artifact: ArtifactRef
): AgentCanvasNode {
  if (node.data.kind === "imageResult") {
    return {
      ...node,
      data: {
        ...node.data,
        artifact,
        image: {
          ...node.data.image,
          artifact,
          url: artifact.uri ?? node.data.image.url,
        },
        status: artifact.uri ? "ready" : node.data.status,
      },
    };
  }

  if ("artifact" in node.data) {
    return {
      ...node,
      data: {
        ...node.data,
        artifact,
      },
    };
  }

  return node;
}

function findNodeByArtifactId(
  nodes: AgentCanvasNode[],
  artifactId: string | undefined
) {
  if (!artifactId) {
    return undefined;
  }

  return nodes.find((node) => {
    if (node.data.kind === "imageResult") {
      return (
        node.data.artifact?.id === artifactId ||
        node.data.image.artifact?.id === artifactId ||
        node.data.image.id === artifactId
      );
    }

    return "artifact" in node.data && node.data.artifact.id === artifactId;
  });
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
        state:
          event.payload.state === "approval-requested"
            ? "approval-requested"
            : "input-available",
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
      toolParts.set(toolCallId, {
        ...previous,
        type: `tool-${toolName}`,
        state:
          event.payload.state === "output-denied"
            ? "output-denied"
            : "output-error",
        input: previous?.input,
        output: previous?.output,
        errorText: event.errorText ?? readString(event.payload.errorText),
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
      errorText,
    });
  }

  return Array.from(toolParts.values());
}

function buildStepTimeline(events: RunStepTraceEvent[]): RunStepTimelineItem[] {
  const timeline = new Map<string, RunStepTimelineItem>();
  const failedStepId = readNullableString(
    events.find((event) => event.type === "run.failed")?.payload.failedStepId
  );
  const completed = events.some((event) => event.type === "run.completed");

  for (const event of events) {
    if (event.type === "step.started") {
      timeline.set(event.stepId, {
        id: event.stepId,
        label: readString(event.payload.label) ?? event.stepId,
        status: "running",
        startedAt: event.createdAt,
      });
    }

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
    if (failedStepId && step.id !== failedStepId) {
      return { ...step, status: "success" };
    }

    return step;
  });
}

function readEvaluationSummary(
  events: RunStepTraceEvent[]
): RunEvaluationSummary | undefined {
  const event = events.findLast(
    (candidate) => candidate.type === "evaluation.completed"
  );
  const evaluation = readRecord(event?.payload.evaluation);
  if (!evaluation) {
    return undefined;
  }

  const issues = Array.isArray(evaluation.issues) ? evaluation.issues : [];
  const recommendedActions = Array.isArray(evaluation.recommendedActions)
    ? evaluation.recommendedActions.filter(
        (action): action is string => typeof action === "string" && action.length > 0
      )
    : [];

  return {
    passed: evaluation.passed === true,
    issueCount: issues.length,
    recommendedActions,
    needsRegeneration: evaluation.needsRegeneration === true,
  };
}

function buildRunSummaryItems(events: RunStepTraceEvent[]): RunSummaryItem[] {
  const items: RunSummaryItem[] = [];
  const intent = readIntentSummary(events);
  const context = readContextSummary(events);
  const plan = readPlanSummary(events);
  const artifact = readArtifactSummary(events);

  if (intent) {
    items.push(intent);
  }
  if (context) {
    items.push(context);
  }
  if (plan) {
    items.push(plan);
  }
  if (artifact) {
    items.push(artifact);
  }

  return items;
}

function readIntentSummary(events: RunStepTraceEvent[]): RunSummaryItem | undefined {
  const event = events.find((candidate) => candidate.type === "intent.routed");
  const intent = readRecord(event?.payload.intent);
  const task = readRecord(intent?.task);
  const taskKind = readString(task?.kind);
  const primaryIntent = readString(intent?.primaryIntent);
  const label = humanizeRuntimeLabel(taskKind ?? primaryIntent);
  if (!label) {
    return undefined;
  }

  return {
    kind: "intent",
    label: "意图",
    detail: label,
  };
}

function readContextSummary(events: RunStepTraceEvent[]): RunSummaryItem | undefined {
  const event = events.find((candidate) => candidate.type === "context.built");
  const context = readRecord(event?.payload.context);
  const trace = readRecord(context?.trace);
  const selectedItems = Array.isArray(context?.selectedItems)
    ? context.selectedItems
    : [];
  const omittedItems = Array.isArray(context?.omittedItems)
    ? context.omittedItems
    : [];
  const selectedCount = readNumber(trace?.selectedCount) ?? selectedItems.length;
  const omittedCount = readNumber(trace?.omittedCount) ?? omittedItems.length;
  if (!selectedCount && !omittedCount) {
    return undefined;
  }

  return {
    kind: "context",
    label: "上下文",
    detail: omittedCount
      ? `${selectedCount} 项，省略 ${omittedCount} 项`
      : `${selectedCount} 项`,
  };
}

function readPlanSummary(events: RunStepTraceEvent[]): RunSummaryItem | undefined {
  const event = events.find((candidate) => candidate.type === "plan.created");
  const rawPlan = Array.isArray(event?.payload.rawPlan) ? event.payload.rawPlan : [];
  const normalizedPlan = Array.isArray(event?.payload.normalizedPlan)
    ? event.payload.normalizedPlan
    : [];
  const steps = normalizedPlan.length ? normalizedPlan : rawPlan;
  if (!steps.length) {
    return undefined;
  }

  const stepTitles = steps
    .map((step) => readString(readRecord(step)?.title))
    .filter((title): title is string => Boolean(title))
    .slice(0, 2)
    .map(humanizeRuntimeLabel)
    .filter((title): title is string => Boolean(title));

  return {
    kind: "plan",
    label: "计划",
    detail: stepTitles.length
      ? `${steps.length} 步：${stepTitles.join(" / ")}`
      : `${steps.length} 步`,
  };
}

function readArtifactSummary(events: RunStepTraceEvent[]): RunSummaryItem | undefined {
  const artifactTypes = events.flatMap((event) => {
    if (event.type !== "artifact.created") {
      return [];
    }
    const artifact = readRecord(event.payload.artifact);
    const type = readString(artifact?.type);
    return type ? [type] : [];
  });
  if (!artifactTypes.length) {
    return undefined;
  }

  const counts = new Map<string, number>();
  for (const type of artifactTypes) {
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const detail = Array.from(counts.entries())
    .map(([type, count]) => `${count} ${humanizeRuntimeLabel(type)}`)
    .join("，");

  return {
    kind: "artifact",
    label: "产物",
    detail,
  };
}

function readExpectedImageRequest(
  events: RunStepTraceEvent[],
  prompt: string
): { count: number; preview: Omit<ImageRequestPreview, "index" | "count"> } | null {
  const intentEvent = events.findLast(
    (candidate) => candidate.type === "intent.routed"
  );
  const intent = readRecord(intentEvent?.payload.intent);
  const intentLooksLikeImage = isImageGenerationIntent(intent);
  const count =
    readImageCountFromIntent(intent) ??
    readImageCountFromPlan(events) ??
    readImageCountFromGenerateInput(events) ??
    (intentLooksLikeImage ? inferImageCountFromPrompt(prompt) : undefined);

  if (!intentLooksLikeImage && !readImageCountFromGenerateInput(events)) {
    return null;
  }

  return {
    count: Math.max(1, count ?? 1),
    preview: readImageRequestPreview(prompt),
  };
}

function isImageGenerationIntent(intent: Record<string, unknown> | null) {
  const task = readRecord(intent?.task);
  const requiredTools = Array.isArray(intent?.requiredTools)
    ? intent.requiredTools
    : [];

  return (
    intent?.primaryIntent === "image_generation" ||
    task?.kind === "image_generation" ||
    task?.kind === "image_editing" ||
    requiredTools.includes("seedream.generateImage") ||
    requiredTools.includes("generate_image")
  );
}

function readImageCountFromIntent(intent: Record<string, unknown> | null) {
  const task = readRecord(intent?.task);
  const deliverables = Array.isArray(task?.deliverables)
    ? task.deliverables
    : [];
  const count = deliverables.reduce((total, deliverable) => {
    const record = readRecord(deliverable);
    if (record?.kind !== "image") {
      return total;
    }

    return total + Math.max(1, readNumber(record.count) ?? 1);
  }, 0);

  return count > 0 ? count : undefined;
}

function readImageCountFromPlan(events: RunStepTraceEvent[]) {
  const planEvent = events.findLast((event) => event.type === "plan.created");
  const steps = Array.isArray(planEvent?.payload.normalizedPlan)
    ? planEvent.payload.normalizedPlan
    : Array.isArray(planEvent?.payload.rawPlan)
      ? planEvent.payload.rawPlan
      : [];
  const count = steps.reduce((total, step) => {
    const record = readRecord(step);
    const expectedArtifacts = Array.isArray(record?.expectedArtifacts)
      ? record.expectedArtifacts
      : [];

    return (
      total +
      expectedArtifacts.reduce((artifactTotal, artifact) => {
        const artifactRecord = readRecord(artifact);
        if (artifactRecord?.type !== "image") {
          return artifactTotal;
        }

        return artifactTotal + Math.max(1, readNumber(artifactRecord.count) ?? 1);
      }, 0)
    );
  }, 0);

  return count > 0 ? count : undefined;
}

function readImageCountFromGenerateInput(events: RunStepTraceEvent[]) {
  const toolInput = events
    .filter((event) => event.type === "tool.input")
    .findLast((event) => readToolName(event.payload.toolName) === "generate_image");
  const input = readRecord(toolInput?.payload.input);
  const count = readNumber(input?.resultCount);

  return count && count > 0 ? Math.floor(count) : undefined;
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

function inferImageCountFromPrompt(prompt: string) {
  const arabicMatch = prompt.match(
    /(?:生成|出|要|做|给我|create|generate|make)?\s*(\d{1,2})\s*(?:张|幅|个|款|版|组|images?|imgs?|pictures?|results?)/i
  );
  if (arabicMatch) {
    return Number(arabicMatch[1]);
  }

  const chineseMatch = prompt.match(
    /(?:生成|出|要|做|给我)?\s*([一二两三四五六七八九十])\s*(?:张|幅|个|款|版|组|图片|图|结果)/
  );
  if (chineseMatch) {
    return chineseImageCountToNumber(chineseMatch[1]) ?? 1;
  }

  return 1;
}

function chineseImageCountToNumber(value: string) {
  const numbers: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };

  return numbers[value];
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
    const image: GeneratedImage = {
      id: artifact.id,
      url: artifact.uri,
      title,
      metadata: artifact.metadata,
      artifact,
    };
    const projected = createImageResultNodes(runNode, [image], existingNodes)
      .resultNodes[0];

    return getExistingOrProjectedNode(existingNodes, nodeId, {
      id: nodeId,
      type: "imageResultNode",
      position: existingPosition ?? position ?? projected?.position ?? basePosition,
      data: {
        kind: "imageResult",
        artifact,
        image,
        prompt: readString(sourceEvent.payload.prompt) ?? "",
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
    prompt: readString(sourceEvent.payload.prompt),
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
    readString(artifact.metadata?.text)
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

function readRunError(events: RunStepTraceEvent[]) {
  const failed = events.find((event) => event.type === "run.failed");
  return (
    readString(failed?.payload.errorText) ??
    readString(events.find((event) => event.type === "tool.error")?.errorText)
  );
}

function readToolName(value: unknown) {
  if (
    value === "analyze_reference_images" ||
    value === "expand_prompt" ||
    value === "generate_image" ||
    value === "generate_html" ||
    value === "web.read" ||
    value === "asset.analyze_context" ||
    value === "web_search" ||
    value === "write_document"
  ) {
    return value;
  }

  return null;
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
    candidate.type !== "setNodeStatus" &&
    candidate.type !== "attachArtifact"
  ) {
    return null;
  }

  return {
    ...candidate,
    projectId: candidate.projectId ?? projectId,
  } as GraphPatch;
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
