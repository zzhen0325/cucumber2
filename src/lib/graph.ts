import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  ArtifactRef,
  GeneratedHtmlPage,
  GeneratedImage,
  ImageRequestPreview,
  ImageResultStatus,
  RunDraft,
  RunNodeData,
  UpstreamContextItem,
  UpstreamContextType,
} from "../types/canvas";

const NODE_WIDTH = 240;
const PROMPT_NODE_HEIGHT = 84;
const COMPACT_RUN_NODE_HEIGHT = 36;
const RUN_NODE_HEIGHT = 300;
const RESULT_NODE_HEIGHT = 240;
const RESULT_NODE_MIN_SIDE = 24;
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
      hasVisibleRunOutput(runNode.data))
      ? EXPANDED_RESULT_OFFSET_FROM_PROMPT_Y
      : RESULT_OFFSET_FROM_PROMPT_Y;
  const dimensions = results.map(getImageResultNodeDimensions);
  const totalWidth =
    dimensions.reduce((sum, dimension) => sum + dimension.width, 0) +
    Math.max(results.length - 1, 0) * RESULT_GAP;
  const maxHeight = Math.max(
    RESULT_NODE_HEIGHT,
    ...dimensions.map((dimension) => dimension.height)
  );
  const preferredStartX =
    runNode.position.x + NODE_WIDTH / 2 - totalWidth / 2;
  const y = runNode.position.y + resultOffset - RUN_OFFSET_Y;
  const startX = resolveNonOverlappingX(
    {
      x: preferredStartX,
      y,
      width: totalWidth,
      height: maxHeight,
    },
    existingNodes
  );

  let currentX = startX;
  const resultNodes: AgentCanvasNode[] = results.map((result, index) => {
    const dimension = dimensions[index];
    const position =
      getExistingPosition(existingNodes, result.id) ?? { x: currentX, y };
    currentX += dimension.width + RESULT_GAP;

    return {
      id: result.id,
      type: "imageResultNode",
      position,
      width: dimension.width,
      height: dimension.height,
      data: {
        kind: "imageResult",
        image: result.image,
        artifact: result.artifact,
        prompt: runNode.data.kind === "run" ? runNode.data.prompt : "",
        runId: runNode.id,
        request: result.request,
        status: result.status,
      },
    };
  });

  const resultEdges: AgentCanvasEdge[] = resultNodes.map((node) => ({
    id: `edge-${runNode.id}-${node.id}`,
    source: runNode.id,
    target: node.id,
    type: "animated",
  }));

  return { resultNodes, resultEdges };
}

function getImageResultNodeDimensions({
  image,
  request,
}: {
  image: GeneratedImage;
  request?: ImageRequestPreview;
}) {
  const ratio = getImageAspectRatio(image, request);
  const width = NODE_WIDTH;
  const height = Math.max(RESULT_NODE_MIN_SIDE, Math.round(width / ratio));

  return { width, height };
}

function getImageAspectRatio(
  image: GeneratedImage,
  request?: ImageRequestPreview
) {
  const metadataWidth = readPositiveNumber(image.metadata?.width);
  const metadataHeight = readPositiveNumber(image.metadata?.height);
  if (metadataWidth && metadataHeight) {
    return metadataWidth / metadataHeight;
  }

  const requestWidth = readPositiveNumber(request?.width);
  const requestHeight = readPositiveNumber(request?.height);
  if (requestWidth && requestHeight) {
    return requestWidth / requestHeight;
  }

  const parsedRatio = parseAspectRatio(request?.aspectRatio);
  if (parsedRatio) {
    return parsedRatio;
  }

  return 1;
}

function parseAspectRatio(value: string | undefined) {
  const match = value?.match(/^(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return width / height;
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
    !hasVisibleRunOutput(node.data)
  ) {
    return COMPACT_RUN_NODE_HEIGHT;
  }

  return RUN_NODE_HEIGHT;
}

function hasVisibleRunOutput(data: RunNodeData) {
  const toolParts = data.toolParts ?? (data.toolPart ? [data.toolPart] : []);
  const hasVisibleToolPart = toolParts.some(
    (part) => part.state !== "input-streaming" || Boolean(part.toolCallId)
  );

  return Boolean(
    data.agentText?.trim() ||
      hasVisibleToolPart ||
      data.stepTimeline?.length ||
      data.summaryItems?.length ||
      data.error
  );
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
    const imageUrl = artifact?.uri ?? node.data.image.url;
    return [
      {
        nodeId: node.id,
        type: "image",
        prompt: node.data.prompt,
        imageUrl,
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

  if (node.data.kind === "stickyNote") {
    const summary = node.data.text.trim() || "空便签";
    return [
      {
        nodeId: node.id,
        type: "doc",
        summary,
        title: "便签",
        priority: getContextPriority("doc", isSelectedNode),
      },
    ];
  }

  if (node.data.kind === "shape") {
    return [
      {
        nodeId: node.id,
        type: "artifact",
        summary: `${getShapeLabel(node.data.shape)}：${node.data.label}`.trim(),
        title: node.data.label,
        priority: getContextPriority("artifact", isSelectedNode),
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

function getShapeLabel(shape: AgentCanvasNode["data"] extends infer Data
  ? Data extends { kind: "shape"; shape: infer Shape }
    ? Shape
    : never
  : never) {
  const labels = {
    diamond: "菱形",
    ellipse: "圆形",
    frame: "框架",
    pill: "胶囊",
    rectangle: "矩形",
    triangle: "三角形",
  } as const;

  return labels[shape];
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

function safeNodeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function readPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
