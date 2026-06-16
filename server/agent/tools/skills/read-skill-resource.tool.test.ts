import { createHash } from "node:crypto";
import { RunContext } from "@openai/agents";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

import type { CucumberAgentContext } from "../../context.ts";
import type { ActivatedAgentSkill } from "../../skills/types.ts";

const mocks = vi.hoisted(() => ({
  downloadAgentSkillPackage: vi.fn(),
}));

vi.mock("../../../storage.ts", () => ({
  downloadAgentSkillPackage: mocks.downloadAgentSkillPackage,
}));

const { readSkillResourceTool } = await import("./read-skill-resource.tool.ts");

describe("read_skill_resource tool", () => {
  it("lists and reads text resources from an activated skill package", async () => {
    const bytes = await packageBytes();
    const sha = createHash("sha256").update(bytes).digest("hex");
    mocks.downloadAgentSkillPackage.mockResolvedValue(bytes);
    const context = agentContext({
      activatedSkills: [skill({ packageSha256: sha })],
    });

    const listedRaw = await readSkillResourceTool.invoke(
      new RunContext(context),
      JSON.stringify({ operation: "list", skillName: "full-skill" })
    );
    const listed = typeof listedRaw === "string" ? JSON.parse(listedRaw) : listedRaw;

    expect(listed.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "references/guide.md",
          readable: true,
        }),
        expect.objectContaining({
          path: "assets/preview.jpg",
          readable: false,
        }),
        expect.objectContaining({
          path: "README.md",
          readable: true,
          type: "unknown",
        }),
        expect.objectContaining({
          path: "scripts/run.mjs",
          readable: true,
          type: "script",
        }),
      ])
    );

    const readRaw = await readSkillResourceTool.invoke(
      new RunContext(context),
      JSON.stringify({
        operation: "read",
        resourcePath: "references/guide.md",
        skillName: "full-skill",
      })
    );
    const read = typeof readRaw === "string" ? JSON.parse(readRaw) : readRaw;

    expect(read.resource).toMatchObject({
      content: "# Guide\n\nUse this reference.",
      path: "references/guide.md",
      readable: true,
    });

    const scriptRaw = await readSkillResourceTool.invoke(
      new RunContext(context),
      JSON.stringify({
        operation: "read",
        resourcePath: "scripts/run.mjs",
        skillName: "full-skill",
      })
    );
    const script = typeof scriptRaw === "string" ? JSON.parse(scriptRaw) : scriptRaw;
    expect(script.resource).toMatchObject({
      content: "console.log('{}')",
      path: "scripts/run.mjs",
      readable: true,
      type: "script",
    });
  });
});

async function packageBytes() {
  const zip = new JSZip();
  zip.file("full-skill/SKILL.md", "---\nname: full-skill\n---\nBody");
  zip.file("full-skill/README.md", "extra docs");
  zip.file("full-skill/references/guide.md", "# Guide\n\nUse this reference.");
  zip.file("full-skill/assets/preview.jpg", "fake image bytes");
  zip.file("full-skill/scripts/run.mjs", "console.log('{}')");
  return zip.generateAsync({ type: "uint8array" });
}

function skill(overrides: Partial<ActivatedAgentSkill> = {}): ActivatedAgentSkill {
  return {
    agentScope: "general",
    bindings: { agents: [], scopes: [], tools: [] },
    body: "Use references/guide.md before answering.",
    capabilities: [],
    description: "Full skill with resources and scripts.",
    frontmatter: {},
    id: "skill-full",
    name: "full-skill",
    notFor: [],
    packageBucket: "agent-skill-packages",
    packagePath: "skills/full-skill/package.zip",
    packageSha256: "sha",
    packageSizeBytes: 1,
    purpose: "general",
    produces: [],
    reasons: [],
    score: 10,
    scripts: [
      {
        description: "Run script.",
        name: "run",
        path: "scripts/run.mjs",
        runtime: "node",
      },
    ],
    skillMd: "---\nname: full-skill\n---\nBody",
    sourceManifest: { skillPath: "full-skill/SKILL.md" },
    tags: [],
    triggers: { canvasKinds: [], keywords: [] },
    uses: [],
    ...overrides,
  };
}

function agentContext(
  overrides: Partial<CucumberAgentContext> = {}
): CucumberAgentContext {
  return {
    activatedSkills: [skill()],
    canvasId: "project-1",
    canvasSnapshot: { edges: [], nodes: [] },
    knownNodeIds: [],
    pendingEvents: [],
    producedArtifacts: [],
    projectId: "project-1",
    prompt: "hello",
    runNodeId: "run-1",
    selectedNodeId: null,
    selectedNodeIds: [],
    skillCandidates: [],
    upstreamContext: [],
    userId: "user-1",
    ...overrides,
  };
}
