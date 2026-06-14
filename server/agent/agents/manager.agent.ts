import { Agent } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { proposeCanvasOperationsTool } from "../tools/canvas/propose-canvas-operations.tool.ts";
import { activateSkillTool } from "../tools/skills/activate-skill.tool.ts";
import { readSkillResourceTool } from "../tools/skills/read-skill-resource.tool.ts";
import { runSkillScriptTool } from "../tools/skills/run-skill-script.tool.ts";
import { managerInstructions } from "../prompts/manager.instructions.ts";
import {
  createSpecialistAgentRegistry,
  createSpecialistHandoffs,
} from "./registry.ts";

// NOTE: the model is intentionally NOT set here. It is resolved lazily at run
// time (see runtime.ts) because the model provider depends on environment
// variables that are loaded *after* this module is imported.
export function createManagerAgent({
  model,
}: {
  model?: Agent<CucumberAgentContext>["model"];
} = {}) {
  const specialistRegistry = createSpecialistAgentRegistry({ model });

  return new Agent<CucumberAgentContext>({
    name: "Cucumber Manager",
    instructions: (runContext) => managerInstructions(runContext.context),
    ...(model ? { model } : {}),
    tools: [
      activateSkillTool,
      readSkillResourceTool,
      runSkillScriptTool,
      proposeCanvasOperationsTool,
    ],
    handoffs: createSpecialistHandoffs(specialistRegistry),
  });
}
