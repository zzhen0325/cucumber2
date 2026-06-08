import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  ArtifactRef,
  CanvasToolPart,
  GeneratedHtmlPage,
  GeneratedImage,
  ImageRequestPreview,
  ImageResultStatus,
  RunDraft,
  RunNodeData,
  UpstreamContextItem,
  UpstreamContextType,
} from "@/types/canvas";

const NODE_WIDTH = 240;
const PROMPT_NODE_HEIGHT = 84;
const COMPACT_RUN_NODE_HEIGHT = 36;
const RUN_NODE_HEIGHT = 300;
const RESULT_NODE_HEIGHT = 240;
const MARKDOWN_NODE_WIDTH = 420;
const MARKDOWN_NODE_HEIGHT = 360;
const WEBPAGE_NODE_WIDTH = 420;
const WEBPAGE_NODE_HEIGHT = 320;
const ARTIFACT_NODE_HEIGHT = 132;
const RESULT_GAP = 17;
const NODE_CLEARANCE = 24;
const ROOT_START_X = 260;
const ROOT_START_Y = 210;
const ROOT_CHAIN_GAP = 320;
const FOLLOW_UP_GAP_X = 262;
const FOLLOW_UP_GAP_Y = 310;
const RUN_OFFSET_Y = 124;
const RESULT_OFFSET_FROM_PROMPT_Y = 200;
const EXPANDED_RESULT_OFFSET_FROM_PROMPT_Y = 480;

const id = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type CanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GeneratedMarkdownDocument = {
  id: string;
  title: string;
  content: string;
  summary?: string;
  artifact?: ArtifactRef;
};

export type { GeneratedHtmlPage };

export type ContextCollectionTrace = {
  selectedNodeId: string | null;
  budget?: number;
  omittedContextReason?: string;
  omittedNodeIds: string[];
};

export type UpstreamContextCollection = {
  items: UpstreamContextItem[];
  omittedItems: UpstreamContextItem[];
  trace: ContextCollectionTrace;
};

export const isImageResultNode = (node?: AgentCanvasNode) =>
  node?.data.kind === "imageResult";

export function getRunReferenceNodeId(node?: AgentCanvasNode) {
  if (!node || node.data.kind === "run") {
    return null;
  }
  if (
    node.data.kind === "imageResult" &&
    (node.data.status === "loading" || node.data.status === "error")
  ) {
    return null;
  }

  return node.id;
}

export function getRunRevisionAnchorNodeId(
  runNodeId: string,
  nodes: AgentCanvasNode[],
  edges: AgentCanvasEdge[]
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const resultCandidates = edges
    .filter((edge) => edge.source === runNodeId)
    .map((edge) => nodeById.get(edge.target))
    .filter((node): node is AgentCanvasNode => Boolean(getRunReferenceNodeId(node)))
    .sort((left, right) => getRevisionAnchorPriority(right) - getRevisionAnchorPriority(left));

  if (resultCandidates[0]) {
    return resultCandidates[0].id;
  }

  return (
    edges
      .filter((edge) => edge.target === runNodeId)
      .map((edge) => nodeById.get(edge.source))
      .find((node): node is AgentCanvasNode => Boolean(getRunReferenceNodeId(node)))
      ?.id ?? null
  );
}

