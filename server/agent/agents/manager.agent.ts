import { Agent } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import type { AgentModelProviderName } from "../model-config.ts";
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

const managerAgents = new Map<string, Agent<CucumberAgentContext>>();

export function createManagerAgent(agentProvider?: AgentModelProviderName) {
  const cacheKey = agentProvider ?? "auto";
  const cachedAgent = managerAgents.get(cacheKey);
  if (cachedAgent) {
    return cachedAgent;
  }
  const managerAgent = new Agent<CucumberAgentContext>({
    name: "Cucumber Manager",
    instructions: (runContext) => managerInstructions(runContext.context),
    tools: [
      activateSkillTool,
      readSkillResourceTool,
      runSkillScriptTool,
      searchKnowledgeTool,
      proposeCanvasOperationsTool,
    ],
    handoffs: createSpecialistHandoffs(createSpecialistAgentRegistry(agentProvider)),
  });
  managerAgents.set(cacheKey, managerAgent);
  return managerAgent;
}
