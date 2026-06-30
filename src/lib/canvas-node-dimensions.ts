import type { CSSProperties } from "react";

import type { AgentCanvasNode, AgentCanvasNodeData } from "../types/canvas";

export const DEFAULT_CANVAS_NODE_WIDTH = 240;
export const DEFAULT_PROMPT_NODE_HEIGHT = 84;
export const DEFAULT_MARKDOWN_NODE_DIMENSIONS = {
  width: 420,
  height: 360,
} as const;
export const DEFAULT_WEBPAGE_NODE_DIMENSIONS = {
  width: 1280,
  height: 720,
} as const;

const PROMPT_NODE_MAX_AUTO_HEIGHT = 420;
const PROMPT_NODE_HORIZONTAL_PADDING = 54;
const PROMPT_NODE_VERTICAL_PADDING = 44;
const PROMPT_NODE_LINE_HEIGHT = 16;

type CanvasNodeDimensions = {
  width: number;
  height: number;
};

export function getPromptNodeDimensions(prompt: string) {
  const lineCount = estimatePromptLineCount(prompt);
  const height = clamp(
    Math.ceil(PROMPT_NODE_VERTICAL_PADDING + lineCount * PROMPT_NODE_LINE_HEIGHT),
    DEFAULT_PROMPT_NODE_HEIGHT,
    PROMPT_NODE_MAX_AUTO_HEIGHT
  );

  return {
    width: DEFAULT_CANVAS_NODE_WIDTH,
    height,
  };
}

export function getDefaultNodeDimensions(
  kind: AgentCanvasNodeData["kind"]
): CanvasNodeDimensions | null {
  if (kind === "markdown") {
    return DEFAULT_MARKDOWN_NODE_DIMENSIONS;
  }
  if (kind === "webpage") {
    return DEFAULT_WEBPAGE_NODE_DIMENSIONS;
  }

  return null;
}

export function getDefaultNodeDimensionProps(
  kind: AgentCanvasNodeData["kind"]
): Partial<Pick<AgentCanvasNode, "height" | "style" | "width">> {
  const dimensions = getDefaultNodeDimensions(kind);
  if (!dimensions) {
    return {};
  }

  return {
    ...dimensions,
    style: getDimensionStyle(dimensions),
  };
}

export function applyDefaultNodeDimensions<T extends AgentCanvasNode>(node: T): T {
  const dimensions = getDefaultNodeDimensions(node.data.kind);
  if (!dimensions) {
    return node;
  }

  const width = readExplicitNodeDimension(node, "width") ?? dimensions.width;
  const height = readExplicitNodeDimension(node, "height") ?? dimensions.height;

  return {
    ...node,
    width,
    height,
    style: {
      ...readNodeStyle(node),
      width,
      height,
    },
  };
}

export function readNodeDimension(
  node: AgentCanvasNode,
  dimension: "height" | "width"
) {
  const style = readNodeStyle(node);
  const value = node[dimension] ?? style[dimension] ?? node.measured?.[dimension];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function readExplicitNodeDimension(
  node: AgentCanvasNode,
  dimension: "height" | "width"
) {
  const style = readNodeStyle(node);
  const value = node[dimension] ?? style[dimension];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function getDimensionStyle(dimensions: CanvasNodeDimensions): CSSProperties {
  return {
    height: dimensions.height,
    width: dimensions.width,
  };
}

function readNodeStyle(node: AgentCanvasNode): CSSProperties {
  return node.style && typeof node.style === "object" ? node.style : {};
}

function estimatePromptLineCount(prompt: string) {
  const availableWidth =
    DEFAULT_CANVAS_NODE_WIDTH - PROMPT_NODE_HORIZONTAL_PADDING;
  const lines = prompt.split(/\r?\n/);
  return lines.reduce((sum, line) => {
    const width = estimateTextWidth(line.trim());
    return sum + Math.max(1, Math.ceil(width / availableWidth));
  }, 0);
}

function estimateTextWidth(text: string) {
  let width = 0;

  for (const char of text) {
    if (/\s/.test(char)) {
      width += 3.5;
    } else if (/[\u3400-\u9fff\uff00-\uffef]/.test(char)) {
      width += 12;
    } else {
      width += 6.5;
    }
  }

  return width;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
