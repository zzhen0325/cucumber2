import { describe, expect, it } from "vitest";

import {
  collectUpstreamContext,
  collectUpstreamContextWithTrace,
  createRunDraft,
  getRunReferenceNodeId,
} from "./graph";
import type { AgentCanvasEdge, AgentCanvasNode } from "@/types/canvas";

describe("agent canvas graph", () => {
  it("creates a root prompt and run", () => {
    const draft = createRunDraft("生成一张黄瓜图片", null, [], []);

    expect(draft.promptNode.data.kind).toBe("prompt");
    expect(draft.runNode.data.kind).toBe("run");
    expect(draft.edges).toEqual([
      expect.objectContaining({
        source: draft.promptNode.id,
        target: draft.runNode.id,
      }),
    ]);
    expect(draft.upstreamContext).toEqual([]);
  });

  it("uses only non-run nodes as references", () => {
    expect(getRunReferenceNodeId(promptNode("prompt-1", "初始需求"))).toBe("prompt-1");
    expect(getRunReferenceNodeId(imageNode("image-1"))).toBe("image-1");
    expect(getRunReferenceNodeId(runNode("run-1"))).toBeNull();
  });

  it("rebuilds ordered upstream context from graph edges", () => {
    const nodes = [
      promptNode("prompt-1", "初始需求"),
      runNode("run-1"),
      imageNode("image-1"),
    ];
    const edges = [edge("prompt-1", "run-1"), edge("run-1", "image-1")];

    expect(collectUpstreamContext("image-1", nodes, edges)).toEqual([
      expect.objectContaining({ nodeId: "prompt-1", type: "prompt", priority: 90 }),
      expect.objectContaining({
        nodeId: "image-1",
        type: "image",
        imageUrl: "https://cdn.example/image-1.png",
        priority: 100,
      }),
    ]);
  });

  it("preserves image artifact references for the image service", () => {
    const image = imageNode("image-1");
    expect(collectUpstreamContext("image-1", [image], [])[0]).toMatchObject({
      nodeId: "image-1",
      type: "image",
      artifact: {
        id: "artifact-image-1",
        type: "image",
        uri: "https://cdn.example/image-1.png",
      },
    });
  });

  it("creates a follow-up branch from the selected result", () => {
    const nodes = [promptNode("prompt-1", "初始需求"), runNode("run-1"), imageNode("image-1")];
    const edges = [edge("prompt-1", "run-1"), edge("run-1", "image-1")];
    const draft = createRunDraft("增加光影", "image-1", nodes, edges);

    expect(draft.edges[0]).toMatchObject({
      source: "image-1",
      target: draft.promptNode.id,
    });
    expect(draft.upstreamContext.map((item) => item.nodeId)).toEqual([
      "prompt-1",
      "image-1",
    ]);
  });

  it("creates a follow-up branch from multiple selected references", () => {
    const nodes = [
      promptNode("prompt-1", "初始需求"),
      imageNode("image-1"),
      stickyNoteNode("note-1", "保留绿色背景"),
      runNode("run-1"),
    ];
    const edges = [edge("prompt-1", "image-1")];
    const draft = createRunDraft(
      "结合参考继续生成",
      ["image-1", "note-1", "run-1"],
      nodes,
      edges
    );

    expect(draft.edges).toEqual([
      expect.objectContaining({ source: "image-1", target: draft.promptNode.id }),
      expect.objectContaining({ source: "note-1", target: draft.promptNode.id }),
      expect.objectContaining({ source: draft.promptNode.id, target: draft.runNode.id }),
    ]);
    expect(draft.upstreamContext.map((item) => item.nodeId)).toEqual([
      "prompt-1",
      "image-1",
      "note-1",
    ]);
  });

  it("reports context omitted by a budget", () => {
    const nodes = [
      promptNode("prompt-1", "很长的初始需求".repeat(20)),
      imageNode("image-1"),
    ];
    const result = collectUpstreamContextWithTrace(
      "image-1",
      nodes,
      [edge("prompt-1", "image-1")],
      { budget: 1 }
    );

    expect(result.items.map((item) => item.nodeId)).toEqual(["image-1"]);
    expect(result.trace.omittedContextReason).toBe("context_budget_exceeded");
    expect(result.trace.omittedNodeIds).toEqual(["prompt-1"]);
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
      createdAt: "2026-06-11T00:00:00.000Z",
    },
  };
}

function runNode(id: string): AgentCanvasNode {
  return {
    id,
    type: "runNode",
    position: { x: 0, y: 124 },
    data: { kind: "run", prompt: "初始需求", status: "success" },
  };
}

function imageNode(id: string): AgentCanvasNode {
  const url = `https://cdn.example/${id}.png`;
  return {
    id,
    type: "imageResultNode",
    position: { x: 0, y: 260 },
    data: {
      kind: "imageResult",
      prompt: "初始需求",
      runId: "run-1",
      status: "ready",
      image: { id, url },
      artifact: { id: `artifact-${id}`, type: "image", uri: url },
    },
  };
}

function stickyNoteNode(id: string, text: string): AgentCanvasNode {
  return {
    id,
    type: "stickyNoteNode",
    position: { x: 260, y: 0 },
    data: {
      kind: "stickyNote",
      text,
      color: "green",
      createdAt: "2026-06-11T00:00:00.000Z",
    },
  };
}

function edge(source: string, target: string): AgentCanvasEdge {
  return { id: `edge-${source}-${target}`, source, target };
}
