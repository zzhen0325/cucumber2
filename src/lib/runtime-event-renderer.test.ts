import { describe, expect, it } from "vitest";

import {
  applyCanvasOperation,
  projectRuntimeEventsToCanvas,
  runtimeEventsFromMessageParts,
  runtimeEventsFromMessages,
} from "./runtime-event-renderer";
import type { AgentCanvasNode } from "@/types/canvas";
import type { RuntimeEvent } from "@/types/runtime";

describe("runtime event renderer", () => {
  it("projects runtime events through the canvas projection adapter", () => {
    const projection = projectRuntimeEventsToCanvas({
      projectId: "project-1",
      events: [
        event("run.created", "run-1", "run", {
          prompt: "生成图片",
          selectedNodeId: null,
        }),
        event("run.completed", "run-1", "run", {}),
      ],
    });

    expect(projection.nodes.map((node) => node.data.kind)).toEqual([
      "prompt",
      "run",
    ]);
    expect(projection.runSummaries["run-1"]).toMatchObject({
      status: "completed",
      eventCount: 2,
    });
  });

  it("applies canvas operations with the existing reducer policy", () => {
    const runNode: AgentCanvasNode = {
      id: "run-1",
      type: "runNode",
      position: { x: 0, y: 0 },
      data: {
        kind: "run",
        prompt: "生成图片",
        status: "running",
      },
    };

    const state = applyCanvasOperation(
      {
        projectId: "project-1",
        nodes: [runNode],
        edges: [],
        rejectedOperations: [],
        runSummaries: {},
      },
      {
        id: "op-1",
        projectId: "project-2",
        type: "setNodeStatus",
        payload: {
          nodeId: "run-1",
          status: "completed",
        },
      }
    );

    expect(state.rejectedOperations[0].reason).toBe("patch_project_mismatch");
  });

  it("extracts runtime events from AI SDK data parts", () => {
    const first = event("run.created", "run-1", "run", {
      prompt: "生成图片",
      selectedNodeId: null,
    });
    const second = event("step.started", "run-1", "route", {
      title: "识别任务",
    });

    expect(
      runtimeEventsFromMessageParts([
        { type: "text", text: "ignored" },
        { type: "data-runtime-event", data: second },
        { type: "data-runtime-event", data: first },
        { type: "data-runtime-event", data: { ...first, type: "unknown" } },
      ])
    ).toEqual([second, first]);
  });

  it("sorts and filters runtime events from messages by run id", () => {
    const first = event("run.created", "run-1", "run", {});
    const second = event("run.completed", "run-1", "run", {});
    const otherRun = event("run.created", "run-2", "run", {});

    expect(
      runtimeEventsFromMessages(
        [
          { parts: [{ type: "data-runtime-event", data: second }] },
          { parts: [{ type: "data-runtime-event", data: otherRun }] },
          { parts: [{ type: "data-runtime-event", data: first }] },
        ],
        "run-1"
      )
    ).toEqual([first, second]);
  });

  it("adapts legacy AI SDK tool parts into runtime events", () => {
    const events = runtimeEventsFromMessages(
      [
        {
          parts: [
            {
              type: "tool-generate_image",
              state: "output-available",
              toolCallId: "tool-1",
              input: { prompt: "生成图片" },
              output: {
                images: [
                  {
                    id: "image-1",
                    url: "https://example.test/image.png",
                    title: "生成图",
                  },
                ],
              },
            },
          ],
        },
      ],
      {
        projectId: "project-1",
        runNodeId: "run-1",
        prompt: "生成图片",
        promptNodeId: "prompt-1",
        selectedNodeId: null,
        includeLegacyToolParts: true,
      }
    );

    expect(events.map((candidate) => candidate.type)).toEqual([
      "run.created",
      "tool.input",
      "tool.output",
      "artifact.created",
      "run.completed",
    ]);
    const artifactEvent = events.find(
      (candidate) => candidate.type === "artifact.created"
    );
    expect(artifactEvent?.payload.artifact).toMatchObject({
      id: "image-1",
      type: "image",
      uri: "https://example.test/image.png",
    });
  });
});

function event(
  type: RuntimeEvent["type"],
  runNodeId: string,
  stepId: string,
  payload: Record<string, unknown>
): RuntimeEvent {
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
