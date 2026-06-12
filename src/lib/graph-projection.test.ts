import { describe, expect, it } from "vitest";

import { projectRunTraceToCanvas } from "./graph-projection";
import type { AgentEvent, AgentEventType } from "@/types/runtime";

describe("agent event graph projection", () => {
  it("projects final text and image artifacts into the run graph", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      events: [
        event("run.created", "run", {
          prompt: "生成图片",
          promptNodeId: "prompt-1",
          selectedNodeId: null,
          runtime: "openai-agents-sdk",
        }),
        event("artifact.created", "generate_image", {
          artifact: {
            id: "artifact-1",
            type: "image",
            uri: "https://cdn.example/image.png",
          },
        }),
        event("run.completed", "run", {
          finalOutput: "图片已生成",
          artifactIds: ["artifact-1"],
          status: "completed",
        }),
      ],
    });

    const run = projection.nodes.find((node) => node.id === "run-1");
    const image = projection.nodes.find((node) => node.data.kind === "imageResult");
    expect(run?.data).toMatchObject({
      kind: "run",
      status: "success",
      agentText: "图片已生成",
    });
    expect(image?.data).toMatchObject({
      kind: "imageResult",
      status: "ready",
      artifact: { id: "artifact-1" },
    });
  });

  it("projects agent, handoff, and tool lifecycle summaries", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成图片", promptNodeId: "prompt-1" }),
        event("agent.active", "agent", { agentName: "Cucumber Manager" }),
        event("handoff.completed", "handoff", { toAgent: "Cucumber Image Agent" }),
        event("tool.input", "generate_image", {
          toolCallId: "call-1",
          toolName: "generate_image",
          input: { resultCount: 1 },
        }),
        event("tool.output", "generate_image", {
          toolCallId: "call-1",
          toolName: "generate_image",
          output: { generated: 1 },
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      summaryItems: [
        { kind: "agent", detail: "Cucumber Manager" },
        { kind: "handoff", detail: "Cucumber Image Agent" },
      ],
      toolParts: [
        expect.objectContaining({
          type: "tool-generate_image",
          state: "output-available",
        }),
      ],
    });
  });

  it("keeps streamed text when tool input arrives", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      streamedAgentTextByRunId: new Map([["run-1", "我会先理解需求，再调用工具。"]]),
      events: [
        event("run.created", "run", { prompt: "生成图片", promptNodeId: "prompt-1" }),
        event("tool.input", "generate_image", {
          toolCallId: "call-1",
          toolName: "generate_image",
          input: { prompt: "green cucumber" },
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      status: "running",
      agentText: "我会先理解需求，再调用工具。",
    });
  });

  it("replays persisted traces without streamed text", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成图片", promptNodeId: "prompt-1" }),
        event("run.completed", "run", {
          finalOutput: "历史最终输出",
          artifactIds: [],
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      status: "success",
      agentText: "历史最终输出",
    });
  });

  it("uses streamed text without tool status placeholders while running", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      streamedAgentTextByRunId: new Map([["run-1", "实时模型文字"]]),
      events: [
        event("run.created", "run", { prompt: "分析", promptNodeId: "prompt-1" }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      status: "running",
      agentText: "实时模型文字",
    });
  });

  it("projects tool failures and run errors", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成图片", promptNodeId: "prompt-1" }),
        event("tool.error", "generate_image", {
          toolCallId: "call-1",
          toolName: "generate_image",
          errorText: "Seedream missing",
        }, "Seedream missing"),
        event("run.failed", "run", { errorText: "Seedream missing" }, "Seedream missing"),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      status: "error",
      error: "Seedream missing",
      toolParts: [expect.objectContaining({ state: "output-error" })],
    });
  });

  it("applies validated canvas operations", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "创建便签", promptNodeId: "prompt-1" }),
        event("canvas.operation.applied", "propose_canvas_operations", {
          operation: {
            id: "op-1",
            projectId: "project-1",
            type: "createNode",
            payload: {
              node: {
                id: "note-1",
                type: "stickyNoteNode",
                position: { x: 500, y: 300 },
                data: {
                  kind: "stickyNote",
                  text: "完成",
                  color: "yellow",
                  createdAt: "2026-06-11T00:00:00.000Z",
                },
              },
            },
          },
        }),
      ],
    });

    expect(projection.nodes.some((node) => node.id === "note-1")).toBe(true);
    expect(projection.rejectedPatches).toEqual([]);
  });
});

function event(
  type: AgentEventType,
  stepId: string,
  payload: Record<string, unknown>,
  errorText?: string
): AgentEvent {
  return {
    projectId: "project-1",
    runNodeId: "run-1",
    stepId,
    type,
    payload,
    errorText,
    createdAt: `2026-06-11T00:00:0${sequence++}.000Z`,
  };
}

let sequence = 0;
