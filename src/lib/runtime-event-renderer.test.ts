import { describe, expect, it } from "vitest";

import {
  agentTextFromMessages,
  projectRuntimeEventsToCanvas,
  runtimeEventsFromMessageParts,
  runtimeEventsFromMessages,
} from "./runtime-event-renderer";
import type { AgentEvent } from "@/types/runtime";

describe("agent event renderer", () => {
  it("accepts only the v2 runtime event data part", () => {
    const runCreated = event("run.created");
    expect(
      runtimeEventsFromMessageParts([
        { type: "data-runtime-event", data: runCreated },
        { type: "data-run-status", data: runCreated },
        { type: "tool-generate_image", state: "output-available" },
      ])
    ).toEqual([runCreated]);
  });

  it("filters message events by run and message window", () => {
    const first = event("run.created", "run-1");
    const second = event("run.completed", "run-2");
    const events = runtimeEventsFromMessages(
      [
        { parts: [{ type: "data-runtime-event", data: first }] },
        { parts: [{ type: "data-runtime-event", data: second }] },
      ],
      { runNodeId: "run-2", messageStartIndex: 1 }
    );

    expect(events).toEqual([second]);
  });

  it("extracts assistant text parts from the message window", () => {
    const text = agentTextFromMessages(
      [
        { role: "assistant", parts: [{ type: "text", text: "旧消息" }] },
        { role: "user", parts: [{ type: "text", text: "用户请求" }] },
        {
          role: "assistant",
          parts: [
            { type: "text", text: "第一段" },
            { type: "data-runtime-event", data: event("run.created") },
            { type: "tool-generate_image", state: "output-available" },
            { type: "text", text: "第二段" },
          ],
        },
      ],
      { messageStartIndex: 1 }
    );

    expect(text).toBe("第一段\n\n第二段");
  });

  it("does not extract user, runtime event, or tool parts as agent text", () => {
    expect(
      agentTextFromMessages([
        { role: "user", parts: [{ type: "text", text: "用户请求" }] },
        { role: "assistant", parts: [{ type: "data-runtime-event", data: event("run.created") }] },
        { role: "assistant", parts: [{ type: "tool-generate_image", state: "input-available" }] },
      ])
    ).toBe("");
  });

  it("projects streamed assistant text before final output arrives", () => {
    const projection = projectRuntimeEventsToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      streamedAgentTextByRunId: new Map([["run-1", "正在分析画布"]]),
      events: [
        event("run.created", "run-1", {
          prompt: "分析画布",
          promptNodeId: "prompt-1",
        }),
      ],
    });

    expect(projection.nodes.find((node) => node.id === "run-1")?.data).toMatchObject({
      kind: "run",
      status: "running",
      agentText: "正在分析画布",
    });
  });

  it("keeps final output above streamed assistant text", () => {
    const projection = projectRuntimeEventsToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      streamedAgentTextByRunId: new Map([["run-1", "实时文字"]]),
      events: [
        event("run.created", "run-1", {
          prompt: "生成图片",
          promptNodeId: "prompt-1",
        }),
        event("run.completed", "run-1", {
          finalOutput: "最终输出",
          artifactIds: [],
        }),
      ],
    });

    expect(projection.nodes.find((node) => node.id === "run-1")?.data).toMatchObject({
      kind: "run",
      status: "success",
      agentText: "最终输出",
    });
  });

  it("keeps persisted agent messages while displaying final output", () => {
    const projection = projectRuntimeEventsToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      events: [
        event("run.created", "run-1", {
          prompt: "生成图片",
          promptNodeId: "prompt-1",
        }),
        event("agent.message.completed", "run-1", {
          agentName: "Image Agent",
          content: "我会先整理提示词，然后调用图片工具。",
          messageId: "message-1",
          role: "assistant",
        }),
        event("run.completed", "run-1", {
          finalOutput: "图片已生成",
          artifactIds: [],
        }),
      ],
    });

    expect(projection.nodes.find((node) => node.id === "run-1")?.data).toMatchObject({
      kind: "run",
      status: "success",
      agentText: "图片已生成",
      agentMessages: [
        expect.objectContaining({
          agentName: "Image Agent",
          content: "我会先整理提示词，然后调用图片工具。",
        }),
      ],
    });
  });

  it("projects final output to the run node", () => {
    const projection = projectRuntimeEventsToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      events: [
        event("run.created", "run-1", {
          prompt: "生成图片",
          promptNodeId: "prompt-1",
        }),
        event("run.completed", "run-1", {
          finalOutput: "完成",
          artifactIds: [],
        }),
      ],
    });

    expect(projection.nodes.find((node) => node.id === "run-1")?.data).toMatchObject({
      kind: "run",
      status: "success",
      agentText: "完成",
    });
  });
});

function event(
  type: AgentEvent["type"],
  runNodeId = "run-1",
  payload: Record<string, unknown> = {}
): AgentEvent {
  return {
    projectId: "project-1",
    runNodeId,
    stepId: "run",
    type,
    payload,
    createdAt: "2026-06-11T00:00:00.000Z",
  };
}
