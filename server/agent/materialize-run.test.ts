import { describe, expect, it } from "vitest";

import type { AgentProject } from "../supabase";
import type { AgentEvent } from "../../src/types/runtime";
import { materializeSnapshot } from "./materialize-run";

describe("agent run materializer", () => {
  it("writes artifact result nodes while preserving unrelated canvas nodes", () => {
    const project = projectSnapshot();
    const next = materializeSnapshot(
      project,
      [
        event("run.created", {
          prompt: "生成一张图",
          promptNodeId: "prompt-1",
          selectedNodeId: null,
        }),
        event("tool.input", {
          toolCallId: "tool-1",
          toolName: "generate_image",
          input: { prompt: "生成一张图", resultCount: 1 },
        }),
        event("artifact.created", {
          artifact: {
            id: "image-1",
            type: "image",
            uri: "https://example.com/image.png",
            title: "Result",
          },
          toolName: "generate_image",
        }),
        event("run.completed", {
          artifactIds: ["image-1"],
          finalOutput: "完成",
        }),
      ],
      "run-1"
    );

    expect(next.nodes.some((node) => node.id === "manual-note")).toBe(true);
    expect(
      next.nodes.find((node) => node.id === "run-1")?.data
    ).toMatchObject({ kind: "run", status: "success" });
    expect(
      next.nodes.find((node) => node.data.kind === "imageResult")?.data
    ).toMatchObject({
      kind: "imageResult",
      runId: "run-1",
      status: "ready",
    });
  });

  it("writes failed run state into the snapshot", () => {
    const next = materializeSnapshot(
      projectSnapshot(),
      [
        event("run.created", {
          prompt: "生成一张图",
          promptNodeId: "prompt-1",
          selectedNodeId: null,
        }),
        event("run.failed", {
          errorText: "Seedream image generation is not configured.",
          status: "failed",
        }),
      ],
      "run-1"
    );

    expect(
      next.nodes.find((node) => node.id === "run-1")?.data
    ).toMatchObject({
      kind: "run",
      status: "error",
      error: "Seedream image generation is not configured.",
    });
    expect(next.nodes.some((node) => node.id === "manual-note")).toBe(true);
  });
});

function projectSnapshot(): Pick<AgentProject, "edges" | "id" | "nodes"> {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    nodes: [
      {
        id: "manual-note",
        type: "stickyNoteNode",
        position: { x: -200, y: -80 },
        data: {
          kind: "stickyNote",
          text: "保留这个节点",
          color: "yellow",
          createdAt: "2026-06-12T00:00:00.000Z",
        },
      },
      {
        id: "prompt-1",
        type: "promptNode",
        position: { x: 0, y: 0 },
        data: {
          kind: "prompt",
          prompt: "生成一张图",
          contextLabel: "Root request",
          createdAt: "2026-06-12T00:00:01.000Z",
        },
      },
      {
        id: "run-1",
        type: "runNode",
        position: { x: 0, y: 124 },
        data: {
          kind: "run",
          prompt: "生成一张图",
          status: "running",
        },
      },
    ],
    edges: [
      {
        id: "edge-prompt-1-run-1",
        source: "prompt-1",
        target: "run-1",
        type: "animated",
        data: { active: true },
      },
    ],
  };
}

function event(type: AgentEvent["type"], payload: AgentEvent["payload"]): AgentEvent {
  return {
    projectId: "00000000-0000-4000-8000-000000000001",
    runNodeId: "run-1",
    stepId:
      type === "tool.input" || type === "artifact.created"
        ? "generate_image"
        : "run",
    type,
    payload,
    createdAt: `2026-06-12T00:00:0${eventCounter++}.000Z`,
  };
}

let eventCounter = 1;
