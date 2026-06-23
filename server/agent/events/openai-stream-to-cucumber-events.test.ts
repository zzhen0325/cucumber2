import { describe, expect, it } from "vitest";

import type { CucumberAgentContext, CucumberRunEvent } from "../context";
import { openAIStreamToCucumberEvents } from "./openai-stream-to-cucumber-events";

describe("OpenAI Agents stream adapter", () => {
  it("emits text deltas from the Agents SDK normalized stream shape", async () => {
    const context = agentContext();
    const stream = fakeStream([
      {
        type: "raw_model_stream_event",
        data: { type: "output_text_delta", delta: "正在分析" },
      },
      {
        type: "raw_model_stream_event",
        data: { type: "output_text_delta", delta: "画布" },
      },
    ], "正在分析画布");

    const events = await collect(openAIStreamToCucumberEvents(stream, context));

    expect(events).toEqual(
      expect.arrayContaining([
        { type: "text_delta", text: "正在分析" },
        { type: "text_delta", text: "画布" },
        { type: "run_completed", finalOutput: "正在分析画布", artifactIds: [] },
      ])
    );
  });

  it("keeps compatibility with direct legacy OpenAI text deltas", async () => {
    const context = agentContext();
    const stream = fakeStream([
      {
        type: "raw_model_stream_event",
        data: { type: "response.output_text.delta", delta: "旧协议" },
      },
    ], "旧协议");

    const events = await collect(openAIStreamToCucumberEvents(stream, context));

    expect(events).toContainEqual({ type: "text_delta", text: "旧协议" });
  });

  it("does not duplicate OpenAI Responses text when normalized and raw events both arrive", async () => {
    const context = agentContext();
    const stream = fakeStream([
      {
        type: "raw_model_stream_event",
        data: { type: "output_text_delta", delta: "同一段" },
      },
      {
        type: "raw_model_stream_event",
        data: {
          type: "model",
          event: { type: "response.output_text.delta", delta: "同一段" },
        },
      },
    ], "同一段");

    const events = await collect(openAIStreamToCucumberEvents(stream, context));

    expect(events.filter((event) => event.type === "text_delta")).toEqual([
      { type: "text_delta", text: "同一段" },
    ]);
  });

  it("emits text deltas from nested OpenAI Responses raw events", async () => {
    const context = agentContext();
    const stream = fakeStream([
      {
        type: "raw_model_stream_event",
        data: {
          type: "model",
          event: { type: "response.output_text.delta", delta: "嵌套输出" },
        },
      },
    ], "嵌套输出");

    const events = await collect(openAIStreamToCucumberEvents(stream, context));

    expect(events).toContainEqual({ type: "text_delta", text: "嵌套输出" });
  });

  it("emits reasoning summary deltas as visible agent text", async () => {
    const context = agentContext();
    const stream = fakeStream([
      {
        type: "raw_model_stream_event",
        data: {
          type: "model",
          event: {
            type: "response.reasoning_summary_text.delta",
            delta: "正在整理任务",
          },
        },
      },
    ], "完成");

    const events = await collect(openAIStreamToCucumberEvents(stream, context));

    expect(events).toContainEqual({
      type: "text_delta",
      text: "正在整理任务",
      source: "reasoning_summary",
    });
  });

  it("emits refusal deltas as visible agent text", async () => {
    const context = agentContext();
    const stream = fakeStream([
      {
        type: "raw_model_stream_event",
        data: {
          type: "model",
          event: {
            type: "response.refusal.delta",
            delta: "这个请求我不能处理。",
          },
        },
      },
    ], "这个请求我不能处理。");

    const events = await collect(openAIStreamToCucumberEvents(stream, context));

    expect(events).toContainEqual({
      type: "text_delta",
      text: "这个请求我不能处理。",
      source: "refusal",
    });
  });

  it("emits Chat Completions raw content deltas if a provider skips normalization", async () => {
    const context = agentContext();
    const stream = fakeStream([
      {
        type: "raw_model_stream_event",
        data: {
          type: "model",
          event: { choices: [{ delta: { content: "聊天文本" } }] },
        },
      },
    ], "聊天文本");

    const events = await collect(openAIStreamToCucumberEvents(stream, context));

    expect(events).toContainEqual({ type: "text_delta", text: "聊天文本" });
  });

  it("projects agents, handoffs, tools, artifacts, final output, and artifact ids", async () => {
    const context = agentContext();
    const stream = fakeStream([
      { type: "agent_updated_stream_event", agent: { name: "Cucumber Manager" } },
      {
        type: "run_item_stream_event",
        name: "handoff_occurred",
        item: { sourceAgent: { name: "Cucumber Manager" }, targetAgent: { name: "Image Agent" } },
      },
      {
        type: "run_item_stream_event",
        name: "tool_called",
        item: { rawItem: { name: "generate_image", callId: "call-1", arguments: '{"resultCount":1}' } },
      },
      {
        type: "run_item_stream_event",
        name: "tool_output",
        item: { rawItem: { callId: "call-1" }, output: { generated: 1 } },
      },
    ], "完成");
    context.producedArtifacts.push({ id: "artifact-1", type: "image" });

    const events = await collect(openAIStreamToCucumberEvents(stream, context));

    expect(events).toEqual(
      expect.arrayContaining([
        { type: "agent_active", agentName: "Cucumber Manager" },
        expect.objectContaining({ type: "handoff_completed", toAgent: "Image Agent" }),
        expect.objectContaining({ type: "tool_started", toolCallId: "call-1" }),
        expect.objectContaining({
          type: "tool_completed",
          toolCallId: "call-1",
          toolName: "generate_image",
        }),
        { type: "run_completed", finalOutput: "完成", artifactIds: ["artifact-1"] },
      ])
    );
  });

  it("emits tool_failed before propagating a stream failure", async () => {
    const context = agentContext();
    const stream = failingStream();
    const events: CucumberRunEvent[] = [];

    await expect(async () => {
      for await (const event of openAIStreamToCucumberEvents(stream, context)) {
        events.push(event);
      }
    }).rejects.toThrow("Seedream failed");

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_failed",
        toolName: "generate_image",
        toolCallId: "call-1",
        message: "Seedream failed",
      })
    );
  });

  it("formats object stream failures before emitting tool_failed", async () => {
    const context = agentContext();
    const stream = failingObjectStream();
    const events: CucumberRunEvent[] = [];

    await expect(async () => {
      for await (const event of openAIStreamToCucumberEvents(stream, context)) {
        events.push(event);
      }
    }).rejects.toEqual(
      expect.objectContaining({
        code: "PGRST205",
      })
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_failed",
        toolName: "expand_image_prompt",
        toolCallId: "call-skill",
        message: expect.stringContaining("agent_skill_definitions"),
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("Code: PGRST205"),
      })
    );
  });
});