export function buildRunRevisionPrompt(run: RunNodeData) {
  const recommendation = run.evaluation?.recommendedActions[0]?.trim();
  const action = run.evaluation?.needsRegeneration ? "重新生成" : "修正";

  return [
    `根据质量检查建议${action}。`,
    recommendation ? `建议：${recommendation}` : null,
    `原始需求：${run.prompt}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function collectUpstreamContext(
  selectedNodeId: string | null,
  nodes: AgentCanvasNode[],
  edges: AgentCanvasEdge[],
  options: { budget?: number } = {}
): UpstreamContextItem[] {
  return collectUpstreamContextWithTrace(
    selectedNodeId,
    nodes,
    edges,
    options
  ).items;
}

export function collectUpstreamContextWithTrace(
  selectedNodeId: string | null,
  nodes: AgentCanvasNode[],
  edges: AgentCanvasEdge[],
  options: { budget?: number } = {}
): UpstreamContextCollection {
  if (!selectedNodeId) {
    return {
      items: [],
      omittedItems: [],
      trace: {
        selectedNodeId: null,
        budget: options.budget,
        omittedNodeIds: [],
      },
    };
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map<string, string[]>();

  for (const edge of edges) {
    const incoming = incomingByTarget.get(edge.target) ?? [];
    incoming.push(edge.source);
    incomingByTarget.set(edge.target, incoming);
  }

  const ordered: AgentCanvasNode[] = [];
  const seen = new Set<string>();

  const visit = (nodeId: string) => {
    if (seen.has(nodeId)) {
      return;
    }
    seen.add(nodeId);

    for (const sourceId of incomingByTarget.get(nodeId) ?? []) {
      visit(sourceId);
    }

    const node = byId.get(nodeId);
    if (node) {
      ordered.push(node);
    }
  };

  visit(selectedNodeId);

  const collected = ordered.flatMap((node) =>
    contextItemsFromNode(node, node.id === selectedNodeId)
  );
  const { selected, omitted } = selectContextWithinBudget(
    collected,
    options.budget,
    selectedNodeId
  );

  return {
    items: selected,
    omittedItems: omitted,
    trace: {
      selectedNodeId,
      budget: options.budget,
      omittedContextReason: omitted.length ? "context_budget_exceeded" : undefined,
      omittedNodeIds: omitted.map((item) => item.nodeId),
    },
  };
}

export function createRunDraft(
  prompt: string,
  selectedNodeId: string | null,
  nodes: AgentCanvasNode[],
  edges: AgentCanvasEdge[]
): RunDraft {
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const referenceNodeId = getRunReferenceNodeId(selectedNode);
  const referenceNode = referenceNodeId ? selectedNode : undefined;
  const siblings = referenceNodeId
    ? edges.filter((edge) => edge.source === referenceNodeId).length
    : nodes.filter((node) => node.data.kind === "prompt").length;

  const contextCollection = collectUpstreamContextWithTrace(
    referenceNodeId,
    nodes,
    edges
  );
  const upstreamContext = contextCollection.items;
  const preferredBaseX = referenceNode
    ? referenceNode.position.x + siblings * FOLLOW_UP_GAP_X
    : ROOT_START_X + siblings * ROOT_CHAIN_GAP;
  const baseY = referenceNode
    ? referenceNode.position.y + FOLLOW_UP_GAP_Y
    : ROOT_START_Y;
  const baseX = resolveNonOverlappingX(
    {
      x: preferredBaseX,
      y: baseY,
      width: NODE_WIDTH,
      height: RUN_OFFSET_Y + RUN_NODE_HEIGHT,
    },
    nodes
  );
  const promptId = id("prompt");
  const runId = id("run");
  const createdAt = new Date().toISOString();

  const promptNode: AgentCanvasNode = {
    id: promptId,
    type: "promptNode",
    position: { x: baseX, y: baseY },
    data: {
      kind: "prompt",
      prompt,
      contextLabel: upstreamContext.length
        ? `${upstreamContext.length} upstream items`
        : "Root requirement",
      createdAt,
    },
  };

  const runNode: AgentCanvasNode = {
    id: runId,
    type: "runNode",
    position: { x: baseX, y: baseY + RUN_OFFSET_Y },
    data: {
      kind: "run",
      prompt,
      status: "queued",
      traceAvailable: true,
      toolPart: getInitialRunToolPart(prompt, upstreamContext),
      toolParts: [getInitialRunToolPart(prompt, upstreamContext)],
    },
  };

  const draftEdges: AgentCanvasEdge[] = [
    {
      id: id("edge"),
      source: promptId,
      target: runId,
      type: "animated",
      data: { active: true },
    },
  ];

  if (referenceNodeId) {
    draftEdges.unshift({
      id: id("edge"),
      source: referenceNodeId,
      target: promptId,
      type: "temporary",
    });
  }

  return {
    promptNode,
    runNode,
    edges: draftEdges,
    upstreamContext,
    omittedContext: contextCollection.omittedItems,
    contextTrace: contextCollection.trace,
  };
}

export function createImageResultNodes(
  runNode: AgentCanvasNode,
  images: GeneratedImage[],
  existingNodes: AgentCanvasNode[]
) {
  const alreadyRendered = new Set(
    existingNodes.flatMap((node) =>
      node.data.kind === "imageResult" ? [node.data.image.id] : []
    )
  );
  const visibleImages = images.filter((image) => !alreadyRendered.has(image.id));

  return createAlignedImageResultNodes(
    runNode,
    visibleImages.map((image) => ({
      id: `image-${image.id}`,
      image,
      artifact: image.artifact,
      status: "ready" as const,
    })),
    existingNodes
  );
}

export function createPendingImageResultNodes(
  runNode: AgentCanvasNode,
  count: number,
  existingNodes: AgentCanvasNode[],
  options: {
    request?: Omit<ImageRequestPreview, "index" | "count">;
    status?: ImageResultStatus;
  } = {}
) {
  const safeCount = Math.max(0, Math.floor(count));
  const status = options.status ?? "loading";
  const pendingImages = Array.from({ length: safeCount }, (_, index) => {
    const imageId = `pending-${runNode.id}-${index + 1}`;
    const request = {
      ...options.request,
      index: index + 1,
      count: safeCount,
    };

    return {
      id: `image-${imageId}`,
      image: {
        id: imageId,
        url: "",
        title:
          status === "error"
            ? `生成失败 ${index + 1}/${safeCount}`
            : `生成中 ${index + 1}/${safeCount}`,
        metadata: { request },
      },
      request,
      status,
    };
  });

  return createAlignedImageResultNodes(runNode, pendingImages, existingNodes);
}

function createAlignedImageResultNodes(
  runNode: AgentCanvasNode,
  results: Array<{
    id: string;
    image: GeneratedImage;
    artifact?: ArtifactRef;
    request?: ImageRequestPreview;
    status?: ImageResultStatus;
  }>,
  existingNodes: AgentCanvasNode[]
) {
  const resultOffset =
    runNode.data.kind === "run" &&
    (runNode.data.status !== "queued" ||
      runNode.data.toolPart?.state !== "input-streaming")
      ? EXPANDED_RESULT_OFFSET_FROM_PROMPT_Y
      : RESULT_OFFSET_FROM_PROMPT_Y;
  const preferredStartX =
    runNode.position.x -
    ((results.length - 1) * (NODE_WIDTH + RESULT_GAP)) / 2;
  const y = runNode.position.y + resultOffset - RUN_OFFSET_Y;
  const startX = resolveNonOverlappingX(
    {
      x: preferredStartX,
      y,
      width:
        results.length * NODE_WIDTH +
        Math.max(results.length - 1, 0) * RESULT_GAP,
      height: RESULT_NODE_HEIGHT,
    },
    existingNodes
  );

  const resultNodes: AgentCanvasNode[] = results.map((result, index) => ({
    id: result.id,
    type: "imageResultNode",
    position:
      getExistingPosition(existingNodes, result.id) ??
      { x: startX + index * (NODE_WIDTH + RESULT_GAP), y },
    data: {
      kind: "imageResult",
      image: result.image,
      artifact: result.artifact,
      prompt: runNode.data.kind === "run" ? runNode.data.prompt : "",
      runId: runNode.id,
      request: result.request,
      status: result.status,
    },
  }));

  const resultEdges: AgentCanvasEdge[] = resultNodes.map((node) => ({
    id: `edge-${runNode.id}-${node.id}`,
    source: runNode.id,
    target: node.id,
    type: "animated",
  }));

  return { resultNodes, resultEdges };
}

function getExistingPosition(nodes: AgentCanvasNode[], nodeId: string) {
  return nodes.find((node) => node.id === nodeId)?.position;
}

export function createMarkdownDocumentNodes(
  runNode: AgentCanvasNode,
  documents: GeneratedMarkdownDocument[],
  existingNodes: AgentCanvasNode[]
) {
  const alreadyRendered = new Set(
    existingNodes.flatMap((node) => {
      if (node.data.kind !== "markdown") {
        return [];
      }

      return [node.data.artifact?.id ?? node.id.replace(/^markdown-/, "")];
    })
  );
  const visibleDocuments = documents.filter(
    (document) =>
      document.content.trim() &&
      !alreadyRendered.has(document.artifact?.id ?? document.id)
  );

  const resultNodes: AgentCanvasNode[] = [];
  const resultEdges: AgentCanvasEdge[] = [];

  for (const document of visibleDocuments) {
    const nodeId = `markdown-${safeNodeId(document.artifact?.id ?? document.id)}`;
    const preferredRect = {
      x: runNode.position.x - (MARKDOWN_NODE_WIDTH - NODE_WIDTH) / 2,
      y: runNode.position.y + EXPANDED_RESULT_OFFSET_FROM_PROMPT_Y - RUN_OFFSET_Y,
      width: MARKDOWN_NODE_WIDTH,
      height: MARKDOWN_NODE_HEIGHT,
    };
    const x = resolveNonOverlappingX(preferredRect, [
      ...existingNodes,
      ...resultNodes,
    ]);
    const artifact =
      document.artifact ??
      ({
        id: document.id,
        type: "doc",
        title: document.title,
        metadata: {
          format: "markdown",
          summary: document.summary,
        },
      } satisfies ArtifactRef);

    resultNodes.push({
      id: nodeId,
      type: "markdownNode",
      position: { x, y: preferredRect.y },
      data: {
        kind: "markdown",
        artifact,
        content: document.content.trim(),
        prompt: runNode.data.kind === "run" ? runNode.data.prompt : undefined,
        runId: runNode.id,
        summary: document.summary ?? summarizeMarkdown(document.content),
        title: document.title,
      },
    });
    resultEdges.push({
      id: id("edge"),
      source: runNode.id,
      target: nodeId,
      type: "animated",
    });
  }

  return { resultNodes, resultEdges };
}

export function createHtmlPageNodes(
  runNode: AgentCanvasNode,
  pages: GeneratedHtmlPage[],
  existingNodes: AgentCanvasNode[]
) {
  const alreadyRendered = new Set(
    existingNodes.flatMap((node) => {
      if (node.data.kind !== "webpage") {
        return [];
      }

      return [node.data.artifact?.id ?? node.id.replace(/^webpage-/, "")];
    })
  );
  const visiblePages = pages.filter(
    (page) => page.html.trim() && !alreadyRendered.has(page.artifact?.id ?? page.id)
  );

  const resultNodes: AgentCanvasNode[] = [];
  const resultEdges: AgentCanvasEdge[] = [];

  for (const page of visiblePages) {
    const nodeId = `webpage-${safeNodeId(page.artifact?.id ?? page.id)}`;
    const preferredRect = {
      x: runNode.position.x - (WEBPAGE_NODE_WIDTH - NODE_WIDTH) / 2,
      y: runNode.position.y + EXPANDED_RESULT_OFFSET_FROM_PROMPT_Y - RUN_OFFSET_Y,
      width: WEBPAGE_NODE_WIDTH,
      height: WEBPAGE_NODE_HEIGHT,
    };
    const x = resolveNonOverlappingX(preferredRect, [
      ...existingNodes,
      ...resultNodes,
    ]);
    const artifact =
      page.artifact ??
      ({
        id: page.id,
        type: "webpage",
        title: page.title,
        contentRef: page.previewUrl,
        metadata: {
          format: "html",
          html: page.html,
          mimeType: "text/html",
          summary: page.summary,
        },
      } satisfies ArtifactRef);

    resultNodes.push({
      id: nodeId,
      type: "webpageNode",
      position: { x, y: preferredRect.y },
      data: {
        kind: "webpage",
        artifact,
        html: page.html,
        previewUrl: page.previewUrl,
        prompt: runNode.data.kind === "run" ? runNode.data.prompt : undefined,
        runId: runNode.id,
        summary: page.summary,
        title: page.title,
      },
    });
    resultEdges.push({
      id: id("edge"),
      source: runNode.id,
      target: nodeId,
      type: "animated",
    });
  }

  return { resultNodes, resultEdges };
}

function resolveNonOverlappingX(
  preferredRect: CanvasRect,
  existingNodes: AgentCanvasNode[]
) {
  if (!preferredRect.width || !preferredRect.height) {
    return preferredRect.x;
  }

  const existingRects = existingNodes.map(getNodeRect);
  if (!hasCollision(preferredRect, existingRects)) {
    return preferredRect.x;
  }

  const candidates = new Set<number>([preferredRect.x]);
  for (const rect of existingRects) {
    if (!overlapsVertically(preferredRect, expandRect(rect, NODE_CLEARANCE))) {
      continue;
    }

    candidates.add(rect.x + rect.width + NODE_CLEARANCE);
    candidates.add(rect.x - preferredRect.width - NODE_CLEARANCE);
  }

  const validCandidates = Array.from(candidates).filter(
    (x) =>
      !hasCollision(
        {
          ...preferredRect,
          x,
        },
        existingRects
      )
  );

  if (validCandidates.length) {
    return validCandidates.sort((a, b) => {
      const distanceA = Math.abs(a - preferredRect.x);
      const distanceB = Math.abs(b - preferredRect.x);
      if (distanceA !== distanceB) {
        return distanceA - distanceB;
      }

      return b - a;
    })[0];
  }

  const rightEdge = existingRects
    .filter((rect) =>
      overlapsVertically(preferredRect, expandRect(rect, NODE_CLEARANCE))
    )
    .reduce(
      (maxX, rect) => Math.max(maxX, rect.x + rect.width),
      preferredRect.x
    );

  return rightEdge + NODE_CLEARANCE;
}

function hasCollision(rect: CanvasRect, existingRects: CanvasRect[]) {
  return existingRects.some((existingRect) =>
    rectsOverlap(rect, expandRect(existingRect, NODE_CLEARANCE))
  );
}

function getNodeRect(node: AgentCanvasNode): CanvasRect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: getNodeWidth(node),
    height: getNodeHeight(node),
  };
}

function getNodeWidth(node: AgentCanvasNode) {
  const measuredWidth = getStoredNodeDimension(node, "width");
  if (measuredWidth) {
    return measuredWidth;
  }

  if (node.data.kind === "markdown") {
    return MARKDOWN_NODE_WIDTH;
  }
  if (node.data.kind === "webpage") {
    return WEBPAGE_NODE_WIDTH;
  }

  return NODE_WIDTH;
}

function getNodeHeight(node: AgentCanvasNode) {
  const measuredHeight = getStoredNodeDimension(node, "height");
  if (measuredHeight) {
    return measuredHeight;
  }

  if (node.data.kind === "prompt") {
    return PROMPT_NODE_HEIGHT;
  }

  if (node.data.kind === "imageResult") {
    return RESULT_NODE_HEIGHT;
  }

  if (node.data.kind === "markdown") {
    return MARKDOWN_NODE_HEIGHT;
  }
  if (node.data.kind === "webpage") {
    return WEBPAGE_NODE_HEIGHT;
  }

  if (isArtifactBackedKind(node.data.kind)) {
    return ARTIFACT_NODE_HEIGHT;
  }

  if (
    node.data.kind === "run" &&
    node.data.status === "queued" &&
    node.data.toolPart?.state === "input-streaming"
  ) {
    return COMPACT_RUN_NODE_HEIGHT;
  }

  return RUN_NODE_HEIGHT;
}

function getStoredNodeDimension(
  node: AgentCanvasNode,
  dimension: "height" | "width"
) {
  const value = node[dimension] ?? node.measured?.[dimension];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function getRevisionAnchorPriority(node: AgentCanvasNode) {
  if (node.data.kind === "imageResult") {
    return 100;
  }
  if (node.data.kind === "markdown") {
    return 90;
  }
  if (isArtifactBackedNode(node)) {
    return 80;
  }
  if (node.data.kind === "prompt") {
    return 60;
  }

  return 0;
}

function expandRect(rect: CanvasRect, padding: number): CanvasRect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function rectsOverlap(a: CanvasRect, b: CanvasRect) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function overlapsVertically(a: CanvasRect, b: CanvasRect) {
  return a.y < b.y + b.height && a.y + a.height > b.y;
}

function contextItemsFromNode(
  node: AgentCanvasNode,
  isSelectedNode: boolean
): UpstreamContextItem[] {
  if (node.data.kind === "prompt") {
    return [
      {
        nodeId: node.id,
        type: "prompt",
        prompt: node.data.prompt,
        summary: node.data.prompt,
        priority: getContextPriority("prompt", isSelectedNode),
      },
    ];
  }

  if (node.data.kind === "imageResult") {
    const artifact = node.data.artifact ?? node.data.image.artifact;
    return [
      {
        nodeId: node.id,
        type: "image",
        prompt: node.data.prompt,
        imageUrl: node.data.image.url,
        summary: node.data.image.title ?? "Generated image",
        artifact,
        title: node.data.image.title,
        contentRef: artifact?.contentRef,
        priority: getContextPriority("image", isSelectedNode),
      },
    ];
  }

  if (node.data.kind === "run" && node.data.decision?.trim()) {
    return [
      {
        nodeId: node.id,
        type: "decision",
        summary: node.data.decision.trim(),
        title: "Run decision",
        priority: getContextPriority("decision", isSelectedNode),
      },
    ];
  }

  if (isArtifactBackedNode(node)) {
    const type = getArtifactContextType(node.data.artifact);
    const summary = getArtifactNodeSummary(node);

    return [
      {
        nodeId: node.id,
        type,
        prompt: node.data.prompt,
        summary,
        artifact: node.data.artifact,
        title: node.data.title,
        contentRef: node.data.artifact.contentRef,
        imageUrl:
          node.data.artifact.type === "image" ? node.data.artifact.uri : undefined,
        priority: getContextPriority(type, isSelectedNode),
      },
    ];
  }

  return [];
}

type ArtifactBackedCanvasNode = AgentCanvasNode & {
  data: Extract<
    AgentCanvasNode["data"],
    {
      kind:
        | "artifact"
        | "markdown"
        | "decision"
        | "memory"
        | "toolResult"
        | "document"
        | "code"
        | "webpage";
    }
  >;
};

function getArtifactNodeSummary(node: ArtifactBackedCanvasNode) {
  if (node.data.kind === "markdown") {
    return node.data.summary ?? summarizeMarkdown(node.data.content);
  }

  if (node.data.kind === "decision") {
    return node.data.decision;
  }

  if (node.data.kind === "memory") {
    return node.data.memory;
  }

  return node.data.summary ?? node.data.title;
}

function selectContextWithinBudget(
  items: UpstreamContextItem[],
  budget: number | undefined,
  selectedNodeId: string | null
) {
  if (!Number.isFinite(budget)) {
    return { selected: items, omitted: [] };
  }

  const maxBudget = Math.max(0, budget ?? 0);
  const selected = [...items];
  const omitted: UpstreamContextItem[] = [];

  while (getContextTokenEstimate(selected) > maxBudget) {
    const dropCandidate = selected
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.nodeId !== selectedNodeId)
      .sort(
        (left, right) =>
          (left.item.priority ?? 0) - (right.item.priority ?? 0) ||
          right.index - left.index
      )[0];

    if (!dropCandidate) {
      break;
    }

    const [dropped] = selected.splice(dropCandidate.index, 1);
    omitted.push({
      ...dropped,
      omittedReason: "context_budget_exceeded",
    });
  }

  return { selected, omitted };
}

function getContextTokenEstimate(items: UpstreamContextItem[]) {
  return items.reduce(
    (total, item) =>
      total +
      Math.max(
        1,
        Math.ceil(
          [
            item.title,
            item.summary,
            item.prompt,
            item.imageUrl,
            item.contentRef,
            item.artifact?.uri,
            item.artifact?.contentRef,
          ]
            .filter(Boolean)
            .join("\n").length / 4
        )
      ),
    0
  );
}

function getArtifactContextType(artifact: ArtifactRef): UpstreamContextType {
  if (artifact.type === "doc") {
    return "doc";
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
    return "tool_result";
  }
  if (artifact.type === "dataset") {
    return "dataset";
  }
  if (artifact.type === "image") {
    return "image";
  }

  return "artifact";
}

function getContextPriority(type: UpstreamContextType, isSelectedNode: boolean) {
  if (isSelectedNode) {
    return 100;
  }

  const priorities: Record<UpstreamContextType, number> = {
    prompt: 90,
    image: 82,
    artifact: 70,
    doc: 72,
    code: 72,
    webpage: 68,
    dataset: 62,
    decision: 58,
    tool_result: 54,
    memory: 34,
  };

  return priorities[type];
}

function isArtifactBackedKind(
  kind: AgentCanvasNode["data"]["kind"]
): kind is
  | "artifact"
  | "markdown"
  | "decision"
  | "memory"
  | "toolResult"
  | "document"
  | "code"
  | "webpage" {
  return (
    kind === "artifact" ||
    kind === "markdown" ||
    kind === "decision" ||
    kind === "memory" ||
    kind === "toolResult" ||
    kind === "document" ||
    kind === "code" ||
    kind === "webpage"
  );
}

function isArtifactBackedNode(
  node: AgentCanvasNode
): node is ArtifactBackedCanvasNode {
  return isArtifactBackedKind(node.data.kind);
}

export function extractMarkdownDocumentsFromToolOutput(
  output: unknown
): GeneratedMarkdownDocument[] {
  if (!output || typeof output !== "object") {
    return [];
  }

  const documents: GeneratedMarkdownDocument[] = [];
  const candidate = output as Record<string, unknown>;
  const directMarkdown =
    readString(candidate.markdown) ??
    (candidate.format === "markdown" || candidate.mimeType === "text/markdown"
      ? readString(candidate.content)
      : undefined);

  if (directMarkdown) {
    documents.push({
      id: readString(candidate.id) ?? "agent-markdown",
      title: readString(candidate.title) ?? "Markdown 文档",
      content: directMarkdown,
      summary: readString(candidate.summary) ?? summarizeMarkdown(directMarkdown),
    });
  }

  const documentItems = Array.isArray(candidate.documents)
    ? candidate.documents
    : [];
  for (const item of documentItems) {
    const document = readMarkdownDocument(item);
    if (document) {
      documents.push(document);
    }
  }

  const artifacts = Array.isArray(candidate.artifacts) ? candidate.artifacts : [];
  for (const artifact of artifacts) {
    const document = readMarkdownArtifactDocument(artifact);
    if (document) {
      documents.push(document);
    }
  }

  return dedupeMarkdownDocuments(documents);
}

export function extractHtmlPagesFromToolOutput(
  output: unknown
): GeneratedHtmlPage[] {
  if (!output || typeof output !== "object") {
    return [];
  }

  const pages: GeneratedHtmlPage[] = [];
  const candidate = output as Record<string, unknown>;
  const directHtml =
    readString(candidate.html) ??
    (candidate.format === "html" || candidate.mimeType === "text/html"
      ? readString(candidate.content)
      : undefined);

  if (directHtml) {
    const idValue =
      readString(candidate.artifactId) ??
      readString(candidate.id) ??
      stableTextId(directHtml);
    pages.push({
      id: idValue,
      title: readString(candidate.title) ?? getHtmlTitle(directHtml),
      html: directHtml,
      previewUrl: toHtmlPreviewUrl(directHtml),
      summary: readString(candidate.summary),
    });
  }

  const pageItems = Array.isArray(candidate.pages) ? candidate.pages : [];
  for (const item of pageItems) {
    const page = readHtmlPage(item);
    if (page) {
      pages.push(page);
    }
  }

  const artifacts = Array.isArray(candidate.artifacts) ? candidate.artifacts : [];
  for (const artifact of artifacts) {
    const page = readHtmlArtifactPage(artifact);
    if (page) {
      pages.push(page);
    }
  }

  return dedupeHtmlPages(pages);
}

export function extractImagesFromToolOutput(output: unknown): GeneratedImage[] {
  if (!output || typeof output !== "object") {
    return [];
  }

  const candidate = output as { images?: GeneratedImage[]; url?: string };
  if (Array.isArray(candidate.images)) {
    return candidate.images.filter((image) => image.url);
  }

  const artifacts = (output as { artifacts?: unknown }).artifacts;
  if (Array.isArray(artifacts)) {
    return artifacts.flatMap((artifact) => {
      if (!artifact || typeof artifact !== "object") {
        return [];
      }

      const candidateArtifact = artifact as {
        id?: unknown;
        type?: unknown;
        uri?: unknown;
        title?: unknown;
        metadata?: unknown;
      };
      if (
        candidateArtifact.type !== "image" ||
        typeof candidateArtifact.id !== "string" ||
        typeof candidateArtifact.uri !== "string"
      ) {
        return [];
      }

      return {
        id: candidateArtifact.id,
        url: candidateArtifact.uri,
        title:
          typeof candidateArtifact.title === "string"
            ? candidateArtifact.title
            : undefined,
        metadata:
          candidateArtifact.metadata &&
          typeof candidateArtifact.metadata === "object"
            ? (candidateArtifact.metadata as Record<string, unknown>)
            : undefined,
        artifact: {
          id: candidateArtifact.id,
          type: "image" as const,
          uri: candidateArtifact.uri,
          title:
            typeof candidateArtifact.title === "string"
              ? candidateArtifact.title
              : undefined,
          metadata:
            candidateArtifact.metadata &&
            typeof candidateArtifact.metadata === "object"
              ? (candidateArtifact.metadata as Record<string, unknown>)
              : undefined,
        },
      };
    });
  }

  if (candidate.url) {
    return [{ id: id("img"), url: candidate.url }];
  }

  return [];
}

export function toolPartFromMessagePart(part: unknown): CanvasToolPart | null {
  if (!part || typeof part !== "object") {
    return null;
  }

  const candidate = part as {
    type?: string;
    toolName?: string;
    state?: CanvasToolPart["state"];
    toolCallId?: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
    approval?: {
      id?: unknown;
      approved?: unknown;
      reason?: unknown;
    };
  };
  const toolName =
    candidate.type === "dynamic-tool"
      ? candidate.toolName
      : candidate.type?.startsWith("tool-")
        ? candidate.type.slice("tool-".length)
        : null;

  if (
    toolName !== "analyze_reference_images" &&
    toolName !== "generate_image" &&
    toolName !== "expand_prompt" &&
    toolName !== "web.read" &&
    toolName !== "asset.analyze_context" &&
    toolName !== "page.generate" &&
    toolName !== "web_search" &&
    toolName !== "write_document"
  ) {
    return null;
  }

  return {
    type: `tool-${toolName}`,
    state: candidate.state ?? "input-streaming",
    toolCallId: candidate.toolCallId,
    input: candidate.input,
    output: candidate.output,
    errorText: candidate.errorText,
    approval: readToolApproval(candidate.approval),
  };
}

function readToolApproval(approval: {
  id?: unknown;
  approved?: unknown;
  reason?: unknown;
} | undefined): CanvasToolPart["approval"] {
  if (!approval || typeof approval.id !== "string") {
    return undefined;
  }

  return {
    id: approval.id,
    approved:
      typeof approval.approved === "boolean" ? approval.approved : undefined,
    reason: typeof approval.reason === "string" ? approval.reason : undefined,
  };
}

function getInitialRunToolPart(
  prompt: string,
  upstreamContext: UpstreamContextItem[]
): CanvasToolPart {
  const imageCount = upstreamContext.filter(
    (item) => item.type === "image" && Boolean(item.imageUrl)
  ).length;

  if (imageCount) {
    return {
      type: "tool-analyze_reference_images",
      state: "input-streaming",
      input: { prompt, upstreamContext, imageCount, modelProvider: "ark" },
    };
  }

  return {
    type: "tool-expand_prompt",
    state: "input-streaming",
    input: { prompt, upstreamContext, skillSlug: "prompt-expand" },
  };
}

export function toolPartsFromMessageParts(parts: unknown[] | undefined) {
  if (!parts?.length) {
    return [];
  }

  return parts.flatMap((part) => {
    const toolPart = toolPartFromMessagePart(part);
    return toolPart ? [toolPart] : [];
  });
}

export function textFromMessageParts(parts: unknown[] | undefined): string {
  if (!parts?.length) {
    return "";
  }

  return parts
    .flatMap((part) => {
      if (!part || typeof part !== "object") {
        return [];
      }

      const candidate = part as { type?: string; text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string"
        ? [candidate.text.trim()]
        : [];
    })
    .filter(Boolean)
    .join("\n\n");
}

export function shouldCreateMarkdownFromAgentText(prompt: string, text: string) {
  const normalizedPrompt = prompt.toLowerCase();
  const asksForDocument =
    /调研|分析|报告|文档|总结|梳理|方案|markdown|\bmd\b/.test(
      normalizedPrompt
    );

  return asksForDocument && looksLikeMarkdownDocument(text);
}

function readMarkdownDocument(item: unknown): GeneratedMarkdownDocument | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const candidate = item as Record<string, unknown>;
  const content = readString(candidate.markdown) ?? readString(candidate.content);
  if (!content) {
    return null;
  }

  return {
    id: readString(candidate.id) ?? stableTextId(content),
    title: readString(candidate.title) ?? getMarkdownTitle(content),
    content,
    summary: readString(candidate.summary) ?? summarizeMarkdown(content),
  };
}

function readMarkdownArtifactDocument(
  item: unknown
): GeneratedMarkdownDocument | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const candidate = item as Record<string, unknown>;
  const artifact = readArtifactRef(candidate);
  if (!artifact || !isMarkdownArtifact(artifact)) {
    return null;
  }

  const metadata = artifact.metadata ?? {};
  const content =
    readString(metadata.markdown) ??
    readString(metadata.content) ??
    readString(metadata.text);
  if (!content) {
    return null;
  }

  return {
    id: artifact.id,
    title: artifact.title ?? getMarkdownTitle(content),
    content,
    summary: readString(metadata.summary) ?? summarizeMarkdown(content),
    artifact,
  };
}

function readHtmlPage(item: unknown): GeneratedHtmlPage | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const candidate = item as Record<string, unknown>;
  const html = readString(candidate.html) ?? readString(candidate.content);
  if (!html) {
    return null;
  }

  return {
    id: readString(candidate.id) ?? stableTextId(html),
    title: readString(candidate.title) ?? getHtmlTitle(html),
    html,
    previewUrl: readString(candidate.previewUrl) ?? toHtmlPreviewUrl(html),
    summary: readString(candidate.summary),
  };
}

function readHtmlArtifactPage(item: unknown): GeneratedHtmlPage | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const candidate = item as Record<string, unknown>;
  const artifact = readArtifactRef(candidate);
  if (!artifact || !isHtmlArtifact(artifact)) {
    return null;
  }

  const metadata = artifact.metadata ?? {};
  const html =
    readString(metadata.html) ??
    readString(metadata.content) ??
    readHtmlFromDataUrl(artifact.contentRef) ??
    readHtmlFromDataUrl(artifact.uri);
  if (!html) {
    return null;
  }

  return {
    id: artifact.id,
    title: artifact.title ?? getHtmlTitle(html),
    html,
    previewUrl: artifact.contentRef ?? artifact.uri ?? toHtmlPreviewUrl(html),
    summary: readString(metadata.summary),
    artifact,
  };
}

function readArtifactRef(candidate: Record<string, unknown>): ArtifactRef | null {
  const idValue = readString(candidate.id);
  const typeValue = candidate.type;
  if (!idValue || !isArtifactType(typeValue)) {
    return null;
  }

  return {
    id: idValue,
    type: typeValue,
    uri: readString(candidate.uri),
    title: readString(candidate.title),
    contentRef: readString(candidate.contentRef),
    metadata:
      candidate.metadata && typeof candidate.metadata === "object"
        ? (candidate.metadata as Record<string, unknown>)
        : undefined,
  };
}

function isArtifactType(value: unknown): value is ArtifactRef["type"] {
  return (
    value === "image" ||
    value === "file" ||
    value === "doc" ||
    value === "code" ||
    value === "webpage" ||
    value === "dataset" ||
    value === "decision" ||
    value === "tool_result" ||
    value === "memory"
  );
}

function isMarkdownArtifact(artifact: ArtifactRef) {
  const format = readString(artifact.metadata?.format)?.toLowerCase();
  const mimeType = readString(artifact.metadata?.mimeType)?.toLowerCase();

  return (
    artifact.type === "doc" &&
    (format === "markdown" ||
      format === "md" ||
      mimeType === "text/markdown" ||
      artifact.uri?.endsWith(".md") ||
      artifact.contentRef?.endsWith(".md"))
  );
}

function isHtmlArtifact(artifact: ArtifactRef) {
  const format = readString(artifact.metadata?.format)?.toLowerCase();
  const mimeType = readString(artifact.metadata?.mimeType)?.toLowerCase();

  return (
    artifact.type === "webpage" &&
    (format === "html" ||
      mimeType === "text/html" ||
      artifact.uri?.startsWith("data:text/html") ||
      artifact.contentRef?.startsWith("data:text/html") ||
      artifact.uri?.endsWith(".html") ||
      artifact.contentRef?.endsWith(".html"))
  );
}

function looksLikeMarkdownDocument(text: string) {
  const trimmed = text.trim();
  if (trimmed.length < 80) {
    return false;
  }

  return /^#{1,3}\s+\S/m.test(trimmed) || /\n[-*]\s+\S/.test(trimmed);
}

function getMarkdownTitle(content: string) {
  const heading = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^#{1,3}\s+\S/.test(line));

  return heading?.replace(/^#{1,3}\s+/, "").trim() || "Markdown 文档";
}

function summarizeMarkdown(content: string) {
  return (
    content
      .replace(/```[\s\S]*?```/g, "")
      .split("\n")
      .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
      .filter(Boolean)
      .find((line) => !/^[-*]\s*$/.test(line))
      ?.slice(0, 160) ?? "Markdown document"
  );
}

function getHtmlTitle(html: string) {
  return (
    html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]
      ?.replace(/\s+/g, " ")
      .trim() || "HTML 页面"
  );
}

function toHtmlPreviewUrl(html: string) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
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

function stableTextId(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return `md-${hash.toString(36)}`;
}

function safeNodeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function dedupeMarkdownDocuments(documents: GeneratedMarkdownDocument[]) {
  const seen = new Set<string>();

  return documents.filter((document) => {
    const key = document.artifact?.id ?? document.id;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function dedupeHtmlPages(pages: GeneratedHtmlPage[]) {
  const seen = new Set<string>();

  return pages.filter((page) => {
    const key = page.artifact?.id ?? page.id;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
