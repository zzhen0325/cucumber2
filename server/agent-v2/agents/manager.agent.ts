import { Agent } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { createArtifactTool } from "../tools/artifact/create-artifact.tool.ts";
import { attachArtifactTool } from "../tools/artifact/attach-artifact.tool.ts";
import { proposeCanvasOperationsTool } from "../tools/canvas/propose-canvas-operations.tool.ts";
import { managerInstructions } from "../prompts/manager.instructions.ts";

export const managerAgent = new Agent<CucumberAgentContext>({
  name: "Cucumber Manager",
  instructions: managerInstructions,
  tools: [proposeCanvasOperationsTool, createArtifactTool, attachArtifactTool],
});
