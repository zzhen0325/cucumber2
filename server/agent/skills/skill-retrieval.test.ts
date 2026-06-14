import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentRunInput } from "../context.ts";

const mocks = vi.hoisted(() => ({
  listAgentSkillDefinitions: vi.fn(),
}));

vi.mock("../../supabase.ts", () => ({
  listAgentSkillDefinitions: () => mocks.listAgentSkillDefinitions(),
}));

const { retrieveRelevantAgentSkills } = await import("./skill-retrieval.ts");

describe("skill retrieval", () => {
  beforeEach(() => {
    mocks.listAgentSkillDefinitions.mockReset();
  });

  it("retrieves an image skill for image-generation intent without loading the body", async () => {
    mocks.listAgentSkillDefinitions.mockResolvedValue([
      skill({
        agentScope: "image",
        bindings: {
          agents: ["Cucumber Image Agent"],
          scopes: ["tool.image.prompt", "tool.image.generate"],
          tools: ["expand_image_prompt", "generate_image"],
        },
        description: "Expand short image prompts.",
        name: "imagegen-prompt-expander",
        purpose: "prompt_expansion",
        triggers: {
          canvasKinds: ["imageResult"],
          keywords: ["生成图片", "海报"],
        },
      }),
      skill({
        agentScope: "general",
        description: "Summarize documents.",
        name: "doc-summary",
        purpose: "summary",
        triggers: { canvasKinds: ["doc"], keywords: ["总结"] },
      }),
    ]);

    const candidates = await retrieveRelevantAgentSkills(
      input({ message: "生成一张黄瓜海报" })
    );

    expect(candidates[0]).toMatchObject({
      name: "imagegen-prompt-expander",
      reasons: expect.arrayContaining(["image-intent"]),
    });
    expect(JSON.stringify(candidates[0])).not.toContain("Skill body");
  });

  it("prefers the visual prompt cookbook over the generic expander for image intent", async () => {
    mocks.listAgentSkillDefinitions.mockResolvedValue([
      skill({
        agentScope: "image",
        bindings: {
          agents: ["Cucumber Image Agent"],
          scopes: ["tool.image.prompt", "tool.image.generate"],
          tools: ["expand_image_prompt", "generate_image"],
        },
        description: "Expand short image prompts.",
        name: "imagegen-prompt-expander",
        purpose: "prompt_expansion",
        triggers: {
          canvasKinds: ["imageResult"],
          keywords: ["生成图片", "海报"],
        },
      }),
      skill({
        agentScope: "image",
        bindings: {
          agents: ["Cucumber Image Agent"],
          scopes: ["read.skill", "tool.image.prompt", "tool.image.generate"],
          tools: ["render_visual_style_prompt", "generate_image"],
        },
        description: "Reusable style.json systems for visual prompts.",
        name: "visual-prompt-cookbook",
        purpose: "prompt_expansion",
        tags: ["style-json"],
        triggers: {
          canvasKinds: ["imageResult"],
          keywords: ["生成图片", "海报", "poster"],
        },
      }),
    ]);

    const candidates = await retrieveRelevantAgentSkills(
      input({ message: "生成一张黄瓜海报" })
    );

    expect(candidates[0]).toMatchObject({
      name: "visual-prompt-cookbook",
      reasons: expect.arrayContaining(["visual-style-cookbook"]),
    });
  });

  it("keeps unrelated image skills below matching general skills", async () => {
    mocks.listAgentSkillDefinitions.mockResolvedValue([
      skill({
        agentScope: "image",
        description: "Expand short image prompts.",
        name: "imagegen-prompt-expander",
        purpose: "prompt_expansion",
        triggers: { canvasKinds: [], keywords: ["生成图片"] },
      }),
      skill({
        agentScope: "general",
        description: "Write markdown research notes.",
        name: "research-notes",
        purpose: "markdown",
        tags: ["research", "markdown"],
        triggers: { canvasKinds: ["prompt"], keywords: ["调研"] },
      }),
    ]);

    const candidates = await retrieveRelevantAgentSkills(
      input({ message: "帮我调研一下这个功能并输出 markdown" })
    );

    expect(candidates[0]?.name).toBe("research-notes");
  });
});

function input(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    canvasId: "project-1",
    canvasSnapshot: {
      edges: [],
      nodes: [
        {
          id: "prompt-1",
          position: { x: 0, y: 0 },
          type: "promptNode",
          data: {
            kind: "prompt",
            contextLabel: "Root",
            createdAt: "2026-06-12T00:00:00.000Z",
            prompt: "root",
          },
        },
      ],
    },
    message: "hello",
    projectId: "project-1",
    promptNodeId: "prompt-1",
    runNodeId: "run-1",
    selectedNodeId: null,
    selectedNodeIds: [],
    upstreamContext: [],
    userId: "user-1",
    ...overrides,
  };
}

function skill(overrides: Record<string, unknown>) {
  return {
    id: `skill-${String(overrides.name)}`,
    name: "skill",
    description: "Skill description",
    agentScope: "general",
    purpose: "general",
    tags: [],
    triggers: { canvasKinds: [], keywords: [] },
    bindings: { agents: [], scopes: [], tools: [] },
    scripts: [],
    packageBucket: null,
    packagePath: null,
    packageSha256: null,
    packageSizeBytes: null,
    enabled: true,
    sourceType: "manual",
    sourceManifest: {},
    createdBy: null,
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    ...overrides,
  };
}
