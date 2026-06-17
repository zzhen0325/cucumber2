import {
  listAgentSkillDefinitions,
  type AgentSkillDefinitionSummary,
} from "../../supabase.ts";

const DEFAULT_SKILL_REGISTRY_TTL_MS = 60_000;

type CachedSkillRegistry = {
  loadedAt: number;
  skills: AgentSkillDefinitionSummary[];
};

let cachedRegistry: CachedSkillRegistry | null = null;
let inflightRegistryLoad: Promise<AgentSkillDefinitionSummary[]> | null = null;

export async function listCachedAgentSkillDefinitions(
  options: { now?: number; ttlMs?: number } = {}
) {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_SKILL_REGISTRY_TTL_MS;
  if (cachedRegistry && now - cachedRegistry.loadedAt < ttlMs) {
    return cachedRegistry.skills;
  }

  if (!inflightRegistryLoad) {
    inflightRegistryLoad = listAgentSkillDefinitions()
      .then((skills) => {
        cachedRegistry = {
          loadedAt: Date.now(),
          skills,
        };
        return skills;
      })
      .finally(() => {
        inflightRegistryLoad = null;
      });
  }

  return inflightRegistryLoad;
}

export function invalidateAgentSkillRegistryCache() {
  cachedRegistry = null;
  inflightRegistryLoad = null;
}

export function getAgentSkillRegistryCacheState() {
  return {
    cached: Boolean(cachedRegistry),
    loadedAt: cachedRegistry?.loadedAt,
  };
}

export async function prewarmAgentSkillRegistry() {
  await listCachedAgentSkillDefinitions();
}
