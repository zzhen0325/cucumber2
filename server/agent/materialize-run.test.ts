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
      error: "Seedream 调用失败。",
    });
    expect(next.nodes.some((node) => node.id === "manual-note")).toBe(true);
  });

  it("removes duplicate result nodes for the same run artifact id", () => {
    const project = projectSnapshot();
    project.nodes.push(
      {
        id: "image-pending-run-1-1",
        type: "imageResultNode",
        position: { x: 0, y: 200 },
        data: {
          kind: "imageResult",
          image: {
            id: "image-1",
            url: "/api/projects/project-1/artifacts/image-1/content",
          },
          artifact: {
            id: "image-1",
            type: "image",
            uri: "/api/projects/project-1/artifacts/image-1/content",
          },
          prompt: "生成一张图",
          runId: "run-1",
          status: "ready",
        },
      },
      {
        id: "artifact-image-1",
        type: "imageResultNode",
        position: { x: 260, y: 200 },
        data: {
          kind: "imageResult",
          image: {
            id: "image-1",
            url: "/api/projects/project-1/artifacts/image-1/content",
          },
          artifact: {
            id: "image-1",
            type: "image",
            uri: "/api/projects/project-1/artifacts/image-1/content",
          },
          prompt: "生成一张图",
          runId: "run-1",
          status: "ready",
        },
      }
    );
    project.edges.push(
      {
        id: "edge-run-1-image-pending-run-1-1",
        source: "run-1",
        target: "image-pending-run-1-1",
        type: "animated",
      },
      {
        id: "edge-run-1-artifact-image-1",
        source: "run-1",
        target: "artifact-image-1",
        type: "animated",
      }
    );

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
            uri: "/api/projects/project-1/artifacts/image-1/content",
          },
          toolName: "generate_image",
        }),
      ],
      "run-1"
    );

    const resultNodes = next.nodes.filter(
      (node) => node.data.kind === "imageResult" && node.data.image.id === "image-1"
    );
    expect(resultNodes).toHaveLength(1);
    expect(next.edges.some((edge) => edge.target === "artifact-image-1")).toBe(false);
  });

  it("materializes simple replies as a result prompt node", () => {
    const project = projectSnapshot();
    project.nodes.push(
      {
        id: "prompt-old",
        type: "promptNode",
        position: { x: -260, y: 0 },
        data: {
          kind: "prompt",
          prompt: "旧问题",
          contextLabel: "Previous request",
          createdAt: "2026-06-12T00:00:00.000Z",
        },
      },
      {
        id: "prompt-new",
        type: "promptNode",
        position: { x: 260, y: 0 },
        data: {
          kind: "prompt",
          prompt: "黄瓜是什么？",
          contextLabel: "Root request",
          createdAt: "2026-06-12T00:00:04.000Z",
        },
      },
      {
        id: "run-new",
        type: "runNode",
        position: { x: 260, y: 124 },
        data: {
          kind: "run",
          prompt: "黄瓜是什么？",
          status: "running",
        },
      }
    );
    project.edges.push({
      id: "edge-prompt-new-run-new",
      source: "prompt-new",
      target: "run-new",
      type: "animated",
      data: { active: true },
    });

    const next = materializeSnapshot(
      project,
      [
        event("run.created", {
          prompt: "黄瓜是什么？",
          promptNodeId: "prompt-new",
          selectedNodeId: "prompt-old",
        }, "run-new"),
        event("run.completed", {
          artifactIds: [],
          finalOutput: "黄瓜是一种常见的葫芦科蔬菜。",
        }, "run-new"),
      ],
      "run-new"
    );

    expect(next.nodes.find((node) => node.id === "prompt-new")?.data).toMatchObject({
      kind: "prompt",
      prompt: "黄瓜是什么？",
    });
    expect(next.nodes.find((node) => node.id === "prompt-new")?.data).not.toHaveProperty("response");
    expect(next.nodes.find((node) => node.id === "prompt-old")?.data).toMatchObject({
      kind: "prompt",
      prompt: "旧问题",
    });
    expect(next.nodes.find((node) => node.id === "prompt-old")?.data).not.toHaveProperty("response");
    expect(next.nodes.find((node) => node.id === "prompt-result-run-new")?.data).toMatchObject({
      kind: "prompt",
      prompt: "黄瓜是一种常见的葫芦科蔬菜。",
      contextLabel: "Agent reply",
    });
    expect(
      next.edges.find(
        (edge) => edge.source === "run-new" && edge.target === "prompt-result-run-new"
      )
    ).toBeTruthy();
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

function event(
  type: AgentEvent["type"],
  payload: AgentEvent["payload"],
  runNodeId = "run-1"
): AgentEvent {
  return {
    projectId: "00000000-0000-4000-8000-000000000001",
    runNodeId,
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