function fakeStream(events: unknown[], finalOutput: string) {
  return {
    finalOutput,
    completed: Promise.resolve(),
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  } as never;
}

function failingStream() {
  return {
    completed: Promise.resolve(),
    async *[Symbol.asyncIterator]() {
      yield {
        type: "run_item_stream_event",
        name: "tool_called",
        item: { rawItem: { name: "generate_image", callId: "call-1", arguments: "{}" } },
      };
      throw new Error("Seedream failed");
    },
  } as never;
}

function failingObjectStream() {
  return {
    completed: Promise.resolve(),
    async *[Symbol.asyncIterator]() {
      yield {
        type: "run_item_stream_event",
        name: "tool_called",
        item: {
          rawItem: {
            name: "expand_image_prompt",
            callId: "call-skill",
            arguments: '{"prompt":"小狗"}',
          },
        },
      };
      throw {
        code: "PGRST205",
        details: null,
        hint: "Perhaps you meant the table 'public.agent_run_events'",
        message:
          "Could not find the table 'public.agent_skill_definitions' in the schema cache",
      };
    },
  } as never;
}

async function collect<T>(events: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const event of events) {
    result.push(event);
  }
  return result;
}

function agentContext(): CucumberAgentContext {
  return {
    userId: "user-1",
    projectId: "project-1",
    canvasId: "project-1",
    runNodeId: "run-1",
    canvasSnapshot: { nodes: [], edges: [] },
    selectedNodeIds: [],
    knownNodeIds: ["run-1"],
    activatedSkills: [],
    producedArtifacts: [],
    pendingEvents: [],
    prompt: "生成图片",
    selectedNodeId: null,
    skillCandidates: [],
    upstreamContext: [],
  };
}
