import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentRunInput } from "./context.ts";
import { buildAgentRunnerInput } from "./runtime.ts";
import type { UpstreamContextItem } from "../../src/types/canvas.ts";

const mocks = vi.hoisted(() => ({
  resolveStorageBackedImageContext: vi.fn(
    async (
      items: UpstreamContextItem[],
      _options?: { projectId: string; userId: string }
    ) =>
      items.map((item) => ({
        ...item,
        imageUrl:
          item.nodeId === "image-2"
            ? "https://cdn.example/selected.png"
            : "https://cdn.example/unselected.png",
      }))
  ),
}));

vi.mock("../storage.ts", () => ({
  resolveStorageBackedImageContext: (
    items: UpstreamContextItem[],
    options: { projectId: string; userId: string }
  ) => mocks.resolveStorageBackedImageContext(items, options),
}));

describe("buildAgentRunnerInput", () => {
  beforeEach(() => {
    mocks.resolveStorageBackedImageContext.mockClear();
  });

  it("attaches selected upstream images as multimodal model input", async () => {
    const input = baseAgentRunInput({
      selectedNodeIds: ["image-2"],
      upstreamContext: [
        {
          artifact: { id: "artifact-1", type: "image" },
          nodeId: "image-1",
          type: "image",
        },
        {
          artifact: { id: "artifact-2", type: "image" },
          nodeId: "image-2",
          type: "image",
        },
      ],
    });

    await expect(buildAgentRunnerInput(input, "User request")).resolves.toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "User request" },
          {
            type: "input_image",
            image: "https://cdn.example/selected.png",
            detail: "auto",
          },
          {
            type: "input_image",
            image: "https://cdn.example/unselected.png",
            detail: "auto",
          },
        ],
      },
    ]);
    expect(mocks.resolveStorageBackedImageContext).toHaveBeenCalledWith(
      [
        {
          artifact: { id: "artifact-2", type: "image" },
          nodeId: "image-2",
          type: "image",
        },
        {
          artifact: { id: "artifact-1", type: "image" },
          nodeId: "image-1",
          type: "image",
        },
      ],
      { projectId: "project-1", userId: "user-1" }
    );
  });
});

function baseAgentRunInput(overrides: Partial<AgentRunInput>): AgentRunInput {
  return {
    userId: "user-1",
    projectId: "project-1",
    canvasId: "canvas-1",
    runNodeId: "run-1",
    message: "User request",
    promptNodeId: "prompt-1",
    selectedNodeId: overrides.selectedNodeIds?.[0] ?? null,
    selectedNodeIds: [],
    upstreamContext: [],
    canvasSnapshot: { nodes: [], edges: [] },
    ...overrides,
  };
}
