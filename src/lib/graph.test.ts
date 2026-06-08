import { describe, expect, it } from "vitest";

import {
  buildRunRevisionPrompt,
  collectUpstreamContext,
  collectUpstreamContextWithTrace,
  createImageResultNodes,
  createMarkdownDocumentNodes,
  createRunDraft,
  extractImagesFromToolOutput,
  extractMarkdownDocumentsFromToolOutput,
  getRunReferenceNodeId,
  getRunRevisionAnchorNodeId,
  shouldCreateMarkdownFromAgentText,
  textFromMessageParts,
  toolPartFromMessagePart,
  toolPartsFromMessageParts,
} from "./graph";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  ArtifactRef,
} from "@/types/canvas";

describe("agent canvas graph", () => {
  it("creates a root run when no node is selected", () => {
    const draft = createRunDraft("生成一张黄瓜工作台图片", null, [], []);

    expect(draft.promptNode.data.kind).toBe("prompt");
    expect(draft.runNode.data.kind).toBe("run");
    expect(draft.edges).toHaveLength(1);
    expect(draft.edges[0]).toMatchObject({
      source: draft.promptNode.id,
      target: draft.runNode.id,
    });
    expect(draft.upstreamContext).toEqual([]);
  });

  it("only treats non-run nodes as run references", () => {
    const prompt = promptNode("prompt-1", "初始需求");
    const run = runNode("run-1", "初始需求");
    const image = imageNode("image-1", "https://cdn.example/1.png", "初始需求");

    expect(getRunReferenceNodeId(prompt)).toBe("prompt-1");
    expect(getRunReferenceNodeId(image)).toBe("image-1");
    expect(getRunReferenceNodeId(run)).toBeNull();
    expect(getRunReferenceNodeId()).toBeNull();
  });

  it("collects upstream prompt and image context in order", () => {
    const nodes: AgentCanvasNode[] = [
      promptNode("prompt-1", "初始需求"),
      runNode("run-1", "初始需求"),
      imageNode("image-1", "https://cdn.example/1.png", "初始需求"),
    ];
    const edges: AgentCanvasEdge[] = [
      edge("prompt-1", "run-1"),
      edge("run-1", "image-1"),
    ];

    expect(collectUpstreamContext("image-1", nodes, edges)).toEqual([
      {
        nodeId: "prompt-1",
        type: "prompt",
        prompt: "初始需求",
        summary: "初始需求",
        priority: 90,
      },
      {
        nodeId: "image-1",
        type: "image",
        prompt: "初始需求",
        imageUrl: "https://cdn.example/1.png",
        summary: "Generated image",
        priority: 100,
      },
    ]);
  });

  it("carries image artifact refs into upstream context", () => {
    const image = {
      ...imageNode("image-1", "https://cdn.example/1.png", "初始需求"),
      data: {
        kind: "imageResult" as const,
        prompt: "初始需求",
        runId: "run-1",
        image: {
          id: "image-1",
          url: "https://cdn.example/1.png",
        },
        artifact: {
          id: "artifact-1",
          type: "image" as const,
          uri: "https://cdn.example/1.png",
        },
      },
    };

    expect(collectUpstreamContext("image-1", [image], [])).toEqual([
      {
        nodeId: "image-1",
        type: "image",
        prompt: "初始需求",
        imageUrl: "https://cdn.example/1.png",
        summary: "Generated image",
        title: undefined,
        contentRef: undefined,
        priority: 100,
        artifact: {
          id: "artifact-1",
          type: "image",
          uri: "https://cdn.example/1.png",
        },
      },
    ]);
  });

  it("creates a follow-up branch from an intermediate result", () => {
    const nodes: AgentCanvasNode[] = [
      promptNode("prompt-1", "初始需求"),
      runNode("run-1", "初始需求"),
      imageNode("image-1", "https://cdn.example/1.png", "初始需求"),
      promptNode("prompt-sibling", "改成绿色"),
    ];
    const edges: AgentCanvasEdge[] = [
      edge("prompt-1", "run-1"),
      edge("run-1", "image-1"),
      edge("image-1", "prompt-sibling"),
    ];

    const draft = createRunDraft("再加一点光影", "image-1", nodes, edges);

    expect(draft.edges[0]).toMatchObject({
      source: "image-1",
      target: draft.promptNode.id,
    });
    expect(draft.promptNode.position).toEqual({ x: 262, y: 510 });
    expect(draft.runNode.data.kind === "run" && draft.runNode.data.toolPart).toMatchObject({
      type: "tool-analyze_reference_images",
    });
  });

  it("creates a branch from a selected prompt node", () => {
    const nodes: AgentCanvasNode[] = [
      promptNode("prompt-1", "初始需求"),
      runNode("run-1", "初始需求"),
    ];
    const edges: AgentCanvasEdge[] = [edge("prompt-1", "run-1")];

    const draft = createRunDraft("换一个方向", "prompt-1", nodes, edges);

    expect(draft.edges[0]).toMatchObject({
      source: "prompt-1",
      target: draft.promptNode.id,
    });
    expect(draft.edges[1]).toMatchObject({
      source: draft.promptNode.id,
      target: draft.runNode.id,
    });
    expect(draft.upstreamContext).toEqual([
      {
        nodeId: "prompt-1",
        type: "prompt",
        prompt: "初始需求",
        summary: "初始需求",
        priority: 100,
      },
    ]);
  });

  it("prepares revision branches from a run result without overwriting artifacts", () => {
    const nodes: AgentCanvasNode[] = [
      promptNode("prompt-1", "初始需求"),
      runNode("run-1", "初始需求"),
      imageNode("image-1", "https://cdn.example/1.png", "初始需求"),
    ];
    const edges: AgentCanvasEdge[] = [
      edge("prompt-1", "run-1"),
      edge("run-1", "image-1"),
    ];

    const anchorNodeId = getRunRevisionAnchorNodeId("run-1", nodes, edges);
    const draft = createRunDraft("重新生成", anchorNodeId, nodes, edges);

    expect(anchorNodeId).toBe("image-1");
    expect(draft.edges[0]).toMatchObject({
      source: "image-1",
      target: draft.promptNode.id,
    });
    expect(nodes.map((node) => node.id)).toContain("image-1");
  });

  it("falls back to the run prompt when a revision has no result artifact", () => {
    const nodes: AgentCanvasNode[] = [
      promptNode("prompt-1", "初始需求"),
      runNode("run-1", "初始需求"),
    ];
    const edges: AgentCanvasEdge[] = [edge("prompt-1", "run-1")];

    expect(getRunRevisionAnchorNodeId("run-1", nodes, edges)).toBe("prompt-1");
  });

  it("builds a revision prompt from evaluator recommendations", () => {
    expect(
      buildRunRevisionPrompt({
        kind: "run",
        prompt: "生成黄瓜海报",
        status: "error",
        evaluation: {
          passed: false,
          issueCount: 1,
          recommendedActions: ["补足图片结果，并保留上游参考图"],
          needsRegeneration: true,
        },
      })
    ).toBe(
      [
        "根据质量检查建议重新生成。",
        "建议：补足图片结果，并保留上游参考图",
        "原始需求：生成黄瓜海报",
      ].join("\n")
    );
  });

  it("collects artifact-backed doc, code, webpage, decision, and memory context", () => {
    const nodes: AgentCanvasNode[] = [
      artifactNode("doc-1", "document", {
        id: "artifact-doc-1",
        type: "doc",
        title: "PRD",
        contentRef: "storage://docs/prd.md",
      }),
      artifactNode("code-1", "code", {
        id: "artifact-code-1",
        type: "code",
        title: "Patch",
        contentRef: "storage://code/patch.ts",
        metadata: { language: "ts" },
      }),
      artifactNode("web-1", "webpage", {
        id: "artifact-web-1",
        type: "webpage",
        title: "参考网页",
        uri: "https://example.com",
      }),
      artifactNode("memory-1", "memory", {
        id: "artifact-memory-1",
        type: "memory",
        title: "用户偏好",
      }),
      {
        ...runNode("run-1", "选择方向"),
        data: {
          kind: "run" as const,
          prompt: "选择方向",
          status: "success" as const,
          decision: "采用清爽绿色方向",
        },
      },
    ];
    const edges: AgentCanvasEdge[] = [
      edge("doc-1", "code-1"),
      edge("code-1", "web-1"),
      edge("web-1", "memory-1"),
      edge("memory-1", "run-1"),
    ];

    expect(collectUpstreamContext("run-1", nodes, edges).map((item) => item.type))
      .toEqual(["doc", "code", "webpage", "memory", "decision"]);
  });

  it("applies context budget without dropping the selected node", () => {
    const nodes: AgentCanvasNode[] = [
      promptNode("prompt-1", "很长的早期需求 ".repeat(20)),
      imageNode("image-1", "https://cdn.example/1.png", "选中的参考图"),
    ];
    const edges: AgentCanvasEdge[] = [edge("prompt-1", "image-1")];

    const collection = collectUpstreamContextWithTrace(
      "image-1",
      nodes,
      edges,
      { budget: 8 }
    );

    expect(collection.items.map((item) => item.nodeId)).toEqual(["image-1"]);
    expect(collection.omittedItems.map((item) => item.nodeId)).toEqual([
      "prompt-1",
    ]);
    expect(collection.trace).toMatchObject({
      omittedContextReason: "context_budget_exceeded",
      omittedNodeIds: ["prompt-1"],
    });
  });

  it("creates a root run when a run node is selected", () => {
    const nodes: AgentCanvasNode[] = [
      promptNode("prompt-1", "初始需求"),
      runNode("run-1", "初始需求"),
    ];
    const edges: AgentCanvasEdge[] = [edge("prompt-1", "run-1")];

    const draft = createRunDraft("新开一个输入", "run-1", nodes, edges);

    expect(draft.edges).toHaveLength(1);
    expect(draft.edges[0]).toMatchObject({
      source: draft.promptNode.id,
      target: draft.runNode.id,
    });
    expect(draft.upstreamContext).toEqual([]);
  });

  it("places the first follow-up under the selected result", () => {
    const nodes: AgentCanvasNode[] = [
      imageNode("image-1", "https://cdn.example/1.png", "初始需求"),
    ];

    const draft = createRunDraft("再加一点光影", "image-1", nodes, []);

    expect(draft.promptNode.position).toEqual({ x: 0, y: 510 });
  });

  it("offsets sibling follow-up branches from the same result", () => {
    const nodes: AgentCanvasNode[] = [
      imageNode("image-1", "https://cdn.example/1.png", "初始需求"),
      promptNode("prompt-sibling", "改成绿色"),
    ];
    const edges: AgentCanvasEdge[] = [edge("image-1", "prompt-sibling")];

    const draft = createRunDraft("再加一点光影", "image-1", nodes, edges);

    expect(draft.promptNode.position).toEqual({ x: 262, y: 510 });
  });

  it("maps successful tool output into image result nodes", () => {
    const run = runNode("run-1", "生成图片");
    const { resultNodes, resultEdges } = createImageResultNodes(
      run,
      [
        {
          id: "a",
          url: "https://cdn.example/a.png",
          title: "A",
          artifact: {
            id: "a",
            type: "image",
            uri: "https://cdn.example/a.png",
          },
        },
      ],
      [run]
    );

    expect(resultNodes[0].data.kind).toBe("imageResult");
    if (resultNodes[0].data.kind !== "imageResult") {
      throw new Error("Expected an image result node");
    }
    expect(resultNodes[0].data.image.url).toBe("https://cdn.example/a.png");
    expect(resultNodes[0].data.artifact?.id).toBe("a");
    expect(resultEdges[0]).toMatchObject({ source: "run-1", target: "image-a" });
  });

  it("maps markdown tool output into a document container node", () => {
    const run = runNode("run-1", "调研竞品并输出 Markdown");
    const documents = extractMarkdownDocumentsFromToolOutput({
      artifacts: [
        {
          id: "doc-1",
          type: "doc",
          title: "竞品分析",
          metadata: {
            format: "markdown",
            markdown: "# 竞品分析\n\n- A 产品更偏运营\n- B 产品更偏创作",
          },
        },
      ],
    });
    const { resultNodes, resultEdges } = createMarkdownDocumentNodes(
      run,
      documents,
      [run]
    );

    expect(resultNodes).toHaveLength(1);
    expect(resultNodes[0]).toMatchObject({
      id: "markdown-doc-1",
      type: "markdownNode",
      position: { x: -90, y: 480 },
      data: {
        kind: "markdown",
        title: "竞品分析",
        content: "# 竞品分析\n\n- A 产品更偏运营\n- B 产品更偏创作",
      },
    });
    expect(resultEdges[0]).toMatchObject({
      source: "run-1",
      target: "markdown-doc-1",
    });
  });

  it("does not duplicate an already rendered markdown document", () => {
    const run = runNode("run-1", "输出 Markdown");
    const documents = [
      {
        id: "doc-1",
        title: "分析文档",
        content: "# 分析文档\n\n- 结论",
      },
    ];
    const firstProjection = createMarkdownDocumentNodes(run, documents, [run]);
    const secondProjection = createMarkdownDocumentNodes(run, documents, [
      run,
      ...firstProjection.resultNodes,
    ]);

    expect(firstProjection.resultNodes).toHaveLength(1);
    expect(secondProjection.resultNodes).toEqual([]);
  });

  it("collects markdown document context from the canvas", () => {
    const markdown = markdownNode(
      "markdown-doc-1",
      "竞品分析",
      "# 竞品分析\n\n- A 产品更偏运营"
    );

    expect(collectUpstreamContext("markdown-doc-1", [markdown], [])).toEqual([
      {
        nodeId: "markdown-doc-1",
        type: "doc",
        prompt: undefined,
        summary: "竞品分析",
        artifact: {
          id: "doc-1",
          type: "doc",
          title: "竞品分析",
          metadata: { format: "markdown" },
        },
        title: "竞品分析",
        contentRef: undefined,
        imageUrl: undefined,
        priority: 100,
      },
    ]);
  });

  it("uses the compact Figma result offset while the run is still collapsed", () => {
    const run = {
      ...runNode("run-1", "生成图片"),
      data: {
        kind: "run" as const,
        prompt: "生成图片",
        status: "queued" as const,
        toolPart: {
          type: "tool-generate_image" as const,
          state: "input-streaming" as const,
          input: { prompt: "生成图片" },
        },
      },
    };
    const { resultNodes } = createImageResultNodes(
      run,
      [{ id: "a", url: "https://cdn.example/a.png" }],
      [run]
    );

    expect(resultNodes[0].position).toEqual({ x: 0, y: 200 });
  });

  it("centers multi-result images under the run node using Figma spacing", () => {
    const run = runNode("run-1", "生成图片");
    const { resultNodes } = createImageResultNodes(
      run,
      [
        { id: "a", url: "https://cdn.example/a.png" },
        { id: "b", url: "https://cdn.example/b.png" },
        { id: "c", url: "https://cdn.example/c.png" },
      ],
      [run]
    );

    expect(resultNodes.map((node) => node.position)).toEqual([
      { x: -257, y: 480 },
      { x: 0, y: 480 },
      { x: 257, y: 480 },
    ]);
  });

  it("centers four image results under the run node", () => {
    const run = runNode("run-1", "生成四张图片");
    const { resultNodes } = createImageResultNodes(
      run,
      [
        { id: "a", url: "https://cdn.example/a.png" },
        { id: "b", url: "https://cdn.example/b.png" },
        { id: "c", url: "https://cdn.example/c.png" },
        { id: "d", url: "https://cdn.example/d.png" },
      ],
      [run]
    );

    expect(resultNodes.map((node) => node.position)).toEqual([
      { x: -385.5, y: 480 },
      { x: -128.5, y: 480 },
      { x: 128.5, y: 480 },
      { x: 385.5, y: 480 },
    ]);
  });

  it("shifts new image results away from existing nodes on the same row", () => {
    const run = {
      ...runNode("run-2", "再生成四张图片"),
      position: { x: 520, y: 124 },
    };
    const existingImages = [
      imageNode("existing-a", "https://cdn.example/existing-a.png", "初始需求"),
      {
        ...imageNode("existing-b", "https://cdn.example/existing-b.png", "初始需求"),
        position: { x: 257, y: 317 },
      },
    ];
    const { resultNodes } = createImageResultNodes(
      run,
      [
        { id: "a", url: "https://cdn.example/a.png" },
        { id: "b", url: "https://cdn.example/b.png" },
        { id: "c", url: "https://cdn.example/c.png" },
        { id: "d", url: "https://cdn.example/d.png" },
      ],
      [run, ...existingImages]
    );

    expect(resultNodes.map((node) => node.position)).toEqual([
      { x: 521, y: 480 },
      { x: 778, y: 480 },
      { x: 1035, y: 480 },
      { x: 1292, y: 480 },
    ]);
  });

  it("shifts new follow-up chains away from existing nodes", () => {
    const nodes: AgentCanvasNode[] = [
      imageNode("image-1", "https://cdn.example/1.png", "初始需求"),
      {
        ...promptNode("blocking-prompt", "挡住默认位置的节点"),
        position: { x: 0, y: 510 },
      },
    ];

    const draft = createRunDraft("再加一点光影", "image-1", nodes, []);

    expect(draft.promptNode.position).toEqual({ x: 264, y: 510 });
    expect(draft.runNode.position).toEqual({ x: 264, y: 634 });
  });

  it("extracts AI SDK tool parts and image outputs", () => {
    const part = toolPartFromMessagePart({
      type: "tool-generate_image",
      state: "output-available",
      input: { prompt: "hello" },
      output: { images: [{ id: "x", url: "https://cdn.example/x.png" }] },
    });

    expect(part?.state).toBe("output-available");
    expect(extractImagesFromToolOutput(part?.output)).toEqual([
      { id: "x", url: "https://cdn.example/x.png" },
    ]);
  });

  it("extracts streamed assistant text parts", () => {
    expect(
      textFromMessageParts([
        { type: "text", text: "我会先理解画面方向。" },
        { type: "tool-generate_image", state: "input-available" },
        { type: "text", text: "然后调用图像工具。" },
      ])
    ).toBe("我会先理解画面方向。\n\n然后调用图像工具。");
  });

  it("only promotes document-like agent text into markdown containers", () => {
    expect(
      shouldCreateMarkdownFromAgentText(
        "帮我调研这个方向，输出 MD",
        "# 调研结论\n\n- 现有方案偏重图片生成，文档型输出仍然停留在 Run 节点文本里。\n- 需要补充独立 Markdown 容器，让分析、总结、方案和报告能作为画布节点继续分支。\n- 后续 research tool 可以直接返回 markdown artifact。"
      )
    ).toBe(true);
    expect(
      shouldCreateMarkdownFromAgentText(
        "生成一张图片",
        "我会先理解画面方向，然后调用图像工具。"
      )
    ).toBe(false);
  });

  it("extracts AI SDK dynamic tool parts for generate_image", () => {
    const part = toolPartFromMessagePart({
      type: "dynamic-tool",
      toolName: "generate_image",
      state: "input-available",
      input: { prompt: "hello", upstreamContext: [] },
    });

    expect(part).toEqual({
      type: "tool-generate_image",
      state: "input-available",
      input: { prompt: "hello", upstreamContext: [] },
      output: undefined,
      errorText: undefined,
    });
  });

  it("keeps tool approval metadata from AI SDK tool parts", () => {
    const part = toolPartFromMessagePart({
      type: "tool-generate_image",
      toolCallId: "generate-image-call",
      state: "approval-requested",
      input: { prompt: "生成图片" },
      approval: { id: "approval-run-1-generate_image" },
    });

    expect(part).toMatchObject({
      type: "tool-generate_image",
      toolCallId: "generate-image-call",
      state: "approval-requested",
      approval: { id: "approval-run-1-generate_image" },
    });
  });

  it("extracts expand_prompt and generate_image as separate tool parts", () => {
    const parts = toolPartsFromMessageParts([
      {
        type: "tool-analyze_reference_images",
        state: "output-available",
        output: { analysis: "参考图是绿色海报", imageCount: 1 },
      },
      {
        type: "tool-expand_prompt",
        state: "output-available",
        output: { expandedPrompt: "高质量黄瓜工作台图片" },
      },
      {
        type: "tool-generate_image",
        state: "output-available",
        output: { images: [{ id: "x", url: "https://cdn.example/x.png" }] },
      },
    ]);

    expect(parts.map((part) => part.type)).toEqual([
      "tool-analyze_reference_images",
      "tool-expand_prompt",
      "tool-generate_image",
    ]);
    expect(extractImagesFromToolOutput(parts[0].output)).toEqual([]);
    expect(extractImagesFromToolOutput(parts[1].output)).toEqual([]);
    expect(extractImagesFromToolOutput(parts[2].output)).toEqual([
      { id: "x", url: "https://cdn.example/x.png" },
    ]);
  });

  it("extracts image artifacts as compatible generated images", () => {
    expect(
      extractImagesFromToolOutput({
        artifacts: [
          {
            id: "artifact-a",
            type: "image",
            uri: "https://cdn.example/a.png",
            title: "Artifact image",
            metadata: { provider: "seedream" },
          },
        ],
      })
    ).toEqual([
      {
        id: "artifact-a",
        url: "https://cdn.example/a.png",
        title: "Artifact image",
        metadata: { provider: "seedream" },
        artifact: {
          id: "artifact-a",
          type: "image",
          uri: "https://cdn.example/a.png",
          title: "Artifact image",
          metadata: { provider: "seedream" },
        },
      },
    ]);
  });

  it("keeps tool errors as errors without extracting images", () => {
    const part = toolPartFromMessagePart({
      type: "tool-expand_prompt",
      state: "output-error",
      errorText: "Skill failed",
    });

    expect(part?.errorText).toBe("Skill failed");
    expect(extractImagesFromToolOutput(part?.output)).toEqual([]);
  });
});

