import { RunContext } from "@openai/agents";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CucumberAgentContext } from "../../context.ts";

const mocks = vi.hoisted(() => ({
  listAgentSkillDefinitions: vi.fn(),
}));

vi.mock("../../../supabase.ts", () => ({
  listAgentSkillDefinitions: () => mocks.listAgentSkillDefinitions(),
}));

const { setTaskFrameTool } = await import("./set-task-frame.tool.ts");
const { invalidateAgentSkillRegistryCache } = await import("../../skills/skill-registry.ts");

describe("set_task_frame tool", () => {
  beforeEach(() => {
    invalidateAgentSkillRegistryCache();
    mocks.listAgentSkillDefinitions.mockReset();
  });

  it("sets the runtime task frame and retrieves matching skill cards", async () => {
    mocks.listAgentSkillDefinitions.mockResolvedValue([
      {
        agentScope: "image",
        bindings: {
          agents: [],
          scopes: ["tool.image.generate"],
          tools: ["generate_image"],
        },
        capabilities: [
          {
            artifact: { kind: "image" },
            operation: "create",
            requiredCapabilities: ["image-generation"],
          },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        description: "Image prompt skill.",
        enabled: true,
        id: "skill-image",
        name: "image-prompt",
        notFor: [],
        produces: ["image"],
        purpose: "prompt_expansion",
        scripts: [],
        sourceManifest: {},
        tags: ["image"],
        triggers: { canvasKinds: [], keywords: ["海报"] },
        updatedAt: "2026-01-01T00:00:00.000Z",
        uses: [],
      },
    ]);
    const context = agentContext();

    const raw = await setTaskFrameTool.invoke(
      new RunContext(context),
      JSON.stringify({
        rawInput: "生成 4 张 16:9 黄瓜海报",
        task: {
          action: "create",
          confidence: 0.98,
          domain: "image",
          intent: "image.generate",
        },
        userGoal: {
          original: "生成 4 张 16:9 黄瓜海报",
          normalized: "生成 4 张 16:9 黄瓜海报",
        },
        routing: {
          primaryAgent: "image_agent",
          candidateAgents: [],
          reason: "Super Agent selected image generation capability.",
        },
        inputs: {
          text: "生成 4 张 16:9 黄瓜海报",
        },
        constraints: {
          explicit: [
            { key: "output_count", value: "4", sourceText: "4 张" },
            { key: "aspect_ratio", value: "16:9", sourceText: "16:9" },
          ],
        },
        ambiguities: [],
        workflow: {
          mode: "single",
          inputModalities: ["text"],
          outputArtifacts: ["image"],
          requiredAgents: ["image_agent"],
          requiredCapabilities: ["image-generation"],
          stages: [
            {
              action: "create",
              agent: "image_agent",
              goal: "生成图片",
              id: "generate",
              outputArtifacts: ["image"],
            },
          ],
        },
      })
    );
    const output = typeof raw === "string" ? JSON.parse(raw) : raw;

    expect(context.normalizedInput).toMatchObject({
      task: { domain: "image", intent: "image.generate" },
      constraints: {
        explicit: expect.arrayContaining([
          expect.objectContaining({ key: "output_count", value: "4" }),
          expect.objectContaining({ key: "aspect_ratio", value: "16:9" }),
        ]),
      },
    });
    expect(context.skillCandidates[0]).toMatchObject({
      id: "skill-image",
      name: "image-prompt",
    });
    expect(context.pendingEvents).toEqual([
      expect.objectContaining({
        normalizedInput: context.normalizedInput,
        type: "task_frame_set",
      }),
      expect.objectContaining({
        candidates: context.skillCandidates,
        type: "skill_retrieved",
      }),
    ]);
    expect(output).toMatchObject({
      candidateSkillCount: 1,
      intent: "image.generate",
      status: "task_frame_set",
    });
  });
});

function agentContext(): CucumberAgentContext {
  return {
    activatedSkills: [],
    canvasId: "project-1",
    canvasSnapshot: { edges: [], nodes: [] },
    knownNodeIds: [],
    pendingEvents: [],
    producedArtifacts: [],
    projectId: "project-1",
    prompt: "生成 4 张 16:9 黄瓜海报",
    runNodeId: "run-1",
    selectedNodeId: null,
    selectedNodeIds: [],
    skillCandidates: [],
    upstreamContext: [],
    userId: "user-1",
  };
}
