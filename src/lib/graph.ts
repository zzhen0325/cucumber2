import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  CanvasToolPart,
  GeneratedImage,
  RunDraft,
  UpstreamContextItem,
} from "@/types/canvas";

const NODE_WIDTH = 240;
const RESULT_GAP = 17;
const ROOT_START_X = 260;
const ROOT_START_Y = 210;
const ROOT_CHAIN_GAP = 320;
const FOLLOW_UP_GAP_X = 262;
const FOLLOW_UP_GAP_Y = 310;
const RUN_OFFSET_Y = 124;
const RESULT_OFFSET_FROM_PROMPT_Y = 200;
const EXPANDED_RESULT_OFFSET_FROM_PROMPT_Y = 317;

const id = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const isImageResultNode = (node?: AgentCanvasNode) =>
  node?.data.kind === "imageResult";

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
  const siblings = selectedNodeId
    ? edges.filter((edge) => edge.source === selectedNodeId).length
    : nodes.filter((node) => node.data.kind === "prompt").length;

  const upstreamContext = collectUpstreamContext(selectedNodeId, nodes, edges);
  const baseX = selectedNode
    ? selectedNode.position.x + siblings * FOLLOW_UP_GAP_X
    : ROOT_START_X + siblings * ROOT_CHAIN_GAP;
  const baseY = selectedNode
    ? selectedNode.position.y + FOLLOW_UP_GAP_Y
    : ROOT_START_Y;
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
      toolPart: {
        type: "tool-generate_image",
        state: "input-streaming",
        input: { prompt, upstreamContext },
      },
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

  if (selectedNodeId) {
    draftEdges.unshift({
      id: id("edge"),
      source: selectedNodeId,
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
  const startX =
    runNode.position.x -
    ((visibleImages.length - 1) * (NODE_WIDTH + RESULT_GAP)) / 2;
  const y = runNode.position.y + resultOffset - RUN_OFFSET_Y;

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

  const candidate = part as Partial<CanvasToolPart> & { type?: string };
  if (candidate.type !== "tool-generate_image") {
    return null;
  }

  return {
    type: "tool-generate_image",
    state: candidate.state ?? "input-streaming",
    input: candidate.input,
    output: candidate.output,
    errorText: candidate.errorText,
  };
}
