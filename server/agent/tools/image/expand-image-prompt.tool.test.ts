import { RunContext } from "@openai/agents";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CucumberAgentContext } from "../../context.ts";

const mocks = vi.hoisted(() => ({
  getDefaultAgentSkillDefinition: vi.fn(),
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

vi.mock("../../../supabase.ts", () => ({
  getDefaultAgentSkillDefinition: (
    input: Parameters<typeof mocks.getDefaultAgentSkillDefinition>[0]
  ) => mocks.getDefaultAgentSkillDefinition(input),
}));

vi.mock("../../model-config.ts", () => ({
  resolveAgentModel: () => mocks.resolveAgentModel(),
}));

const { expandImagePromptTool } = await import("./expand-image-prompt.tool.ts");

describe("expand_image_prompt tool", () => {
  beforeEach(() => {
    mocks.getDefaultAgentSkillDefinition.mockReset();
    mocks.resolveAgentModel.mockReset();
    mocks.runnerRun.mockReset();
  });

  it("is enabled only when an enabled default image prompt skill exists", async () => {
    const isEnabled = expandImagePromptTool.isEnabled as unknown as () => Promise<boolean>;

    mocks.getDefaultAgentSkillDefinition.mockResolvedValueOnce(null);
    await expect(isEnabled()).resolves.toBe(false);

    mocks.getDefaultAgentSkillDefinition.mockResolvedValueOnce(skill());
    await expect(isEnabled()).resolves.toBe(true);
  });

  it("runs the default skill and returns one expanded prompt", async () => {
    mocks.getDefaultAgentSkillDefinition.mockResolvedValue(skill());
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
    mocks.getDefaultAgentSkillDefinition.mockResolvedValue(skill());
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
    id: "skill-1",
    name: "imagegen-prompt-expander",
    description: "Expand compact prompts.",
    body: "Expand one image prompt.",
    enabled: true,
    isDefault: true,
  };
}

function agentContext(): CucumberAgentContext {
  return {
    userId: "user-1",
    projectId: "project-1",
    canvasId: "project-1",
    runNodeId: "run-1",
    canvasSnapshot: { nodes: [], edges: [] },
    selectedNodeIds: [],
    knownNodeIds: [],
    producedArtifacts: [],
    pendingEvents: [],
    prompt: "黄瓜海报",
    selectedNodeId: null,
    upstreamContext: [],
  };
}
