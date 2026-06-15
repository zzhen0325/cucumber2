import { Agent } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { proposeCanvasOperationsTool } from "../tools/canvas/propose-canvas-operations.tool.ts";
import { searchKnowledgeTool } from "../tools/knowledge/search-knowledge.tool.ts";
import { activateSkillTool } from "../tools/skills/activate-skill.tool.ts";
import { readSkillResourceTool } from "../tools/skills/read-skill-resource.tool.ts";
import { runSkillScriptTool } from "../tools/skills/run-skill-script.tool.ts";
import { managerInstructions } from "../prompts/manager.instructions.ts";
import {
  createSpecialistAgentRegistry,
  createSpecialistHandoffs,
} from "./registry.ts";

export function createManagerAgent() {
  const specialistRegistry = createSpecialistAgentRegistry();

  return new Agent<CucumberAgentContext>({
    name: "Cucumber Manager",
    instructions: (runContext) => managerInstructions(runContext.context),
    tools: [
      activateSkillTool,
      readSkillResourceTool,
      runSkillScriptTool,
      searchKnowledgeTool,
      proposeCanvasOperationsTool,
    ],
    handoffs: createSpecialistHandoffs(specialistRegistry),
  });
}
