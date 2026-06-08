import { describe, expect, it } from "vitest";

import type { AgentCanvasNode } from "../../src/types/canvas";
import { AgentRuntimeError } from "./errors";
import { normalizeAgentInput } from "./input-normalizer";

describe("runtime input normalizer", () => {
  it("normalizes composer attachment metadata without inlining file content", () => {
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      attachments: [
        {
          id: "attachment-1",
          kind: "doc",
          name: "brief.md",
          mimeType: "text/markdown",
          sizeBytes: 128,
          contentRef: "composer-attachment://brief.md",
          preview: "text/markdown attachment captured as metadata",
        },
        {
          id: "attachment-2",
          kind: "webpage",
          name: "Reference",
          uri: "https://example.com/reference",
        },
      ],
      canvasContext: {
        prompt: "总结这份文档",
        selectedNodeId: null,
        upstreamContext: [],
      },
    });

    expect(input.attachments).toEqual([
      {
        id: "attachment-1",
        kind: "doc",
        name: "brief.md",
        mimeType: "text/markdown",
        sizeBytes: 128,
        contentRef: "composer-attachment://brief.md",
        preview: "text/markdown attachment captured as metadata",
      },
      {
        id: "attachment-2",
        kind: "webpage",
        name: "Reference",
        uri: "https://example.com/reference",
      },
    ]);
  });

  it("extracts tool approval responses from UI messages", () => {
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [
        {
          id: "message-approval",
          role: "assistant",
          parts: [
            {
              type: "tool-generate_image",
              state: "output-denied",
              toolCallId: "approval-run-1-review",
              input: {},
              output: undefined,
              errorText: "用户拒绝执行",
              approval: {
                id: "approval-run-1-review",
                approved: false,
                reason: "用户拒绝执行",
              },
            },
          ],
        } as never,
      ],
      canvasContext: {
        prompt: "需要确认后执行",
        selectedNodeId: null,
        upstreamContext: [],
      },
    });

    expect(input.approvalResponses).toEqual([
      {
        id: "approval-run-1-review",
        approved: false,
        reason: "用户拒绝执行",
      },
    ]);
  });

  it("accepts selected and upstream nodes that belong to the project snapshot", () => {
    const imageNode = createImageNode();
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      projectSnapshot: {
        id: "project-1",
        title: "Campaign board",
        nodes: [imageNode],
      },
      canvasContext: {
        prompt: "基于这张图继续生成",
        selectedNodeId: imageNode.id,
        upstreamContext: [
          {
            nodeId: imageNode.id,
            type: "image",
            imageUrl: "https://cdn.example/image.png",
            artifact: {
              id: "artifact-image-1",
              type: "image",
              uri: "https://cdn.example/image.png",
            },
          },
        ],
      },
    });

    expect(input.canvasContext.selectedNodeId).toBe("image-1");
    expect(input.projectRefs).toEqual([
      {
        id: "project-1",
        kind: "project",
        title: "Campaign board",
        summary: "1 canvas nodes",
      },
    ]);
    expect(input.canvasContext.upstreamContext[0].artifact?.id).toBe(
      "artifact-image-1"
    );
  });

  it("accepts artifact-backed document and code follow-up context", () => {
    const docNode = createArtifactNode("doc-1", "document", "artifact-doc-1");
    const codeNode = createArtifactNode("code-1", "code", "artifact-code-1");
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      projectSnapshot: {
        id: "project-1",
        nodes: [docNode, codeNode],
      },
      canvasContext: {
        prompt: "基于文档和代码继续分析",
        selectedNodeId: docNode.id,
        upstreamContext: [
          {
            nodeId: docNode.id,
            type: "doc",
            artifact: docNode.data.kind === "document" ? docNode.data.artifact : undefined,
          },
          {
            nodeId: codeNode.id,
            type: "code",
            artifact: codeNode.data.kind === "code" ? codeNode.data.artifact : undefined,
          },
        ],
      },
    });

    expect(input.canvasContext.upstreamContext.map((item) => item.type)).toEqual([
      "doc",
      "code",
    ]);
  });

  it("rejects invalid attachments and mismatched project snapshots", () => {
    expect(() =>
      normalizeAgentInput({
        userId: "user-1",
        projectId: "project-1",
        runNodeId: "run-1",
        modelProvider: "deepseek",
        messages: [],
        attachments: [{ id: "bad", kind: "video" }],
        canvasContext: {
          prompt: "处理附件",
          selectedNodeId: null,
          upstreamContext: [],
        },
      })
    ).toThrow(AgentRuntimeError);

    expect(() =>
      normalizeAgentInput({
        userId: "user-1",
        projectId: "project-1",
        runNodeId: "run-1",
        modelProvider: "deepseek",
        messages: [],
        projectSnapshot: {
          id: "project-2",
          nodes: [],
        },
        canvasContext: {
          prompt: "处理错误项目",
          selectedNodeId: null,
          upstreamContext: [],
        },
      })
    ).toThrow(AgentRuntimeError);
  });

  it("rejects selected or upstream nodes outside the project snapshot", () => {
    expect(() =>
      normalizeAgentInput({
        userId: "user-1",
        projectId: "project-1",
        runNodeId: "run-1",
        modelProvider: "deepseek",
        messages: [],
        projectSnapshot: {
          id: "project-1",
          nodes: [createImageNode()],
        },
        canvasContext: {
          prompt: "基于不存在的节点继续生成",
          selectedNodeId: "foreign-node",
          upstreamContext: [],
        },
      })
    ).toThrow(AgentRuntimeError);

    expect(() =>
      normalizeAgentInput({
        userId: "user-1",
        projectId: "project-1",
        runNodeId: "run-1",
        modelProvider: "deepseek",
        messages: [],
        projectSnapshot: {
          id: "project-1",
          nodes: [createImageNode()],
        },
        canvasContext: {
          prompt: "基于伪造上下文继续生成",
          selectedNodeId: null,
          upstreamContext: [{ nodeId: "foreign-node", type: "image" }],
        },
      })
    ).toThrow(AgentRuntimeError);
  });

  it("rejects upstream artifact ids that are not attached to the project node", () => {
    expect(() =>
      normalizeAgentInput({
        userId: "user-1",
        projectId: "project-1",
        runNodeId: "run-1",
        modelProvider: "deepseek",
        messages: [],
        projectSnapshot: {
          id: "project-1",
          nodes: [createImageNode()],
        },
        canvasContext: {
          prompt: "基于伪造 artifact 继续生成",
          selectedNodeId: "image-1",
          upstreamContext: [
            {
              nodeId: "image-1",
              type: "image",
              artifact: {
                id: "foreign-artifact",
                type: "image",
                uri: "https://cdn.example/foreign.png",
              },
            },
          ],
        },
      })
    ).toThrow(AgentRuntimeError);
  });
});

function createImageNode(): AgentCanvasNode {
  return {
    id: "image-1",
    type: "imageResultNode",
    position: { x: 0, y: 0 },
    data: {
      kind: "imageResult",
      prompt: "生成图片",
      runId: "run-source",
      artifact: {
        id: "artifact-image-1",
        type: "image",
        uri: "https://cdn.example/image.png",
      },
      image: {
        id: "artifact-image-1",
        url: "https://cdn.example/image.png",
        artifact: {
          id: "artifact-image-1",
          type: "image",
          uri: "https://cdn.example/image.png",
        },
      },
    },
  };
}

function createArtifactNode(
  id: string,
  kind: "document" | "code",
  artifactId: string
): AgentCanvasNode {
  return {
    id,
    type: `${kind}Node`,
    position: { x: 0, y: 0 },
    data: {
      kind,
      artifact: {
        id: artifactId,
        type: kind === "document" ? "doc" : "code",
        contentRef: `local-upload://${artifactId}`,
      },
      title: artifactId,
      summary: "Uploaded file preview",
    },
  };
}
