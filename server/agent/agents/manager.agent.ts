import { Agent, handoff } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { hasBuiltInImageIntent } from "../skills/skill-retrieval.ts";
import { proposeCanvasOperationsTool } from "../tools/canvas/propose-canvas-operations.tool.ts";
import { activateSkillTool } from "../tools/skills/activate-skill.tool.ts";
import { runSkillScriptTool } from "../tools/skills/run-skill-script.tool.ts";
import { managerInstructions } from "../prompts/manager.instructions.ts";
import { createImageAgent } from "./image.agent.ts";

// NOTE: the model is intentionally NOT set here. It is resolved lazily at run
// time (see runtime.ts) because the model provider depends on environment
// variables that are loaded *after* this module is imported.
export function createManagerAgent({
  model,
}: {
  model?: Agent<CucumberAgentContext>["model"];
} = {}) {
  const imageAgent = createImageAgent({ model });

  return new Agent<CucumberAgentContext>({
    name: "Cucumber Manager",
    instructions: (runContext) => managerInstructions(runContext.context),
    ...(model ? { model } : {}),
    tools: [activateSkillTool, runSkillScriptTool, proposeCanvasOperationsTool],
    handoffs: [
      handoff(imageAgent, {
        isEnabled: ({ runContext }) => shouldEnableImageHandoff(runContext.context),
      }),
    ],
  });
}

function shouldEnableImageHandoff(context: CucumberAgentContext) {
  if (
    hasBuiltInImageIntent({
      message: context.prompt,
      upstreamContext: context.upstreamContext,
    })
  ) {
    return true;
  }

  return [...context.skillCandidates, ...context.activatedSkills].some(
    (skill) =>
      skill.agentScope === "image" ||
      skill.bindings.agents.some((agent) => /image/i.test(agent)) ||
      skill.bindings.tools.some((toolName) => /generate_image|upscale_image/i.test(toolName))
  );
}
