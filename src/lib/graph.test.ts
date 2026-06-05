import { describe, expect, it } from "vitest";

import {
  collectUpstreamContext,
  createImageResultNodes,
  createRunDraft,
  extractImagesFromToolOutput,
  toolPartFromMessagePart,
} from "./graph";
import type { AgentCanvasEdge, AgentCanvasNode } from "@/types/canvas";

describe("agent canvas graph", () => {
  it("creates a root run when no node is selected", () => {
    const draft = createRunDraft("生成一张黄瓜工作台图片", null, [], []);

    expect(draft.promptNode.data.kind).toBe("prompt");
    expect(draft.runNode.data.kind).toBe("run");
    expect(draft.edges).toHaveLength(1);
    expect(draft.upstreamContext).toEqual([]);
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
      },
      {
        nodeId: "image-1",
        type: "image",
        prompt: "初始需求",
        imageUrl: "https://cdn.example/1.png",
        summary: "Generated image",
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
      [{ id: "a", url: "https://cdn.example/a.png", title: "A" }],
      [run]
    );

    expect(resultNodes[0].data.kind).toBe("imageResult");
    if (resultNodes[0].data.kind !== "imageResult") {
      throw new Error("Expected an image result node");
    }
    expect(resultNodes[0].data.image.url).toBe("https://cdn.example/a.png");
    expect(resultEdges[0]).toMatchObject({ source: "run-1", target: "image-a" });
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
      { x: -257, y: 317 },
      { x: 0, y: 317 },
      { x: 257, y: 317 },
    ]);
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

  it("keeps tool errors as errors without extracting images", () => {
    const part = toolPartFromMessagePart({
      type: "tool-generate_image",
      state: "output-error",
      errorText: "Image API failed",
    });

    expect(part?.errorText).toBe("Image API failed");
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

function edge(source: string, target: string): AgentCanvasEdge {
  return {
    id: `${source}-${target}`,
    source,
    target,
  };
}
