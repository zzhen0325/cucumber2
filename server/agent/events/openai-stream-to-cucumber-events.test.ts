import { describe, expect, it } from "vitest";

import type { CucumberAgentContext, CucumberRunEvent } from "../context";
import { openAIStreamToCucumberEvents } from "./openai-stream-to-cucumber-events";

describe("OpenAI Agents stream adapter", () => {
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
    producedArtifacts: [],
    pendingEvents: [],
    prompt: "生成图片",
    selectedNodeId: null,
    skillCandidates: [],
    upstreamContext: [],
  };
}
