import { describe, expect, it } from "vitest";

import {
  IMAGE_GENERATE_CAPABILITY_ID,
  PROMPT_EXPAND_CAPABILITY_ID,
  buildCapabilityRegistry,
} from "./capabilities";
import { kernelStepsFromPlan, planAgentRun } from "./agent-router";

const promptExpandSkill = {
  id: "skill-1",
  name: "prompt-expand",
  slug: "prompt-expand",
  description: "扩写 prompt",
  instructions: "只输出扩写 prompt。",
  config: {},
  sourceManifest: {},
  updatedAt: "2026-06-08T00:00:00.000Z",
};

describe("agent router", () => {
  it("routes image generation to prompt.expand and image.generate", () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const plan = planAgentRun({
      capabilities,
      hasReferenceImages: false,
      canvasContext: {
        prompt: "生成一张绿色海报",
        selectedNodeId: null,
        upstreamContext: [],
      },
    });

    expect(plan.selectedCapabilityIds).toEqual([
      PROMPT_EXPAND_CAPABILITY_ID,
      IMAGE_GENERATE_CAPABILITY_ID,
    ]);
    expect(kernelStepsFromPlan(plan).map((step) => step.id)).toEqual([
      "agent_text",
      "expand_prompt",
      "generate_image",
    ]);
    expect(plan.router.result.selectedCapabilities).toHaveLength(2);
  });

  it("adds reference image analysis to the step graph when needed", () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const plan = planAgentRun({
      capabilities,
      hasReferenceImages: true,
      canvasContext: {
        prompt: "延续参考图生成一张图片",
        selectedNodeId: "image-1",
        upstreamContext: [
          {
            nodeId: "image-1",
            type: "image",
            imageUrl: "https://cdn.example/1.png",
            artifact: {
              id: "artifact-1",
              type: "image",
              uri: "https://cdn.example/1.png",
            },
          },
        ],
      },
    });

    expect(plan.stepGraph.nodes.map((step) => step.id)).toEqual([
      "agent_text",
      "analyze_reference_images",
      "expand_prompt",
      "generate_image",
    ]);
    expect(plan.router.result.upstreamArtifactTypes).toEqual(["image"]);
  });

  it("fails clearly when prompt.expand is unavailable", () => {
    expect(() =>
      planAgentRun({
        capabilities: buildCapabilityRegistry([]),
        hasReferenceImages: false,
        canvasContext: {
          prompt: "生成图片",
          selectedNodeId: null,
          upstreamContext: [],
        },
      })
    ).toThrow("prompt.expand");
  });
});
