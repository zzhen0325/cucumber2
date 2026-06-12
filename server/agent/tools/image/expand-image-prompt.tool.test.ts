import { RunContext } from "@openai/agents";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CucumberAgentContext } from "../../context.ts";

const mocks = vi.hoisted(() => ({
  resolveAgentModel: vi.fn(),
  runnerRun: vi.fn(),
}));

vi.mock("@openai/agents", async () => {
  const actual = await vi.importActual<typeof import("@openai/agents")>(
    "@openai/agents"
  );
  return {
    ...actual,
    Agent: class MockAgent {
      config: unknown;

      constructor(config: unknown) {
        this.config = config;
      }
    },
    Runner: class MockRunner {
      run(...args: unknown[]) {
        return mocks.runnerRun(...args);
      }
    },
  };
});

vi.mock("../../model-config.ts", () => ({
  resolveAgentModel: () => mocks.resolveAgentModel(),
}));

const { expandImagePromptTool } = await import("./expand-image-prompt.tool.ts");

describe("expand_image_prompt tool", () => {
  beforeEach(() => {
    mocks.resolveAgentModel.mockReset();
    mocks.runnerRun.mockReset();
  });

  it("is enabled only when an image prompt skill is activated", async () => {
    const isEnabled = expandImagePromptTool.isEnabled as unknown as (
      runContext: RunContext<CucumberAgentContext>,
      agent: unknown
    ) => Promise<boolean>;

    await expect(isEnabled(new RunContext(agentContext({ activatedSkills: [] })), {})).resolves.toBe(false);

    await expect(isEnabled(new RunContext(agentContext()), {})).resolves.toBe(true);
  });

  it("runs the activated skill and returns one expanded prompt", async () => {
    mocks.runnerRun.mockResolvedValue({
      finalOutput: "```text\n清爽黄瓜饮品海报，16:9 横版，自然光。\n```",
    });

    const raw = await expandImagePromptTool.invoke(
      new RunContext(agentContext()),
      JSON.stringify({ prompt: "黄瓜海报", reason: "缺少构图和风格" })
    );
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;

    expect(result).toEqual({
      expandedPrompt: "清爽黄瓜饮品海报，16:9 横版，自然光。",
      skillId: "skill-1",
      skillName: "imagegen-prompt-expander",
    });
    expect(mocks.runnerRun).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          instructions: expect.stringContaining("Expand one image prompt."),
          name: "Cucumber Image Prompt Expander",
        }),
      }),
      expect.stringContaining("Original user image prompt: 黄瓜海报"),
      expect.objectContaining({
        context: expect.objectContaining({ projectId: "project-1" }),
        maxTurns: 2,
      })
    );
  });

  it("propagates expander failures instead of returning fake success", async () => {
    mocks.runnerRun.mockRejectedValue(new Error("model failed"));

    await expect(
      expandImagePromptTool.invoke(
        new RunContext(agentContext()),
        JSON.stringify({ prompt: "黄瓜海报" })
      )
    ).rejects.toThrow("model failed");
  });
});

function skill() {
  return {
    agentScope: "image",
    bindings: { agents: [], tools: ["expand_image_prompt"] },
    frontmatter: {},
    id: "skill-1",
    name: "imagegen-prompt-expander",
    description: "Expand compact prompts.",
    body: "Expand one image prompt.",
    enabled: true,
    isDefault: true,
    packageBucket: null,
    packagePath: null,
    packageSha256: null,
    packageSizeBytes: null,
    purpose: "prompt_expansion",
    reasons: ["test"],
    score: 10,
    scripts: [],
    skillMd: "---\nname: imagegen-prompt-expander\n---\nBody",
    tags: [],
    triggers: { canvasKinds: [], keywords: [] },
  };
}

function agentContext(
  overrides: Partial<CucumberAgentContext> = {}
): CucumberAgentContext {
  return {
    userId: "user-1",
    projectId: "project-1",
    canvasId: "project-1",
    runNodeId: "run-1",
    canvasSnapshot: { nodes: [], edges: [] },
    selectedNodeIds: [],
    knownNodeIds: [],
    activatedSkills: [skill()],
    producedArtifacts: [],
    pendingEvents: [],
    prompt: "黄瓜海报",
    selectedNodeId: null,
    skillCandidates: [],
    upstreamContext: [],
    ...overrides,
  };
}
