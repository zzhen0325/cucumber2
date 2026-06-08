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

  it("reuses the real prompt node id when it is present in the trace", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      existingNodes: [
        {
          ...promptNode("prompt-real"),
          position: { x: 88, y: 99 },
        },
      ],
      events: [
        event("run.created", "run-1", "run", {
          prompt: "生成图片",
          promptNodeId: "prompt-real",
          selectedNodeId: null,
        }),
      ],
    });

    expect(projection.nodes[0]).toMatchObject({
      id: "prompt-real",
      position: { x: 88, y: 99 },
    });
  });

  it("projects early run failures without blanking existing prompt content", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      existingNodes: [promptNode("prompt-1"), runNode("run-1")],
      existingEdges: [
        {
          id: "edge-prompt-1-run-1",
          source: "prompt-1",
          target: "run-1",
          type: "animated",
        },
      ],
      events: [
        event("run.failed", "run-1", "run", {
          prompt: "生成图片",
          promptNodeId: "prompt-1",
          errorText: "Could not find the table 'public.agent_runs'",
        }),
      ],
    });

    const prompt = projection.nodes.find((node) => node.id === "prompt-1");
    const run = projection.nodes.find((node) => node.id === "run-1");
    expect(prompt?.data.kind).toBe("prompt");
    expect(run?.data.kind).toBe("run");
    if (prompt?.data.kind !== "prompt" || run?.data.kind !== "run") {
      throw new Error("Expected prompt and run nodes");
    }

    expect(prompt.data.prompt).toBe("生成图片");
    expect(run.data.prompt).toBe("生成图片");
    expect(run.data.status).toBe("error");
    expect(run.data.toolParts?.[0]).toMatchObject({
      state: "output-error",
      errorText: "Could not find the table 'public.agent_runs'",
    });
  });

  it("projects evaluator results into a user-level run node summary", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      events: [
        event("run.created", "run-1", "run", {
          prompt: "生成图片",
          selectedNodeId: null,
        }),
        event("evaluation.completed", "run-1", "evaluation", {
          evaluation: {
            passed: false,
            issues: [
              {
                code: "missing_artifact",
                message: "没有生成可见结果",
                severity: "error",
              },
              {
                code: "weak_match",
                message: "风格与需求不一致",
                severity: "warning",
              },
            ],
            recommendedActions: ["重新生成，并保留原始 prompt 上下文"],
            needsRegeneration: true,
          },
        }),
        event("run.failed", "run-1", "run", { status: "failed" }),
      ],
    });

    const run = projection.nodes.find((node) => node.id === "run-1");
    expect(run?.data.kind).toBe("run");
    if (run?.data.kind !== "run") {
      throw new Error("Expected run node");
    }

    expect(run.data.evaluation).toEqual({
      passed: false,
      issueCount: 2,
      recommendedActions: ["重新生成，并保留原始 prompt 上下文"],
      needsRegeneration: true,
    });
  });

  it("projects intent, context, plan, and artifact into run summary items", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      events: [
        event("run.created", "run-1", "run", {
          prompt: "生成图片",
          selectedNodeId: null,
        }),
        event("intent.routed", "run-1", "intent", {
          intent: {
            primaryIntent: "image_generation",
            task: { kind: "image_generation" },
          },
        }),
        event("context.built", "run-1", "context", {
          context: {
            selectedItems: [{ nodeId: "image-1" }, { nodeId: "prompt-1" }],
            omittedItems: [{ nodeId: "doc-1" }],
            trace: {
              selectedCount: 2,
              omittedCount: 1,
            },
          },
        }),
        event("plan.created", "run-1", "plan", {
          normalizedPlan: [
            { id: "expand", title: "Expand prompt" },
            { id: "generate", title: "Generate image" },
          ],
        }),
        event("artifact.created", "run-1", "generate", {
          artifact: {
            id: "image-1",
            type: "image",
            uri: "https://cdn.example/1.png",
          },
        }),
      ],
    });

    const run = projection.nodes.find((node) => node.id === "run-1");
    expect(run?.data.kind).toBe("run");
    if (run?.data.kind !== "run") {
      throw new Error("Expected run node");
    }

    expect(run.data.summaryItems).toEqual([
      { kind: "intent", label: "意图", detail: "image generation" },
      { kind: "context", label: "上下文", detail: "2 项，省略 1 项" },
      {
        kind: "plan",
        label: "计划",
        detail: "2 步：Expand prompt / Generate image",
      },
      { kind: "artifact", label: "产物", detail: "1 image" },
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
