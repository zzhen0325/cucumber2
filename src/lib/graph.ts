import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  CanvasToolPart,
  GeneratedImage,
  RunDraft,
  UpstreamContextItem,
} from "@/types/canvas";

const NODE_WIDTH = 240;
const PROMPT_NODE_HEIGHT = 84;
const COMPACT_RUN_NODE_HEIGHT = 36;
const RUN_NODE_HEIGHT = 300;
const RESULT_NODE_HEIGHT = 240;
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
  edges: AgentCanvasEdge[]
): UpstreamContextItem[] {
  if (!selectedNodeId) {
    return [];
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

  return ordered.flatMap((node) => {
    if (node.data.kind === "prompt") {
      return {
        nodeId: node.id,
        type: "prompt" as const,
        prompt: node.data.prompt,
        summary: node.data.prompt,
      };
    }

    if (node.data.kind === "imageResult") {
      return {
        nodeId: node.id,
        type: "image" as const,
        prompt: node.data.prompt,
        imageUrl: node.data.image.url,
        summary: node.data.image.title ?? "Generated image",
      };
    }

    return [];
  });
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

  const upstreamContext = collectUpstreamContext(referenceNodeId, nodes, edges);
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

  return { promptNode, runNode, edges: draftEdges, upstreamContext };
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

  if (
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

export function extractImagesFromToolOutput(output: unknown): GeneratedImage[] {
  if (!output || typeof output !== "object") {
    return [];
  }

  const candidate = output as { images?: GeneratedImage[]; url?: string };
  if (Array.isArray(candidate.images)) {
    return candidate.images.filter((image) => image.url);
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
