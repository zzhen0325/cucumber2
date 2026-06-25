import { describe, expect, it } from "vitest";

import type { AgentRunInput } from "./context.ts";
import { buildAgentRunnerInput } from "./runtime.ts";

describe("buildAgentRunnerInput", () => {
  it("attaches selected upstream images as multimodal model input", async () => {
    const input = baseAgentRunInput({
      selectedNodeIds: ["image-2"],
      upstreamContext: [
        {
          imageUrl: "https://cdn.example/unselected.png",
          nodeId: "image-1",
          type: "image",
        },
        {
          imageUrl: "https://cdn.example/selected.png",
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
