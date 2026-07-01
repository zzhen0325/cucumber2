import { handoff, type Agent } from "@openai/agents";

import type { ArtifactType } from "../../../src/types/canvas.ts";
import { getAgentCapabilityRoute } from "../agent-capability-manifest.ts";
import {
  selectAgentRoutesForTask,
  type SpecialistRoute,
} from "../task-router.ts";
import type { CucumberAgentContext } from "../context.ts";
import type { AgentModelProviderName } from "../model-config.ts";
import { createDocumentAgent } from "./document.agent.ts";
import { createImageAgent } from "./image.agent.ts";
import { createResearchAgent } from "./research.agent.ts";
import { createWebAgent } from "./web.agent.ts";

type SpecialistAgentDefinition = {
  agent: Agent<CucumberAgentContext>;
  enabledRoutes: SpecialistRoute[];
  handoffPolicy: (context: CucumberAgentContext) => boolean;
  name: string;
  producedArtifactTypes: ArtifactType[];
  requiredTools: string[];
};

const specialistAgentRegistries = new Map<string, SpecialistAgentDefinition[]>();

export function createSpecialistAgentRegistry(
  agentProvider?: AgentModelProviderName
): SpecialistAgentDefinition[] {
  const cacheKey = agentProvider ?? "auto";
  const cachedRegistry = specialistAgentRegistries.get(cacheKey);
  if (cachedRegistry) {
    return cachedRegistry;
  }
  const documentCapability = requireCapabilityRoute("document");
  const webCapability = requireCapabilityRoute("web");
  const researchCapability = requireCapabilityRoute("research");
  const imageCapability = requireCapabilityRoute("image");

  const specialistAgentRegistry: SpecialistAgentDefinition[] = [
    {
      agent: createDocumentAgent(),
      enabledRoutes: ["document"],
      handoffPolicy: shouldEnableDocumentHandoff,
      name: documentCapability.agentName,
      producedArtifactTypes: documentCapability.producedArtifactTypes,
      requiredTools: documentCapability.requiredTools,
    },
    {
      agent: createWebAgent(),
      enabledRoutes: ["web"],
      handoffPolicy: shouldEnableWebHandoff,
      name: webCapability.agentName,
      producedArtifactTypes: webCapability.producedArtifactTypes,
      requiredTools: webCapability.requiredTools,
    },
    {
      agent: createResearchAgent(agentProvider),
      enabledRoutes: ["research"],
      handoffPolicy: shouldEnableResearchHandoff,
      name: researchCapability.agentName,
      producedArtifactTypes: researchCapability.producedArtifactTypes,
      requiredTools: researchCapability.requiredTools,
    },
    {
      agent: createImageAgent(),
      enabledRoutes: ["image"],
      handoffPolicy: shouldEnableImageHandoff,
      name: imageCapability.agentName,
      producedArtifactTypes: imageCapability.producedArtifactTypes,
      requiredTools: imageCapability.requiredTools,
    },
  ];
  specialistAgentRegistries.set(cacheKey, specialistAgentRegistry);
  return specialistAgentRegistry;
}

function requireCapabilityRoute(route: SpecialistRoute) {
  const definition = getAgentCapabilityRoute(route);
  if (!definition) {
    throw new Error(`Missing agent capability route: ${route}`);
  }
  return definition;
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
  definition: Pick<SpecialistAgentDefinition, "enabledRoutes" | "handoffPolicy">,
  context: CucumberAgentContext
) {
  if (context.normalizedInput) {
    const routes = selectAgentRoutesForTask(context.normalizedInput);
    return routes.some((route) => definition.enabledRoutes.includes(route));
  }
  return definition.handoffPolicy(context);
}

function shouldEnableDocumentHandoff(context: CucumberAgentContext) {
  return [...context.skillCandidates, ...context.activatedSkills].some(
    (skill) =>
      skill.agentScope === "document" ||
      skill.bindings.agents.some((agent) => /document/i.test(agent)) ||
      skill.bindings.tools.some((toolName) =>
        /create_text_artifact|doc|markdown|html|webpage|code/i.test(toolName)
      )
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
  return [...context.skillCandidates, ...context.activatedSkills].some(
    (skill) =>
      skill.agentScope === "image" ||
      skill.bindings.agents.some((agent) => /image/i.test(agent)) ||
      skill.bindings.tools.some((toolName) =>
        /decompose_image|generate_image|image_matting|upscale_image/i.test(
          toolName
        )
      )
  );
}
