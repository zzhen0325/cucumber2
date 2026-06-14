import { RunContext } from "@openai/agents";
import { describe, expect, it } from "vitest";

import type { CucumberAgentContext } from "../../context.ts";

const { renderVisualStylePromptTool } = await import(
  "./render-visual-style-prompt.tool.ts"
);

describe("render_visual_style_prompt tool", () => {
  it("is enabled only after the visual prompt cookbook skill is activated", async () => {
    const isEnabled = renderVisualStylePromptTool.isEnabled as unknown as (
      runContext: RunContext<CucumberAgentContext>,
      agent: unknown
    ) => Promise<boolean>;

    await expect(
      isEnabled(new RunContext(agentContext({ activatedSkills: [] })), {})
    ).resolves.toBe(false);
    await expect(isEnabled(new RunContext(agentContext()), {})).resolves.toBe(true);
  });

  it("renders a bundled style prompt from explicit variables", async () => {
    const raw = await renderVisualStylePromptTool.invoke(
      new RunContext(agentContext()),
      JSON.stringify({
        aspectRatio: "16:9",
        prompt: "黄瓜气泡水新品海报",
        styleSlug: "mono-noir-type-portrait-poster-style",
        values: {
          BACKGROUND_ELEMENTS: "深色摄影棚背景和柔和阴影",
          LOCATION: "极简摄影棚",
          MAIN_TEXT: "fresh / after / dark.",
          PRODUCT_OR_PROP: "一瓶无品牌黄瓜气泡水",
          SECONDARY_TEXT: "limited batch",
          SUBJECT: "一位拿着黄瓜气泡水的年轻设计师",
          SUBJECT_ACTION: "安静地看向镜头",
          WARDROBE_STYLE: "深色工装夹克",
        },
      })
    );
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;

    expect(result).toMatchObject({
      selectedStyle: {
        slug: "mono-noir-type-portrait-poster-style",
      },
      skillName: "visual-prompt-cookbook",
    });
    expect(result.prompt).toContain("Mono Noir Type Portrait Poster Style");
    expect(result.prompt).toContain("fresh / after / dark.");
    expect(result.negativePrompt).toContain("watermark");
    expect(result.values.ASPECT_RATIO).toBe("16:9");
  });

  it("chooses a style when the caller omits styleSlug", async () => {
    const raw = await renderVisualStylePromptTool.invoke(
      new RunContext(agentContext()),
      JSON.stringify({
        prompt: "旅行 vlog 封面，东京街头，白色大字标题",
        values: {
          MAIN_TEXT: "tokyo day",
          SUBJECT: "背着相机的旅行者",
        },
      })
    );
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;

    expect(result.selectedStyle.slug).toContain("travel");
    expect(result.prompt).toContain("tokyo day");
  });
});

function skill() {
  return {
    agentScope: "image",
    bindings: { agents: [], tools: ["render_visual_style_prompt"] },
    body: "Use Visual Prompt Cookbook.",
    description: "Reusable visual prompt cookbook.",
    enabled: true,
    frontmatter: {},
    id: "skill-cookbook",
    isDefault: true,
    name: "visual-prompt-cookbook",
    packageBucket: null,
    packagePath: null,
    packageSha256: null,
    packageSizeBytes: null,
    purpose: "prompt_expansion",
    reasons: ["test"],
    score: 10,
    scripts: [],
    skillMd: "---\nname: visual-prompt-cookbook\n---\nBody",
    sourceManifest: {
      assetRoot: "server/agent/skills/builtin/visual-prompt-cookbook",
    },
    tags: ["style-json"],
    triggers: { canvasKinds: [], keywords: [] },
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
    prompt: "黄瓜海报",
    runNodeId: "run-1",
    selectedNodeId: null,
    selectedNodeIds: [],
    skillCandidates: [],
    upstreamContext: [],
    userId: "user-1",
    ...overrides,
  };
}
