import { RunContext } from "@openai/agents";
import { describe, expect, it, vi } from "vitest";

import type { CucumberAgentContext } from "../../context.ts";

const mocks = vi.hoisted(() => ({
  storeTextArtifactContent: vi.fn(),
}));

vi.mock("../../../storage.ts", () => ({
  storeTextArtifactContent: mocks.storeTextArtifactContent,
}));

const { createTextArtifactTool } = await import("./create-text-artifact.tool.ts");

describe("create_text_artifact tool", () => {
  it("stores a text artifact and emits an artifact event", async () => {
    mocks.storeTextArtifactContent.mockResolvedValue({
      contentRef:
        "supabase://agent-assets/projects/project-1/runs/run-1/artifacts/text-1.md",
      id: "text-1",
      metadata: {
        format: "markdown",
        mimeType: "text/markdown",
        previewKind: "markdown",
        sourceRunNodeId: "run-1",
        sourceToolName: "create_text_artifact",
      },
      title: "项目复盘",
      type: "doc",
    });
    const context = agentContext();

    const raw = await createTextArtifactTool.invoke(
      new RunContext(context),
      JSON.stringify({
        content: "# 项目复盘\n\n完成 P3 第一阶段。",
        title: "项目复盘",
      })
    );
    const output = typeof raw === "string" ? JSON.parse(raw) : raw;

    expect(mocks.storeTextArtifactContent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "# 项目复盘\n\n完成 P3 第一阶段。",
        projectId: "project-1",
        runNodeId: "run-1",
        sourceToolName: "create_text_artifact",
        title: "项目复盘",
        type: "doc",
        userId: "user-1",
      })
    );
    expect(output).toMatchObject({
      artifactId: "text-1",
      artifactType: "doc",
      title: "项目复盘",
    });
    expect(context.producedArtifacts).toHaveLength(1);
    expect(context.pendingEvents).toEqual([
      expect.objectContaining({
        artifact: expect.objectContaining({ id: "text-1" }),
        toolName: "create_text_artifact",
        type: "artifact_created",
      }),
    ]);
  });
});

function agentContext(
  overrides: Partial<CucumberAgentContext> = {}
): CucumberAgentContext {
  return {
    activatedSkills: [],
    canvasId: "project-1",
    canvasSnapshot: { edges: [], nodes: [] },
    knownNodeIds: [],
    pendingEvents: [],
    producedArtifacts: [],
    projectId: "project-1",
    prompt: "写一份项目复盘",
    runNodeId: "run-1",
    selectedNodeId: null,
    selectedNodeIds: [],
    skillCandidates: [],
    upstreamContext: [],
    userId: "user-1",
    ...overrides,
  };
}
