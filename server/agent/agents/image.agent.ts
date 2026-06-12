import { Agent } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { generateImageTool } from "../tools/image/generate-image.tool.ts";
import { upscaleImageTool } from "../tools/image/upscale-image.tool.ts";
import { imageInstructions } from "../prompts/image.instructions.ts";

// NOTE: like the manager agent, the model is intentionally NOT set here. It is
// resolved lazily at run time (see runtime.ts) because the model provider
// depends on environment variables loaded *after* this module is imported.
export const imageAgent = new Agent<CucumberAgentContext>({
  name: "Cucumber Image Agent",
  handoffDescription:
    "Image specialist. Delegate here for any request that needs images generated, created, edited, or upscaled (with or without reference images on the canvas).",
  instructions: imageInstructions,
  tools: [generateImageTool, upscaleImageTool],
});
