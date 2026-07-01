import {
  DEFAULT_CANVAS_NODE_WIDTH,
  DEFAULT_MARKDOWN_NODE_DIMENSIONS,
  DEFAULT_WEBPAGE_NODE_DIMENSIONS,
  getPromptNodeDimensions,
  readNodeDimension,
} from "./canvas-node-dimensions";
import type { AgentCanvasNode } from "@/types/canvas";

export type CanvasPlacementPoint = { x: number; y: number };
export type CanvasPlacementRect = CanvasPlacementPoint & {
  height: number;
  width: number;
};

const CANVAS_NODE_PLACEMENT_GAP = 24;
const CANVAS_NODE_PLACEMENT_SEARCH_STEPS = 8;
const DEFAULT_ARTIFACT_NODE_HEIGHT = 132;
const DEFAULT_RUN_NODE_HEIGHT = 300;
const DEFAULT_IMAGE_NODE_HEIGHT = 240;

export function resolveNonOverlappingCanvasPosition(
  preferredRect: CanvasPlacementRect,
  existingNodes: readonly AgentCanvasNode[]
): CanvasPlacementPoint {
  const existingRects = existingNodes.map(getNodePlacementRect);

  for (let row = 0; row < CANVAS_NODE_PLACEMENT_SEARCH_STEPS; row += 1) {
    for (let column = 0; column < CANVAS_NODE_PLACEMENT_SEARCH_STEPS; column += 1) {
      const candidate = {
        ...preferredRect,
        x:
          preferredRect.x +
          column * (preferredRect.width + CANVAS_NODE_PLACEMENT_GAP),
        y:
          preferredRect.y +
          row * (preferredRect.height + CANVAS_NODE_PLACEMENT_GAP),
      };
      if (!hasNodePlacementCollision(candidate, existingRects)) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }

  return {
    x: preferredRect.x,
    y: preferredRect.y + preferredRect.height + CANVAS_NODE_PLACEMENT_GAP,
  };
}

export function getNodesRelativeBounds(
  nodes: readonly AgentCanvasNode[],
  originX: number,
  originY: number
) {
  const maxX = Math.max(
    ...nodes.map((node) => {
      const dimensions = getNodePlacementDimensions(node);
      return node.position.x + dimensions.width;
    })
  );
  const maxY = Math.max(
    ...nodes.map((node) => {
      const dimensions = getNodePlacementDimensions(node);
      return node.position.y + dimensions.height;
    })
  );

  return {
    width: Math.max(CANVAS_NODE_PLACEMENT_GAP, maxX - originX),
    height: Math.max(CANVAS_NODE_PLACEMENT_GAP, maxY - originY),
  };
}

function getNodePlacementRect(node: AgentCanvasNode): CanvasPlacementRect {
  return {
    ...node.position,
    ...getNodePlacementDimensions(node),
  };
}

function getNodePlacementDimensions(node: AgentCanvasNode) {
  const width = readNodeDimension(node, "width");
  const height = readNodeDimension(node, "height");
  if (width && height) {
    return { width, height };
  }

  if (node.data.kind === "prompt") {
    return {
      width: width ?? DEFAULT_CANVAS_NODE_WIDTH,
      height: height ?? getPromptNodeDimensions(node.data.prompt).height,
    };
  }
  if (node.data.kind === "imageResult") {
    return {
      width: width ?? DEFAULT_CANVAS_NODE_WIDTH,
      height: height ?? DEFAULT_IMAGE_NODE_HEIGHT,
    };
  }
  if (node.data.kind === "markdown") {
    return {
      width: width ?? DEFAULT_MARKDOWN_NODE_DIMENSIONS.width,
      height: height ?? DEFAULT_MARKDOWN_NODE_DIMENSIONS.height,
    };
  }
  if (node.data.kind === "webpage") {
    return {
      width: width ?? DEFAULT_WEBPAGE_NODE_DIMENSIONS.width,
      height: height ?? DEFAULT_WEBPAGE_NODE_DIMENSIONS.height,
    };
  }
  if (node.data.kind === "run") {
    return {
      width: width ?? DEFAULT_CANVAS_NODE_WIDTH,
      height: height ?? DEFAULT_RUN_NODE_HEIGHT,
    };
  }

  return {
    width: width ?? DEFAULT_CANVAS_NODE_WIDTH,
    height: height ?? DEFAULT_ARTIFACT_NODE_HEIGHT,
  };
}

function hasNodePlacementCollision(
  rect: CanvasPlacementRect,
  existingRects: CanvasPlacementRect[]
) {
  return existingRects.some((existingRect) =>
    rectsOverlap(rect, expandCanvasRect(existingRect, CANVAS_NODE_PLACEMENT_GAP))
  );
}

function expandCanvasRect(
  rect: CanvasPlacementRect,
  padding: number
): CanvasPlacementRect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function rectsOverlap(a: CanvasPlacementRect, b: CanvasPlacementRect) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
