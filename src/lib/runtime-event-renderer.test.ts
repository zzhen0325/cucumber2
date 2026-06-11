import { describe, expect, it } from "vitest";

import {
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
