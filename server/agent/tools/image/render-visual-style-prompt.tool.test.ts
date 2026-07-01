import { RunContext } from "@openai/agents";
import { describe, expect, it } from "vitest";

import type { CucumberAgentContext } from "../../context.ts";
import { makeTaskFrame } from "../../test-task-frame.ts";

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
    expect(result.negativePrompt).toBeUndefined();
    expect(result.prompt).not.toMatch(/negative prompt|source content to avoid|avoid this source content/i);
    expect(result.values.SOURCE_CONTENT_TO_AVOID).toBeUndefined();
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

  it("treats an unknown styleSlug as a search hint instead of failing", async () => {
    const raw = await renderVisualStylePromptTool.invoke(
      new RunContext(agentContext()),
      JSON.stringify({
        prompt:
          "Japanese household cleaning poster, blending realistic photography and playful doodle art style",
        styleSlug: "photo-doodle",
        values: {
          MAIN_TEXT: "clean home",
          SUBJECT: "Japanese home cleaning themed poster",
        },
      })
    );
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;

    expect(result.selectedStyle.slug).not.toBe("photo-doodle");
    expect(result.selectedStyle.slug).toMatch(/photo|doodle|snapshot|overlay/);
    expect(result.prompt).toContain("clean home");
  });

  it.each([
    {
      expectedSlug: "multi-color-beverage-splash-ad-system-style",
      prompt:
        "给一家真实茶饮店做夏季新品小红书竖版海报：青柠黄瓜气泡茶，标题写「清爽到冒泡」，需要产品广告感、明亮夏天、无品牌 logo。",
      values: {
        MAIN_TEXT: "清爽到冒泡",
        PRODUCT_OR_PROP: "一杯无品牌透明杯装青柠黄瓜气泡茶",
        SUBJECT: "青柠黄瓜气泡茶新品海报",
      },
    },
    {
      expectedSlug: "naive-marker-psa-poster-style",
      prompt:
        "社区夏季公益提醒海报，提醒老人和孩子高温天气多喝水，标题「记得喝水」，希望像手绘公告牌，亲切一点。",
      values: {
        MAIN_TEXT: "记得喝水",
        SUBJECT: "老人、孩子和社区志愿者在树荫下喝水",
      },
    },
    {
      expectedSlug: "quiet-luxury-furniture-nameplate-poster-style",
      prompt:
        "给一把真实电商要卖的胡桃木休闲椅做首图，强调安静、高级、家具目录感，标题「WALNUT REST」。",
      values: {
        MAIN_TEXT: "WALNUT REST",
        PRODUCT_OR_PROP: "一把无品牌胡桃木休闲椅，织物坐垫",
        SUBJECT: "胡桃木休闲椅电商首图",
      },
    },
  ])("chooses a suitable bundled style for real Chinese briefs", async (item) => {
    const raw = await renderVisualStylePromptTool.invoke(
      new RunContext(agentContext()),
      JSON.stringify({
        prompt: item.prompt,
        values: item.values,
      })
    );
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;

    expect(result.selectedStyle.slug).toBe(item.expectedSlug);
    expect(result.prompt).not.toMatch(/\{[A-Z0-9_]+\}/);
  });
});

function skill() {
  return {
    agentScope: "image",
    bindings: {
      agents: [],
      scopes: ["read.skill" as const, "tool.image.prompt" as const],
      tools: ["render_visual_style_prompt"],
    },
    body: "Use Visual Prompt Cookbook.",
    capabilities: [],
    description: "Reusable visual prompt cookbook.",
    enabled: true,
    frontmatter: {},
    id: "skill-cookbook",
    name: "visual-prompt-cookbook",
    notFor: [],
    packageBucket: null,
    packagePath: null,
    packageSha256: null,
    packageSizeBytes: null,
    purpose: "prompt_expansion",
    produces: [],
    reasons: ["test"],
    score: 10,
    scripts: [],
    skillMd: "---\nname: visual-prompt-cookbook\n---\nBody",
    sourceManifest: {
      assetRoot: "server/agent/skills/builtin/visual-prompt-cookbook",
    },
    tags: ["style-json"],
    triggers: { canvasKinds: [], keywords: [] },
    uses: [],
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
    normalizedInput: makeTaskFrame({
      rawInput: "黄瓜海报",
      domain: "image",
      intent: "image.generate",
      action: "create",
      primaryAgent: "image_agent",
      workflow: {
        outputArtifacts: ["image"],
        requiredAgents: ["image_agent"],
        requiredCapabilities: ["image-generation"],
      },
    }),
    runNodeId: "run-1",
    selectedNodeId: null,
    selectedNodeIds: [],
    skillCandidates: [],
    upstreamContext: [],
    userId: "user-1",
    ...overrides,
  };
}
