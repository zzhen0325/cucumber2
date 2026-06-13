export const DEFAULT_CANVAS_NODE_WIDTH = 240;
export const DEFAULT_PROMPT_NODE_HEIGHT = 84;

const PROMPT_NODE_MAX_AUTO_HEIGHT = 420;
const PROMPT_NODE_HORIZONTAL_PADDING = 54;
const PROMPT_NODE_VERTICAL_PADDING = 44;
const PROMPT_NODE_LINE_HEIGHT = 16;

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
