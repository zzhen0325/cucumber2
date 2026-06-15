import { handoff, type Agent } from "@openai/agents";

import type { ArtifactType } from "../../../src/types/canvas.ts";
import type { NormalizedIntent } from "../input-normalizer.ts";
import type { CucumberAgentContext } from "../context.ts";
import { hasBuiltInImageIntent } from "../skills/skill-retrieval.ts";
import { createDocumentAgent } from "./document.agent.ts";
import { createImageAgent } from "./image.agent.ts";
import { createResearchAgent } from "./research.agent.ts";
import { createWebAgent } from "./web.agent.ts";

type SpecialistAgentDefinition = {
  agent: Agent<CucumberAgentContext>;
  enabledIntents: NormalizedIntent[];
  handoffPolicy: (context: CucumberAgentContext) => boolean;
  name: string;
  producedArtifactTypes: ArtifactType[];
  requiredTools: string[];
};

export function createSpecialistAgentRegistry(): SpecialistAgentDefinition[] {
  return [
    {
      agent: createDocumentAgent(),
      enabledIntents: ["document.create", "document.edit"],
      handoffPolicy: shouldEnableDocumentHandoff,
      name: "Cucumber Document Agent",
      producedArtifactTypes: ["doc"],
      requiredTools: ["create_text_artifact"],
    },
    {
      agent: createWebAgent(),
      enabledIntents: ["web.fetch"],
      handoffPolicy: shouldEnableWebHandoff,
      name: "Cucumber Web Agent",
      producedArtifactTypes: ["webpage"],
      requiredTools: ["fetch_webpage"],
    },
    {
      agent: createResearchAgent(),
      enabledIntents: ["research.answer"],
      handoffPolicy: shouldEnableResearchHandoff,
      name: "Cucumber Research Agent",
      producedArtifactTypes: ["doc"],
      requiredTools: ["collect_research_sources", "create_research_artifact"],
    },
    {
      agent: createImageAgent(),
      enabledIntents: ["image.generate", "image.upscale"],
      handoffPolicy: shouldEnableImageHandoff,
      name: "Cucumber Image Agent",
      producedArtifactTypes: ["image"],
      requiredTools: ["generate_image", "upscale_image"],
    },
  ];
}

export function createSpecialistHandoffs(
  registry: SpecialistAgentDefinition[]
) {
  return registry.map((definition) =>
    handoff(definition.agent, {
      isEnabled: ({ runContext }) =>
        isSpecialistEnabledForContext(definition, runContext.context),
    })
  );
}

export function isSpecialistEnabledForContext(
  definition: Pick<SpecialistAgentDefinition, "enabledIntents" | "handoffPolicy">,
  context: CucumberAgentContext
) {
  const intent = context.normalizedInput?.intent;
  if (intent && definition.enabledIntents.includes(intent)) {
    return true;
  }
  return definition.handoffPolicy(context);
}

function shouldEnableDocumentHandoff(context: CucumberAgentContext) {
  return [...context.skillCandidates, ...context.activatedSkills].some(
    (skill) =>
      skill.agentScope === "document" ||
      skill.bindings.agents.some((agent) => /document/i.test(agent)) ||
      skill.bindings.tools.some((toolName) => /create_text_artifact|doc|markdown/i.test(toolName))
  );
}

function shouldEnableWebHandoff(context: CucumberAgentContext) {
  return [...context.skillCandidates, ...context.activatedSkills].some(
    (skill) =>
      skill.agentScope === "web" ||
      skill.bindings.agents.some((agent) => /web/i.test(agent)) ||
      skill.bindings.tools.some((toolName) => /fetch_webpage|web/i.test(toolName))
  );
}

function shouldEnableResearchHandoff(context: CucumberAgentContext) {
  return [...context.skillCandidates, ...context.activatedSkills].some(
    (skill) =>
      skill.agentScope === "research" ||
      skill.bindings.agents.some((agent) => /research/i.test(agent)) ||
      skill.bindings.tools.some((toolName) =>
        /collect_research_sources|create_research_artifact|research/i.test(toolName)
      )
  );
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
