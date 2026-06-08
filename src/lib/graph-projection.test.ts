import { describe, expect, it } from "vitest";

import {
  applyGraphPatch,
  projectRunTraceToCanvas,
  projectToolOutputToCanvas,
  type RunStepTraceEvent,
} from "./graph-projection";
import type { AgentCanvasEdge, AgentCanvasNode } from "@/types/canvas";

describe("graph projection", () => {
  it("projects a run trace into prompt, run, and image result nodes", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      events: [
        event("run.created", "run-1", "run", {
          prompt: "生成一张黄瓜海报",
          selectedNodeId: null,
        }),
        event("step.started", "run-1", "expand_prompt", {
          label: "Expand prompt",
        }),
        event("tool.input", "run-1", "expand_prompt", {
          toolCallId: "tool-expand",
          toolName: "expand_prompt",
          input: { prompt: "生成一张黄瓜海报" },
        }),
        event("tool.output", "run-1", "expand_prompt", {
          toolCallId: "tool-expand",
          toolName: "expand_prompt",
          output: { expandedPrompt: "高质量黄瓜海报" },
        }),
        event("artifact.created", "run-1", "generate_image", {
          artifact: {
            id: "image-1",
            type: "image",
            uri: "https://cdn.example/1.png",
            title: "黄瓜海报",
          },
          canvasNodeId: "image-image-1",
        }),
        event("run.completed", "run-1", "run", { status: "success" }),
      ],
    });

    expect(projection.nodes.map((node) => [node.id, node.data.kind])).toEqual([
      ["prompt-run-1", "prompt"],
      ["run-1", "run"],
      ["image-image-1", "imageResult"],
    ]);
    expect(projection.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["prompt-run-1", "run-1"],
      ["run-1", "image-image-1"],
    ]);
    const run = projection.nodes.find((node) => node.id === "run-1");
    expect(run?.data.kind).toBe("run");
    if (run?.data.kind !== "run") {
      throw new Error("Expected run node");
    }
    expect(run.data.status).toBe("success");
    expect(run.data.stepTimeline?.[0]).toMatchObject({
      id: "expand_prompt",
      status: "success",
      toolName: "expand_prompt",
    });
  });

  it("keeps manually saved node positions during replay projection", () => {
    const existingImage = imageNode("image-image-1");
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      existingNodes: [
        {
          ...promptNode("prompt-run-1"),
          position: { x: 44, y: 55 },
        },
        {
          ...runNode("run-1"),
          position: { x: 44, y: 180 },
        },
        {
          ...existingImage,
          position: { x: 910, y: 920 },
        },
      ],
      events: [
        event("run.created", "run-1", "run", {
          prompt: "生成图片",
          selectedNodeId: null,
        }),
        event("artifact.created", "run-1", "generate_image", {
          artifact: {
            id: "image-1",
            type: "image",
            uri: "https://cdn.example/1.png",
          },
          canvasNodeId: "image-image-1",
        }),
      ],
    });

    expect(projection.nodes.map((node) => node.position)).toEqual([
      { x: 44, y: 55 },
      { x: 44, y: 180 },
      { x: 910, y: 920 },
    ]);
  });

  it("rejects duplicate nodes, dangling edges, illegal kinds, and project mismatch", () => {
    const state = {
      projectId: "project-1",
      nodes: [promptNode("prompt-1"), runNode("run-1")],
      edges: [] as AgentCanvasEdge[],
    };

    expect(
      applyGraphPatch(state, {
        id: "patch-duplicate",
        projectId: "project-1",
        type: "createNode",
        payload: { node: promptNode("prompt-1") },
      }).rejected?.reason
    ).toBe("duplicate_node");

    expect(
      applyGraphPatch(state, {
        id: "patch-dangling",
        projectId: "project-1",
        type: "createEdge",
        payload: {
          edge: {
            id: "edge-1",
            source: "prompt-1",
            target: "missing-node",
          },
        },
      }).rejected?.reason
    ).toBe("dangling_edge");

    expect(
      applyGraphPatch(state, {
        id: "patch-kind",
        projectId: "project-1",
        type: "createNode",
        payload: {
          node: {
            ...promptNode("prompt-2"),
            type: "runNode",
          },
        },
      }).rejected?.reason
    ).toBe("invalid_node_kind");

    expect(
      applyGraphPatch(state, {
        id: "patch-project",
        projectId: "project-2",
        type: "setNodeStatus",
        payload: { nodeId: "run-1", status: "success" },
      }).rejected?.reason
    ).toBe("patch_project_mismatch");
  });

  it("projects tool output through the artifact-aware image projection path", () => {
    const projection = projectToolOutputToCanvas(
      runNode("run-1"),
      {
        artifacts: [
          {
            id: "artifact-image",
            type: "image",
            uri: "https://cdn.example/artifact.png",
          },
        ],
      },
      [runNode("run-1")]
    );

    expect(projection.resultNodes[0].id).toBe("image-artifact-image");
    expect(projection.resultNodes[0].data.kind).toBe("imageResult");
  });
});

function event(
  type: RunStepTraceEvent["type"],
  runNodeId: string,
  stepId: string,
  payload: Record<string, unknown>
): RunStepTraceEvent {
  return {
    projectId: "project-1",
    runNodeId,
    stepId,
    type,
    payload,
    createdAt: `2026-06-08T00:00:0${eventCounter++}.000Z`,
  };
}

let eventCounter = 0;

function promptNode(id: string): AgentCanvasNode {
  return {
    id,
    type: "promptNode",
    position: { x: 0, y: 0 },
    data: {
      kind: "prompt",
      prompt: "生成图片",
      contextLabel: "Root",
      createdAt: "2026-06-08T00:00:00.000Z",
    },
  };
}

function runNode(id: string): AgentCanvasNode {
  return {
    id,
    type: "runNode",
    position: { x: 0, y: 124 },
    data: {
      kind: "run",
      prompt: "生成图片",
      status: "running",
    },
  };
}

function imageNode(id: string): AgentCanvasNode {
  return {
    id,
    type: "imageResultNode",
    position: { x: 0, y: 240 },
    data: {
      kind: "imageResult",
      image: {
        id: "image-1",
        url: "https://cdn.example/1.png",
      },
      prompt: "生成图片",
      runId: "run-1",
    },
  };
}
