import { Agent } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { activateSkillTool } from "../tools/skills/activate-skill.tool.ts";
import { expandImagePromptTool } from "../tools/image/expand-image-prompt.tool.ts";
import { generateImageTool } from "../tools/image/generate-image.tool.ts";
import { searchKnowledgeTool } from "../tools/knowledge/search-knowledge.tool.ts";
import { readSkillResourceTool } from "../tools/skills/read-skill-resource.tool.ts";
import { runSkillScriptTool } from "../tools/skills/run-skill-script.tool.ts";
import { renderVisualStylePromptTool } from "../tools/image/render-visual-style-prompt.tool.ts";
import { upscaleImageTool } from "../tools/image/upscale-image.tool.ts";
import { imageMattingTool } from "../tools/image/image-matting.tool.ts";
import {
  analyzeMediaTool,
  decomposeImageTool,
} from "../tools/image/image-inspection.tool.ts";
import { imageInstructions } from "../prompts/image.instructions.ts";

let imageAgent: Agent<CucumberAgentContext> | undefined;
let fastImageAgent: Agent<CucumberAgentContext> | undefined;

export function createImageAgent() {
  imageAgent ??= new Agent<CucumberAgentContext>({
    name: "Cucumber Image Agent",
    handoffDescription:
      "Image specialist. Delegate here for image generation, matting/background removal, image decomposition, media understanding, or upscaling requests.",
    instructions: (runContext) => imageInstructions(runContext.context),
    tools: [
      activateSkillTool,
      analyzeMediaTool,
      decomposeImageTool,
      expandImagePromptTool,
      generateImageTool,
      imageMattingTool,
      readSkillResourceTool,
      renderVisualStylePromptTool,
      runSkillScriptTool,
      searchKnowledgeTool,
      upscaleImageTool,
    ],
  });
  return imageAgent;
}

export function createFastImageAgent() {
  fastImageAgent ??= new Agent<CucumberAgentContext>({
    name: "Cucumber Image Fast Agent",
    handoffDescription:
      "Fast image generation specialist for straightforward new-image requests.",
    instructions: (runContext) => fastImageInstructions(runContext.context),
    tools: [generateImageTool],
  });
  return fastImageAgent;
}

function fastImageInstructions(context?: CucumberAgentContext) {
  const normalized = context?.normalizedInput
    ? `normalized_input: ${JSON.stringify(context.normalizedInput)}`
    : "";
  return [
    "You are Cucumber Image Fast Agent.",
    "Handle only straightforward new image-generation requests.",
    "Your first action must be exactly one generate_image tool call.",
    "Use normalized_input.image.contentPrompt as generate_image.prompt when present.",
    "Pass resultCount, aspectRatio, width/height, or variants from normalized_input.image when present.",
    "Do not call or mention skills, style libraries, prompt expansion, knowledge search, MCP, URLs, or canvas operations.",
    "After generate_image returns, reply briefly in the user's language with what was generated.",
    normalized,
  ]
    .filter(Boolean)
    .join("\n");
}
