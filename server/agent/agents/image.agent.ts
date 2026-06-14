import { Agent } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { activateSkillTool } from "../tools/skills/activate-skill.tool.ts";
import { expandImagePromptTool } from "../tools/image/expand-image-prompt.tool.ts";
import { getCucumberInternalMcpServer } from "../mcp/internal-mcp-client.ts";
import { runSkillScriptTool } from "../tools/skills/run-skill-script.tool.ts";
import { upscaleImageTool } from "../tools/image/upscale-image.tool.ts";
import { imageInstructions } from "../prompts/image.instructions.ts";

// NOTE: like the manager agent, the model is intentionally NOT set here. It is
// resolved lazily at run time (see runtime.ts) because the model provider
// depends on environment variables loaded *after* this module is imported.
export function createImageAgent({
  model,
}: {
  model?: Agent<CucumberAgentContext>["model"];
} = {}) {
  return new Agent<CucumberAgentContext>({
    name: "Cucumber Image Agent",
    handoffDescription:
      "Image specialist. Delegate here for any request that needs images generated, created, edited, or upscaled (with or without reference images on the canvas).",
    instructions: (runContext) => imageInstructions(runContext.context),
    ...(model ? { model } : {}),
    mcpConfig: {
      convertSchemasToStrict: false,
      errorFunction: null,
      includeServerInToolNames: false,
    },
    mcpServers: [getCucumberInternalMcpServer()],
    tools: [
      activateSkillTool,
      expandImagePromptTool,
      runSkillScriptTool,
      upscaleImageTool,
    ],
  });
}