function promptNode(id: string, prompt: string): AgentCanvasNode {
  return {
    id,
    type: "promptNode",
    position: { x: 0, y: 0 },
    data: {
      kind: "prompt",
      prompt,
      contextLabel: "Root",
      createdAt: "2026-06-05T00:00:00.000Z",
    },
  };
}

function runNode(id: string, prompt: string): AgentCanvasNode {
  return {
    id,
    type: "runNode",
    position: { x: 0, y: 124 },
    data: {
      kind: "run",
      prompt,
      status: "success",
    },
  };
}

function imageNode(id: string, url: string, prompt: string): AgentCanvasNode {
  return {
    id,
    type: "imageResultNode",
    position: { x: 0, y: 200 },
    data: {
      kind: "imageResult",
      prompt,
      runId: "run-1",
      image: {
        id,
        url,
      },
    },
  };
}

function markdownNode(
  id: string,
  title: string,
  content: string
): AgentCanvasNode {
  return {
    id,
    type: "markdownNode",
    position: { x: 0, y: 480 },
    data: {
      kind: "markdown",
      artifact: {
        id: "doc-1",
        type: "doc",
        title,
        metadata: { format: "markdown" },
      },
      title,
      content,
      summary: title,
      runId: "run-1",
    },
  };
}

function artifactNode(
  id: string,
  kind: "artifact" | "document" | "code" | "webpage" | "memory",
  artifact: ArtifactRef
): AgentCanvasNode {
  type ArtifactTestKind = "artifact" | "document" | "code" | "webpage" | "memory";
  const typeByKind = {
    artifact: "artifactNode",
    code: "codeNode",
    document: "documentNode",
    memory: "memoryNode",
    webpage: "webpageNode",
  } satisfies Record<ArtifactTestKind, string>;

  const base = {
    id,
    type: typeByKind[kind],
    position: { x: 0, y: 0 },
  };

  if (kind === "memory") {
    return {
      ...base,
      data: {
        kind,
        artifact,
        title: artifact.title ?? "Memory",
        memory: artifact.title ?? "Memory",
      },
    };
  }

  return {
    ...base,
    data: {
      kind,
      artifact,
      title: artifact.title ?? "Artifact",
    },
  } as AgentCanvasNode;
}

function edge(source: string, target: string): AgentCanvasEdge {
  return {
    id: `${source}-${target}`,
    source,
    target,
  };
}
