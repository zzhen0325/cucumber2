import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AgentContextValidationError,
  buildAgentRunInput,
  buildCucumberAgentContext,
  hydrateAgentRunInputArtifacts,
} from "./context";
import type { AgentCanvasNode } from "../../src/types/canvas";
import { createProjectForUser } from "../canvas-store";
import { createTextArtifactContentForUser } from "../artifact-content-store";

describe("agent context", () => {
  const previousInMemoryDb = process.env.CUCUMBER_DEV_INMEMORY_DB;

  beforeAll(() => {
    process.env.CUCUMBER_DEV_INMEMORY_DB = "1";
  });

  afterAll(() => {
    if (previousInMemoryDb === undefined) {
      delete process.env.CUCUMBER_DEV_INMEMORY_DB;
      return;
    }
    process.env.CUCUMBER_DEV_INMEMORY_DB = previousInMemoryDb;
  });

  it("rebuilds upstream context from the persisted project snapshot", () => {
    const input = buildAgentRunInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-2",
      canvasContext: {
        prompt: "基于参考图继续生成",
        promptNodeId: "prompt-2",
        selectedNodeId: "image-1",
      },
      projectSnapshot: snapshot(),
    });

    expect(input.upstreamContext.map((item) => item.nodeId)).toEqual([
      "prompt-1",
      "image-1",
    ]);
    expect(input.upstreamContext[1]).toMatchObject({
      type: "image",
    });
    expect(input.upstreamContext[1].artifact).toMatchObject({
      id: "artifact-1",
      type: "image",
    });
    expect(input.upstreamContext[1].contentRef).toBeUndefined();
    expect(input.upstreamContext[1].imageUrl).toBeUndefined();
    expect(input.upstreamContext[1].artifact?.contentRef).toBeUndefined();
    expect(input.upstreamContext[1].artifact?.metadata ?? {}).not.toHaveProperty(
      "storagePath"
    );
    expect(JSON.stringify(input.upstreamContext)).not.toContain("signed");
  });

  it("rejects selected nodes outside the persisted project", () => {
    expect(() =>
      buildAgentRunInput({
        userId: "user-1",
        projectId: "project-1",
        runNodeId: "run-2",
        canvasContext: {
          prompt: "越权请求",
          promptNodeId: "prompt-2",
          selectedNodeId: "foreign-image",
        },
        projectSnapshot: snapshot(),
      })
    ).toThrow("Selected node foreign-image is not part of the persisted project snapshot.");
  });

  it("does not trust dangling edge endpoints as known nodes", () => {
    const projectSnapshot = snapshot();
    projectSnapshot.edges.push({
      id: "edge-dangling",
      source: "foreign-node",
      target: "run-2",
    });
    const input = buildAgentRunInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-2",
      canvasContext: {
        prompt: "生成图片",
        promptNodeId: "prompt-2",
        selectedNodeId: null,
      },
      projectSnapshot,
    });

    expect(buildCucumberAgentContext(input).knownNodeIds).not.toContain("foreign-node");
  });

  it("carries the requested image provider into the agent context", () => {
    const input = buildAgentRunInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-2",
      canvasContext: {
        imageProvider: "seed5_duotu_zz",
        prompt: "使用 Seedream 5 生成图片",
        promptNodeId: "prompt-2",
        selectedNodeId: null,
      },
      projectSnapshot: snapshot(),
    });

    expect(input.imageProvider).toBe("seed5_duotu_zz");
    expect(buildCucumberAgentContext(input).imageProvider).toBe("seed5_duotu_zz");
  });

  it("carries the requested agent provider into the agent context", () => {
    const input = buildAgentRunInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-2",
      canvasContext: {
        agentProvider: "super-relay",
        prompt: "使用 GLM 5.2 回答",
        promptNodeId: "prompt-2",
        selectedNodeId: null,
      },
      projectSnapshot: snapshot(),
    });

    expect(input.agentProvider).toBe("super-relay");
    expect(buildCucumberAgentContext(input).agentProvider).toBe("super-relay");
  });

  it("carries a forced skill selection into the agent context", () => {
    const input = buildAgentRunInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-2",
      canvasContext: {
        forcedSkillId: "00000000-0000-4000-8000-000000000001",
        forcedSkillName: "visual-prompt-cookbook",
        prompt: "生成图片",
        promptNodeId: "prompt-2",
        selectedNodeId: null,
      },
      projectSnapshot: snapshot(),
    });

    expect(buildCucumberAgentContext(input)).toMatchObject({
      forcedSkillId: "00000000-0000-4000-8000-000000000001",
      forcedSkillName: "visual-prompt-cookbook",
    });
  });

  it("carries explicit image composer controls for the Super Agent task frame", () => {
    const input = buildAgentRunInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-2",
      canvasContext: {
        imageAspectRatio: "9:16",
        imageResultCount: 3,
        inputMode: "image",
        prompt: "黄瓜",
        promptNodeId: "prompt-2",
        selectedNodeId: null,
      },
      projectSnapshot: snapshot(),
    });

    expect(input.normalizedInput).toBeUndefined();
    expect(buildCucumberAgentContext(input)).toMatchObject({
      imageAspectRatio: "9:16",
      imageResultCount: 3,
      inputMode: "image",
    });
  });

  it("carries agent-run canvas patch persistence metadata", () => {
    const input = buildAgentRunInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-2",
      canvasPatchApplied: true,
      canvasContext: {
        prompt: "基于刚保存的草稿继续",
        promptNodeId: "prompt-2",
        selectedNodeId: null,
      },
      projectSnapshot: {
        ...snapshot(),
        version: 7,
      },
    });

    expect(input.canvasPatchApplied).toBe(true);
    expect(input.projectVersion).toBe(7);
  });

  it("rebuilds upstream context from multiple selected project nodes", () => {
    const input = buildAgentRunInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-2",
      canvasContext: {
        prompt: "结合多个节点继续生成",
        promptNodeId: "prompt-2",
        selectedNodeId: "image-1",
        selectedNodeIds: ["image-1", "note-1", "run-1"],
      },
      projectSnapshot: snapshot(),
    });

    expect(input.selectedNodeId).toBe("image-1");
    expect(input.selectedNodeIds).toEqual(["image-1", "note-1", "prompt-1"]);
    expect(input.upstreamContext.map((item) => item.nodeId)).toEqual([
      "prompt-1",
      "image-1",
      "note-1",
    ]);
    expect(input.upstreamContext.at(-1)).toMatchObject({
      nodeId: "note-1",
      type: "doc",
      summary: "保留绿色背景",
    });
    expect(input.contextSummary).toMatchObject({
      selectedNodes: [
        { id: "image-1", kind: "imageResult" },
        { id: "note-1", kind: "stickyNote" },
        { id: "run-1", kind: "run" },
      ],
      referenceNodes: [
        { id: "image-1", kind: "imageResult" },
        { id: "note-1", kind: "stickyNote" },
      ],
      upstreamPath: [
        { nodeId: "prompt-1", type: "prompt" },
        { nodeId: "image-1", type: "image" },
        { nodeId: "note-1", type: "doc" },
      ],
      omittedNodes: [
        { id: "run-1", kind: "run", reason: "not_referenceable" },
      ],
    });
  });

  it("allows a simple run reply as trusted follow-up context", () => {
    const projectSnapshot = snapshot();
    projectSnapshot.nodes.push({
      id: "run-simple",
      type: "runNode",
      position: { x: 260, y: 124 },
      data: {
        agentText: "黄瓜是一种常见的葫芦科蔬菜。",
        kind: "run",
        outputKind: "simple",
        prompt: "黄瓜是什么？",
        status: "success",
      },
    });

    const input = buildAgentRunInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-2",
      canvasContext: {
        prompt: "继续解释营养价值",
        promptNodeId: "prompt-2",
        selectedNodeId: "run-simple",
      },
      projectSnapshot,
    });

    expect(input.selectedNodeId).toBe("run-simple");
    expect(input.upstreamContext).toEqual([
      expect.objectContaining({
        nodeId: "run-simple",
        prompt: "黄瓜是什么？",
        summary: "黄瓜是一种常见的葫芦科蔬菜。",
        type: "doc",
      }),
    ]);
    expect(input.contextSummary).toMatchObject({
      referenceNodes: [{ id: "run-simple", kind: "run" }],
      omittedNodes: [],
    });
  });

  it("hydrates artifact-backed text context from stored artifact content", async () => {
    const userId = "user-artifact-context";
    const project = await createProjectForUser(userId, "Artifact context");
    const artifact = await createTextArtifactContentForUser({
      contentFormat: "markdown-json",
      contentJson: {
        blockNoteBlocks: [{ type: "paragraph", content: "Stored body" }],
      },
      contentText: "# Stored body\n\nThis is the full trusted markdown body.",
      mimeType: "text/markdown",
      plainText: "# Stored body\n\nThis is the full trusted markdown body.",
      previewKind: "markdown",
      previewText: "Stored body preview",
      projectId: project.id,
      summary: "Stored body preview",
      title: "Stored markdown",
      type: "doc",
      userId,
    });
    if (!artifact) {
      throw new Error("Expected artifact");
    }
    const input = buildAgentRunInput({
      userId,
      projectId: project.id,
      runNodeId: "run-2",
      canvasContext: {
        prompt: "基于文档继续写",
        promptNodeId: "prompt-2",
        selectedNodeId: "markdown-1",
      },
      projectSnapshot: {
        ...snapshot(),
        id: project.id,
        nodes: [
          ...snapshot().nodes,
          {
            id: "markdown-1",
            position: { x: 0, y: 520 },
            type: "markdownNode",
            data: {
              artifact,
              content: "Stored body preview...内容已截断",
              kind: "markdown",
              summary: "Stored body preview",
              title: "Stored markdown",
            },
          },
        ],
      },
    });

    const hydrated = await hydrateAgentRunInputArtifacts(input);
    expect(hydrated.upstreamContext.at(-1)).toMatchObject({
      content: "# Stored body\n\nThis is the full trusted markdown body.",
      contentFormat: "markdown-json",
      mimeType: "text/markdown",
      nodeId: "markdown-1",
      type: "doc",
    });
    expect(hydrated.contextSummary?.upstreamPath.at(-1)).toMatchObject({
      nodeId: "markdown-1",
      summary: "# Stored body\n\nThis is the full trusted markdown body.",
    });
  });

  it("applies the default context budget and reports omitted nodes", () => {
    const projectSnapshot = snapshot();
    if (projectSnapshot.nodes[0].data.kind !== "prompt") {
      throw new Error("Expected prompt node");
    }
    projectSnapshot.nodes[0] = {
      ...projectSnapshot.nodes[0],
      data: {
        ...projectSnapshot.nodes[0].data,
        prompt: "很长的上游需求".repeat(6000),
      },
    };

    const input = buildAgentRunInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-2",
      canvasContext: {
        prompt: "基于参考图继续生成",
        promptNodeId: "prompt-2",
        selectedNodeId: "image-1",
      },
      projectSnapshot,
    });

    expect(input.upstreamContext.map((item) => item.nodeId)).toEqual(["image-1"]);
    expect(input.contextSummary?.omittedNodes).toEqual([
      expect.objectContaining({
        id: "prompt-1",
        reason: "context_budget_exceeded",
      }),
    ]);
  });

  it("throws a typed context validation error for untrusted selected nodes", () => {
    expect(() =>
      buildAgentRunInput({
        userId: "user-1",
        projectId: "project-1",
        runNodeId: "run-2",
        canvasContext: {
          prompt: "越权请求",
          promptNodeId: "prompt-2",
          selectedNodeId: "foreign-image",
        },
        projectSnapshot: snapshot(),
      })
    ).toThrow(AgentContextValidationError);
  });
});

