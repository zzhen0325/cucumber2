import { describe, expect, it } from "vitest";

import {
  getCanvasLayoutSignature,
  layoutAgentCanvasGraph,
} from "./canvas-layout";
import type { AgentCanvasEdge, AgentCanvasNode } from "@/types/canvas";

describe("canvas auto layout", () => {
  it("places connected nodes from top to bottom", () => {
    const nodes = [
      promptNode("prompt-1"),
      runNode("run-1"),
      imageNode("image-1"),
    ];
    const edges = [
      edge("prompt-1", "run-1"),
      edge("run-1", "image-1"),
    ];

    const layouted = layoutAgentCanvasGraph(nodes, edges);
    const prompt = layouted.find((node) => node.id === "prompt-1");
    const run = layouted.find((node) => node.id === "run-1");
    const image = layouted.find((node) => node.id === "image-1");

    expect(prompt?.position.y).toBeLessThan(run?.position.y ?? 0);
    expect(run?.position.y).toBeLessThan(image?.position.y ?? 0);
    expect(layouted[0].data).toBe(nodes[0].data);
  });

  it("uses measured dimensions for center to top-left conversion", () => {
    const layouted = layoutAgentCanvasGraph(
      [
        {
          ...promptNode("wide-prompt"),
          measured: { width: 360, height: 120 },
        },
      ],
      []
    );

    expect(layouted[0].position).toEqual({ x: 0, y: 0 });
  });

  it("ignores positions in the auto-layout signature", () => {
    const nodes = [promptNode("prompt-1")];
    const movedNodes = [{ ...nodes[0], position: { x: 900, y: 900 } }];
    const edges = [edge("prompt-1", "run-1")];

    expect(getCanvasLayoutSignature(nodes, edges)).toBe(
      getCanvasLayoutSignature(movedNodes, edges)
    );
  });
});

function promptNode(id: string): AgentCanvasNode {
  return {
    id,
    type: "promptNode",
    position: { x: 0, y: 0 },
    data: {
      kind: "prompt",
      prompt: "生成图片",
      contextLabel: "Root",
      createdAt: "2026-06-09T00:00:00.000Z",
    },
  };
}

function runNode(id: string): AgentCanvasNode {
  return {
    id,
    type: "runNode",
    position: { x: 0, y: 0 },
    data: {
      kind: "run",
      prompt: "生成图片",
      status: "success",
    },
  };
}

function imageNode(id: string): AgentCanvasNode {
  return {
    id,
    type: "imageResultNode",
    position: { x: 0, y: 0 },
    data: {
      kind: "imageResult",
      image: {
        id,
        url: "https://cdn.example/image.png",
      },
      prompt: "生成图片",
      runId: "run-1",
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
