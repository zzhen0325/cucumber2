import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  downloadAgentSkillPackage: vi.fn(),
  getAgentSkillDefinition: vi.fn(),
}));

vi.mock("../../supabase.ts", () => ({
  getAgentSkillDefinition: (id: string) => mocks.getAgentSkillDefinition(id),
}));

vi.mock("../../storage.ts", () => ({
  downloadAgentSkillPackage: (input: { bucket: string; path: string }) =>
    mocks.downloadAgentSkillPackage(input),
}));

const { prepareSdkSkillSource } = await import("./sdk-skill-source.ts");

describe("SDK skill source adapter", () => {
  beforeEach(() => {
    mocks.downloadAgentSkillPackage.mockReset();
    mocks.getAgentSkillDefinition.mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("materializes a zip-backed skill as an SDK lazy skill source", async () => {
    const skillMd = `---
name: sdk-skill
description: SDK native skill.
---

# SDK Skill

Use references and scripts.
`;
    const packageBytes = await zipBytes({
      "sdk-skill/SKILL.md": skillMd,
      "sdk-skill/assets/template.txt": "asset",
      "sdk-skill/references/guide.md": "# Guide",
      "sdk-skill/scripts/run.mjs": "console.log('ok')",
    });
    const packageSha256 = createHash("sha256").update(packageBytes).digest("hex");

    mocks.downloadAgentSkillPackage.mockResolvedValue(packageBytes);
    mocks.getAgentSkillDefinition.mockResolvedValue({
      ...skillDefinition({
        description: "SDK native skill.",
        name: "sdk-skill",
        packageSha256,
        skillMd,
      }),
    });

    const source = await prepareSdkSkillSource([skillCard({ name: "sdk-skill" })]);

    expect(source?.index).toEqual([
      {
        description: "SDK native skill.",
        name: "sdk-skill",
        path: "sdk-skill",
      },
    ]);
    expect(source?.rootDir.startsWith(path.join(process.cwd(), ".cucumber-runtime"))).toBe(true);
    await expect(
      readFile(path.join(source?.rootDir ?? "", "sdk-skill", "references", "guide.md"), "utf8")
    ).resolves.toBe("# Guide");
    await expect(
      readFile(path.join(source?.rootDir ?? "", "sdk-skill", "assets", "template.txt"), "utf8")
    ).resolves.toBe("asset");

    await source?.cleanup();
    await expect(stat(source?.rootDir ?? "")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes manual skills as SKILL.md files", async () => {
    const skillMd = `---
name: manual-skill
description: Manual SDK skill.
---

# Manual Skill
`;
    mocks.getAgentSkillDefinition.mockResolvedValue(
      skillDefinition({
        name: "manual-skill",
        packageBucket: null,
        packagePath: null,
        packageSha256: null,
        skillMd,
      })
    );

    const source = await prepareSdkSkillSource([skillCard({ name: "manual-skill" })]);

    await expect(
      readFile(path.join(source?.rootDir ?? "", "manual-skill", "SKILL.md"), "utf8")
    ).resolves.toBe(skillMd);
    await source?.cleanup();
  });
});

async function zipBytes(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [fileName, content] of Object.entries(files)) {
    zip.file(fileName, content);
  }
  return zip.generateAsync({ type: "uint8array" });
}

function skillCard(overrides: Record<string, unknown>) {
  return {
    id: "skill-1",
    name: "skill",
    description: "Skill description",
    agentScope: "general",
    purpose: "general",
    tags: [],
    triggers: { canvasKinds: [], keywords: [] },
    bindings: { agents: [], tools: [] },
    scripts: [],
    isDefault: false,
    score: 1,
    reasons: ["test"],
    ...overrides,
  };
}

function skillDefinition(overrides: Record<string, unknown>) {
  return {
    ...skillCard(overrides),
    body: "# Skill",
    createdAt: "2026-06-12T00:00:00.000Z",
    createdBy: null,
    enabled: true,
    frontmatter: {},
    packageBucket: "agent-skill-packages",
    packagePath: "skills/sdk-skill/hash.zip",
    packageSha256: "0".repeat(64),
    packageSizeBytes: 100,
    skillMd: "---\nname: skill\ndescription: Skill.\n---\n\n# Skill",
    sourceManifest: {},
    sourceType: "zip",
    updatedAt: "2026-06-12T00:00:00.000Z",
    ...overrides,
  };
}
