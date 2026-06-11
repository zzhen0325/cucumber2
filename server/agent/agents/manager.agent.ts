import { Agent } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { createArtifactTool } from "../tools/artifact/create-artifact.tool.ts";
import { attachArtifactTool } from "../tools/artifact/attach-artifact.tool.ts";
import { proposeCanvasOperationsTool } from "../tools/canvas/propose-canvas-operations.tool.ts";
import { managerInstructions } from "../prompts/manager.instructions.ts";
import { imageAgent } from "./image.agent.ts";

// NOTE: the model is intentionally NOT set here. It is resolved lazily at run
// time (see runtime.ts) because the model provider depends on environment
// variables that are loaded *after* this module is imported.
export const managerAgent = new Agent<CucumberAgentContext>({
  name: "Cucumber Manager",
  instructions: managerInstructions,
  tools: [proposeCanvasOperationsTool, createArtifactTool, attachArtifactTool],
  handoffs: [imageAgent],
});
