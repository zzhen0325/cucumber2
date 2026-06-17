import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAgentSkillDefinitions: vi.fn(),
}));

vi.mock("../../supabase.ts", () => ({
  listAgentSkillDefinitions: () => mocks.listAgentSkillDefinitions(),
}));

const {
  getAgentSkillRegistryCacheState,
  invalidateAgentSkillRegistryCache,
  listCachedAgentSkillDefinitions,
} = await import("./skill-registry.ts");

describe("agent skill registry cache", () => {
  beforeEach(() => {
    invalidateAgentSkillRegistryCache();
    mocks.listAgentSkillDefinitions.mockReset();
  });

  it("serves repeated calls from memory within the ttl", async () => {
    mocks.listAgentSkillDefinitions.mockResolvedValue([skill("one")]);

    await expect(listCachedAgentSkillDefinitions({ now: 1000 })).resolves.toHaveLength(1);
    await expect(listCachedAgentSkillDefinitions({ now: 2000 })).resolves.toHaveLength(1);

    expect(mocks.listAgentSkillDefinitions).toHaveBeenCalledTimes(1);
    expect(getAgentSkillRegistryCacheState().cached).toBe(true);
  });

  it("deduplicates concurrent refreshes", async () => {
    let resolveSkills!: (skills: unknown[]) => void;
    mocks.listAgentSkillDefinitions.mockReturnValue(
      new Promise((resolve) => {
        resolveSkills = resolve;
      })
    );

    const first = listCachedAgentSkillDefinitions({ now: 1000 });
    const second = listCachedAgentSkillDefinitions({ now: 1000 });
    resolveSkills([skill("one")]);

    await expect(Promise.all([first, second])).resolves.toEqual([
      [skill("one")],
      [skill("one")],
    ]);
    expect(mocks.listAgentSkillDefinitions).toHaveBeenCalledTimes(1);
  });

  it("reloads after invalidation", async () => {
    mocks.listAgentSkillDefinitions
      .mockResolvedValueOnce([skill("one")])
      .mockResolvedValueOnce([skill("two")]);

    await expect(listCachedAgentSkillDefinitions({ now: 1000 })).resolves.toEqual([
      skill("one"),
    ]);
    invalidateAgentSkillRegistryCache();
    await expect(listCachedAgentSkillDefinitions({ now: 2000 })).resolves.toEqual([
      skill("two"),
    ]);

    expect(mocks.listAgentSkillDefinitions).toHaveBeenCalledTimes(2);
  });
});

function skill(name: string) {
  return {
    id: `skill-${name}`,
    name,
    enabled: true,
  };
}
