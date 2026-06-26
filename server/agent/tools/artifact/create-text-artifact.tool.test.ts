import { RunContext } from "@openai/agents";
import { describe, expect, it, vi } from "vitest";

import type { CucumberAgentContext } from "../../context.ts";
import { makeTaskFrame } from "../../test-task-frame.ts";

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
        "r2://agent-assets/projects/project-1/runs/run-1/artifacts/text-1.md",
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

  it("stores generated HTML as a webpage artifact", async () => {
    mocks.storeTextArtifactContent.mockResolvedValue({
      contentRef:
        "r2://agent-assets/projects/project-1/runs/run-1/artifacts/text-1.html",
      id: "text-1",
      metadata: {
        format: "html",
        language: "html",
        mimeType: "text/html",
        previewKind: "webpage",
        sourceRunNodeId: "run-1",
        sourceToolName: "create_text_artifact",
      },
      title: "Agent 工作原理动画",
      type: "webpage",
    });
    const context = agentContext({
      normalizedInput: makeTaskFrame({
        rawInput: "用 huashu skill 帮我做个 30 秒的 HTML 动画",
        domain: "text",
        intent: "webpage.create",
        action: "create",
        primaryAgent: "document_agent",
      }),
    });

    const raw = await createTextArtifactTool.invoke(
      new RunContext(context),
      JSON.stringify({
        content:
          "```html\n<!doctype html><html><head><title>Agent</title></head><body><main>Agent</main></body></html>\n```",
        format: "html",
        title: "Agent 工作原理动画",
      })
    );
    const output = typeof raw === "string" ? JSON.parse(raw) : raw;

    expect(mocks.storeTextArtifactContent).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "<!doctype html><html><head><title>Agent</title></head><body><main>Agent</main></body></html>",
        metadata: { language: "html" },
        projectId: "project-1",
        runNodeId: "run-1",
        sourceToolName: "create_text_artifact",
        title: "Agent 工作原理动画",
        type: "webpage",
        userId: "user-1",
      })
    );
    expect(output).toMatchObject({
      artifactId: "text-1",
      artifactType: "webpage",
      format: "html",
      title: "Agent 工作原理动画",
    });
  });

  it("repairs collapsed markdown block boundaries before storing", async () => {
    mocks.storeTextArtifactContent.mockClear();
    mocks.storeTextArtifactContent.mockResolvedValue({
      id: "text-1",
      metadata: {
        format: "markdown",
        mimeType: "text/markdown",
        previewKind: "markdown",
        sourceRunNodeId: "run-1",
        sourceToolName: "create_text_artifact",
      },
      title: "提示词合集",
      type: "doc",
    });
    const context = agentContext();

    await createTextArtifactTool.invoke(
      new RunContext(context),
      JSON.stringify({
        content: "# 标题 ## 小节 ``` prompt ``` --- ## 下一节",
        title: "提示词合集",
      })
    );

    expect(mocks.storeTextArtifactContent).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "# 标题\n\n## 小节\n\n```\nprompt\n\n```\n---\n\n## 下一节",
      })
    );
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
