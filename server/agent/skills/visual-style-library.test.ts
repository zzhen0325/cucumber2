import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

import type { ActivatedAgentSkill } from "./types.ts";

const mocks = vi.hoisted(() => ({
  downloadAgentSkillPackage: vi.fn(),
}));

vi.mock("../../storage.ts", () => ({
  downloadAgentSkillPackage: mocks.downloadAgentSkillPackage,
}));

const { loadVisualStyleLibrary } = await import("./visual-style-library.ts");

describe("visual style library", () => {
  it("loads style systems from an uploaded skill package", async () => {
    const bytes = await visualStyleZip();
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(bytes).digest("hex");
    mocks.downloadAgentSkillPackage.mockResolvedValue(bytes);

    const library = await loadVisualStyleLibrary(
      skill({
        packageSha256: sha,
      })
    );
    const style = await library.loadStyle("clean-test-style");

    expect(library.catalog).toEqual([
      expect.objectContaining({
        slug: "clean-test-style",
        summary: "Clean test visuals.",
      }),
    ]);
    expect(style.prompt_template).toBe("Create {ASPECT_RATIO} image of {SUBJECT}.");
    expect(mocks.downloadAgentSkillPackage).toHaveBeenCalledWith({
      bucket: "agent-skill-packages",
      path: "skills/custom-style-cookbook/package.zip",
    });
  });
});

async function visualStyleZip() {
  const zip = new JSZip();
  zip.file(
    "custom-style-cookbook/references/styles/clean-test-style/style.json",
    JSON.stringify({
      environment_variables: { ASPECT_RATIO: "ratio", SUBJECT: "subject" },
      negative_prompt: "watermark",
      prompt_template: "Create {ASPECT_RATIO} image of {SUBJECT}.",
      style_name: "Clean Test Style",
      style_slug: "clean-test-style",
      style_summary: "Clean test visuals.",
    })
  );
  return zip.generateAsync({ type: "uint8array" });
}

function skill(overrides: Partial<ActivatedAgentSkill> = {}): ActivatedAgentSkill {
  return {
    agentScope: "image",
    bindings: {
      agents: [],
      scopes: ["read.skill" as const, "tool.image.prompt" as const],
      tools: ["render_visual_style_prompt"],
    },
    body: "Use visual styles.",
    description: "Custom style cookbook.",
    frontmatter: {},
    id: "skill-visual",
    name: "custom-style-cookbook",
    packageBucket: "agent-skill-packages",
    packagePath: "skills/custom-style-cookbook/package.zip",
    packageSha256: "sha",
    packageSizeBytes: 1,
    purpose: "prompt_expansion",
    reasons: [],
    score: 10,
    scripts: [],
    skillMd: "---\nname: custom-style-cookbook\n---\nBody",
    sourceManifest: {},
    tags: ["style-json"],
    triggers: { canvasKinds: [], keywords: [] },
    ...overrides,
  };
}