function snapshot() {
  const nodes: AgentCanvasNode[] = [
    {
      id: "prompt-1",
      type: "promptNode",
      position: { x: 0, y: 0 },
      data: {
        kind: "prompt",
        prompt: "初始需求",
        contextLabel: "Root",
        createdAt: "2026-06-11T00:00:00.000Z",
      },
    },
    {
      id: "run-1",
      type: "runNode",
      position: { x: 0, y: 124 },
      data: { kind: "run", prompt: "初始需求", status: "success" },
    },
    {
      id: "image-1",
      type: "imageResultNode",
      position: { x: 0, y: 200 },
      data: {
        kind: "imageResult",
        prompt: "初始需求",
        runId: "run-1",
        status: "ready",
        image: { id: "image-1", url: "https://trusted.example/image.png" },
        artifact: {
          contentRef:
            "r2://agent-assets/projects/project-1/runs/run-1/artifacts/artifact-1.png",
          id: "artifact-1",
          metadata: {
            storageBucket: "agent-assets",
            storagePath: "projects/project-1/runs/run-1/artifacts/artifact-1.png",
          },
          type: "image",
          uri: "/api/projects/project-1/artifacts/artifact-1/content",
        },
      },
    },
    {
      id: "note-1",
      type: "stickyNoteNode",
      position: { x: 260, y: 0 },
      data: {
        kind: "stickyNote",
        text: "保留绿色背景",
        color: "green",
        createdAt: "2026-06-11T00:00:00.000Z",
      },
    },
    {
      id: "prompt-2",
      type: "promptNode",
      position: { x: 300, y: 300 },
      data: {
        kind: "prompt",
        prompt: "基于参考图继续生成",
        contextLabel: "2 upstream items",
        createdAt: "2026-06-11T00:00:01.000Z",
      },
    },
    {
      id: "run-2",
      type: "runNode",
      position: { x: 300, y: 424 },
      data: { kind: "run", prompt: "基于参考图继续生成", status: "queued" },
    },
  ];

  return {
    id: "project-1",
    nodes,
    edges: [
      { id: "edge-1", source: "prompt-1", target: "image-1" },
      { id: "edge-2", source: "image-1", target: "prompt-2" },
      { id: "edge-3", source: "prompt-2", target: "run-2" },
    ],
  };
}
