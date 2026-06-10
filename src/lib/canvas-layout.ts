import dagre from "@dagrejs/dagre";

import type { AgentCanvasEdge, AgentCanvasNode } from "@/types/canvas";

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

export type CanvasLayoutDirection = "TB" | "LR";

export type CanvasLayoutOptions = {
  direction?: CanvasLayoutDirection;
  nodeGap?: number;
  rankGap?: number;
};

export function layoutAgentCanvasGraph(
  nodes: AgentCanvasNode[],
  edges: AgentCanvasEdge[],
  options: CanvasLayoutOptions = {}
) {
  if (!nodes.length) {
    return nodes;
  }

  const direction = options.direction ?? "TB";
  const graph = new dagre.graphlib.Graph();
  const nodeIds = new Set(nodes.map((node) => node.id));

  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    marginx: 0,
    marginy: 0,
    nodesep: options.nodeGap ?? 72,
    rankdir: direction,
    ranksep: options.rankGap ?? 92,
  });

  const dimensionsById = new Map<string, { width: number; height: number }>();
  for (const node of nodes) {
    const dimensions = getNodeDimensions(node);
    dimensionsById.set(node.id, dimensions);
    graph.setNode(node.id, dimensions);
  }

  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(graph);

  return nodes.map((node) => {
    const position = graph.node(node.id);
    const dimensions = dimensionsById.get(node.id);
    if (!position || !dimensions) {
      return node;
    }

    return {
      ...node,
      position: {
        x: position.x - dimensions.width / 2,
        y: position.y - dimensions.height / 2,
      },
    };
  });
}

export function getCanvasLayoutSignature(
  nodes: AgentCanvasNode[],
  edges: AgentCanvasEdge[]
) {
  const nodeKey = nodes.map((node) => node.id).join("|");
  const edgeKey = edges
    .map((edge) => `${edge.source}->${edge.target}`)
    .join("|");

  return `${nodeKey}::${edgeKey}`;
}

function getNodeDimensions(node: AgentCanvasNode) {
  return {
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

function getStoredNodeDimension(
  node: AgentCanvasNode,
  dimension: "height" | "width"
) {
  const value = node[dimension] ?? node.measured?.[dimension];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function hasVisibleRunOutput(data: Extract<AgentCanvasNode["data"], { kind: "run" }>) {
  const toolParts = data.toolParts ?? (data.toolPart ? [data.toolPart] : []);
  const hasVisibleToolPart = toolParts.some(
    (part) => part.state !== "input-streaming" || Boolean(part.toolCallId)
  );

  return Boolean(
    data.agentText?.trim() ||
      hasVisibleToolPart ||
      data.stepTimeline?.length ||
      data.summaryItems?.length ||
      data.evaluation ||
      data.error
  );
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
