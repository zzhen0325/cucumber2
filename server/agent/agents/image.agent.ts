import { Agent } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { activateSkillTool } from "../tools/skills/activate-skill.tool.ts";
import { expandImagePromptTool } from "../tools/image/expand-image-prompt.tool.ts";
import { getCucumberInternalMcpServer } from "../mcp/internal-mcp-client.ts";
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

export function createImageAgent() {
  imageAgent ??= new Agent<CucumberAgentContext>({
    name: "Cucumber Image Agent",
    handoffDescription:
      "Image specialist. Delegate here for image generation, matting/background removal, image decomposition, media understanding, or upscaling requests.",
    instructions: (runContext) => imageInstructions(runContext.context),
    mcpConfig: {
      convertSchemasToStrict: false,
      errorFunction: null,
      includeServerInToolNames: false,
    },
    mcpServers: [getCucumberInternalMcpServer()],
    tools: [
      activateSkillTool,
      analyzeMediaTool,
      decomposeImageTool,
      expandImagePromptTool,
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
