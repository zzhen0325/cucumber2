import { describe, expect, it } from "vitest";

import { getEventLabel, summarizeRunTrace } from "./run-trace-summary";
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
    expect(getEventLabel(event("handoff.requested", {}))).toBe("Handoff requested");
    expect(getEventLabel(event("tool.error", {}))).toBe("Tool error");
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
