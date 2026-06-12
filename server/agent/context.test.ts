import { describe, expect, it } from "vitest";

import { buildAgentRunInput, buildCucumberAgentContext } from "./context";
import type { AgentCanvasNode } from "../../src/types/canvas";

describe("agent context", () => {
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
      contentRef: "supabase://agent-assets/projects/project-1/runs/run-1/artifacts/artifact-1.png",
      type: "image",
      imageUrl: "/api/projects/project-1/artifacts/artifact-1/content",
    });
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
            "supabase://agent-assets/projects/project-1/runs/run-1/artifacts/artifact-1.png",
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
