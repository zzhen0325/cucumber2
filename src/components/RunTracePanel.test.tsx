import { describe, expect, it } from "vitest";

import {
  getEventLabel,
  summarizeRunTrace,
  summarizeTraceEvent,
} from "./run-trace-summary";
import type { AgentEvent } from "@/types/runtime";

describe("run trace summary", () => {
  it("summarizes the OpenAI Agents SDK event chain", () => {
    const events: AgentEvent[] = [
      event("run.created", { prompt: "生成图片" }),
      event("agent.active", { agentName: "Cucumber Manager" }),
      event("handoff.completed", { toAgent: "Cucumber Image Agent" }),
      event("tool.input", { toolName: "generate_image" }, "generate_image"),
      event("artifact.created", {
        artifact: { id: "artifact-1", type: "image", title: "Result" },
      }),
      event("tool.output", { toolName: "generate_image" }, "generate_image"),
      event("run.completed", { finalOutput: "完成", artifactIds: ["artifact-1"] }),
    ];

    const summary = summarizeRunTrace(events);
    expect(summary.runStatus).toBe("success");
    expect(summary.finalOutput).toBe("完成");
    expect(summary.agents).toHaveLength(1);
    expect(summary.handoffs).toHaveLength(1);
    expect(summary.artifacts).toEqual([
      { id: "artifact-1", type: "image", title: "Result" },
    ]);
    expect(summary.steps[0]).toMatchObject({ status: "success" });
  });

  it("labels all v2 events", () => {
    expect(getEventLabel(event("agent.message.delta", {}))).toBe(
      "Agent message delta"
    );
    expect(getEventLabel(event("handoff.requested", {}))).toBe("Handoff requested");
    expect(getEventLabel(event("tool.error", {}))).toBe("Tool error");
  });

  it("summarizes lightweight phase timings", () => {
    const events: AgentEvent[] = [
      event("run.created", { prompt: "生成图片" }),
      event(
        "run.step.completed",
        {
          durationMs: 20,
          label: "快速路由",
          phase: "prepare",
        },
        "quick.route"
      ),
      event(
        "run.step.completed",
        {
          durationMs: 1260,
          label: "归一化用户输入",
          phase: "prepare",
        },
        "input.normalize"
      ),
    ];

    const summary = summarizeRunTrace(events);
    expect(summary.steps[0]).toMatchObject({
      durationLabel: "20ms",
      label: "整理用户需求",
      status: "success",
    });
    expect(summary.steps[1]).toMatchObject({
      durationLabel: "1.3s",
      label: "整理用户需求",
      status: "success",
    });
    expect(summarizeTraceEvent(events[1])).toBe("整理用户需求 · 20ms");
    expect(summarizeTraceEvent(events[2])).toBe("整理用户需求 · 1.3s");
  });

  it("summarizes normalized input, context, skills, tool errors, and rejected operations", () => {
    const events: AgentEvent[] = [
      event("run.created", {
        prompt: "生成图片",
        contextSummary: {
          selectedNodes: [{ id: "run-1", kind: "run", label: "旧 Run" }],
          referenceNodes: [],
          upstreamPath: [{ nodeId: "prompt-1", type: "prompt", summary: "旧需求" }],
          omittedNodes: [
            { id: "run-1", kind: "run", label: "旧 Run", reason: "not_referenceable" },
          ],
        },
      }),
      event("input.normalized", {
        normalizedInput: {
          rawPrompt: "生成一张 16:9 黄瓜海报",
          intent: "image.generate",
          image: {
            contentPrompt: "黄瓜海报",
            resultCount: 1,
            aspectRatio: "16:9",
          },
        },
        contextSummary: {
          selectedNodes: [{ id: "image-1", kind: "imageResult", label: "参考图" }],
          referenceNodes: [{ id: "image-1", kind: "imageResult", label: "参考图" }],
          upstreamPath: [{ nodeId: "image-1", type: "image", title: "参考图" }],
          omittedNodes: [],
        },
      }),
      event("skill.retrieved", {
        candidates: [{ id: "skill-1", name: "imagegen-prompt-expander" }],
      }),
      event("skill.activated", {
        skill: {
          id: "skill-1",
          name: "imagegen-prompt-expander",
          purpose: "prompt_expansion",
        },
      }),
      event(
        "tool.error",
        {
          toolName: "generate_image",
          errorText: "Seedream image generation is not configured.",
        },
        "generate_image"
      ),
      event("canvas.operation.rejected", {
        operation: { id: "op-1", type: "createNode" },
        reason: "invalid_node_kind",
      }),
    ];

    const summary = summarizeRunTrace(events);
    expect(summary.normalizedInputSummary).toBe("image.generate · 1 张 · 16:9 · 黄瓜海报");
    expect(summary.context).toMatchObject({
      selectedNodes: [{ id: "image-1", kind: "imageResult", label: "参考图" }],
      referenceNodes: [{ id: "image-1", kind: "imageResult", label: "参考图" }],
      upstreamPath: [{ nodeId: "image-1", type: "image", title: "参考图" }],
    });
    expect(summarizeTraceEvent(events[2])).toContain("imagegen-prompt-expander");
    expect(summarizeTraceEvent(events[3])).toBe(
      "imagegen-prompt-expander · prompt_expansion"
    );
    expect(summarizeTraceEvent(events[4])).toContain("generate_image: Seedream");
    expect(summarizeTraceEvent(events[5])).toBe(
      "createNode · op-1 · invalid_node_kind"
    );
  });

  it("keeps full error details in trace summaries", () => {
    const longError =
      "Seedream width and height must produce a 1K to 4K image within the supported aspect ratio " +
      "(received 1125x450, area 506250). Please scale the requested output before calling the provider.";
    const toolError = event(
      "tool.error",
      {
        toolName: "generate_image",
        errorText: longError,
      },
      "generate_image"
    );
    const runFailed = event("run.failed", {
      errorSource: "tool",
      errorText: longError,
    });

    expect(summarizeTraceEvent(toolError)).toBe(`generate_image: ${longError}`);
    expect(summarizeTraceEvent(runFailed)).toBe(`工具: ${longError}`);
  });
});

function event(
  type: AgentEvent["type"],
  payload: Record<string, unknown>,
  stepId = "run"
): AgentEvent {
  return {
    projectId: "project-1",
    runNodeId: "run-1",
    stepId,
    type,
    payload,
    createdAt: "2026-06-11T00:00:00.000Z",
  };
}
