import { Agent, handoff, type RunContext } from "@openai/agents";
import { Capabilities, SandboxAgent, type Capability } from "@openai/agents/sandbox";

import type { CucumberAgentContext } from "../context.ts";
import { hasBuiltInImageIntent } from "../skills/skill-retrieval.ts";
import { proposeCanvasOperationsTool } from "../tools/canvas/propose-canvas-operations.tool.ts";
import { managerInstructions } from "../prompts/manager.instructions.ts";
import { createImageAgent } from "./image.agent.ts";

// NOTE: the model is intentionally NOT set here. It is resolved lazily at run
// time (see runtime.ts) because the model provider depends on environment
// variables that are loaded *after* this module is imported.
export function createManagerAgent({
  skillCapability,
  model,
}: {
  skillCapability?: Capability;
  model?: Agent<CucumberAgentContext>["model"];
} = {}) {
  const imageAgent = createImageAgent({ model, skillCapability });
  const commonConfig = {
    handoffs: [
      handoff(imageAgent, {
        isEnabled: ({ runContext }) => shouldEnableImageHandoff(runContext.context),
      }),
    ],
    instructions: (runContext: RunContext<CucumberAgentContext>) =>
      managerInstructions(runContext.context),
    ...(model ? { model } : {}),
    name: "Cucumber Manager",
    tools: [proposeCanvasOperationsTool],
  };

  if (skillCapability) {
    return new SandboxAgent<CucumberAgentContext>({
      ...commonConfig,
      capabilities: [...Capabilities.default(), skillCapability],
    });
  }

  return new Agent<CucumberAgentContext>({
    ...commonConfig,
  });
}

function shouldEnableImageHandoff(context: CucumberAgentContext) {
  if (
    context.normalizedInput?.intent === "image.generate" ||
    context.normalizedInput?.intent === "image.upscale"
  ) {
    return true;
  }

  if (
    hasBuiltInImageIntent({
      message: context.prompt,
      upstreamContext: context.upstreamContext,
    })
  ) {
    return true;
  }

  return context.skillCandidates.some(
    (skill) =>
      skill.agentScope === "image" ||
      skill.bindings.agents.some((agent) => /image/i.test(agent)) ||
      skill.bindings.tools.some((toolName) => /generate_image|upscale_image/i.test(toolName))
  );
}
