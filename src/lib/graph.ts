import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  ArtifactRef,
  CanvasToolPart,
  GeneratedImage,
  RunDraft,
  UpstreamContextItem,
  UpstreamContextType,
} from "@/types/canvas";

const NODE_WIDTH = 240;
const PROMPT_NODE_HEIGHT = 84;
const COMPACT_RUN_NODE_HEIGHT = 36;
const RUN_NODE_HEIGHT = 300;
const RESULT_NODE_HEIGHT = 240;
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

  const resultOffset =
    runNode.data.kind === "run" &&
    (runNode.data.status !== "queued" ||
      runNode.data.toolPart?.state !== "input-streaming")
      ? EXPANDED_RESULT_OFFSET_FROM_PROMPT_Y
      : RESULT_OFFSET_FROM_PROMPT_Y;
  const preferredStartX =
    runNode.position.x -
    ((visibleImages.length - 1) * (NODE_WIDTH + RESULT_GAP)) / 2;
  const y = runNode.position.y + resultOffset - RUN_OFFSET_Y;
  const startX = resolveNonOverlappingX(
    {
      x: preferredStartX,
      y,
      width:
        visibleImages.length * NODE_WIDTH +
        Math.max(visibleImages.length - 1, 0) * RESULT_GAP,
      height: RESULT_NODE_HEIGHT,
    },
    existingNodes
  );

  const resultNodes: AgentCanvasNode[] = visibleImages.map((image, index) => ({
    id: `image-${image.id}`,
    type: "imageResultNode",
    position: { x: startX + index * (NODE_WIDTH + RESULT_GAP), y },
    data: {
      kind: "imageResult",
      image,
      artifact: image.artifact,
      prompt: runNode.data.kind === "run" ? runNode.data.prompt : "",
      runId: runNode.id,
    },
  }));

  const resultEdges: AgentCanvasEdge[] = resultNodes.map((node) => ({
    id: id("edge"),
    source: runNode.id,
    target: node.id,
    type: "animated",
  }));

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
    width: NODE_WIDTH,
    height: getNodeHeight(node),
  };
}

function getNodeHeight(node: AgentCanvasNode) {
  if (node.data.kind === "prompt") {
    return PROMPT_NODE_HEIGHT;
  }

  if (node.data.kind === "imageResult") {
    return RESULT_NODE_HEIGHT;
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
  | "decision"
  | "memory"
  | "toolResult"
  | "document"
  | "code"
  | "webpage" {
  return (
    kind === "artifact" ||
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
    input?: unknown;
    output?: unknown;
    errorText?: string;
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
    toolName !== "expand_prompt"
  ) {
    return null;
  }

  return {
    type: `tool-${toolName}`,
    state: candidate.state ?? "input-streaming",
    input: candidate.input,
    output: candidate.output,
    errorText: candidate.errorText,
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
