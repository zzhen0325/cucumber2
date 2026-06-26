import { describe, expect, it } from "vitest";

import { finalizeNormalizedAgentInput } from "./input-normalizer.ts";
import { selectAgentRoute } from "./task-router.ts";
import { makeTaskFrame } from "./test-task-frame.ts";

function frame(overrides: Parameters<typeof makeTaskFrame>[0]) {
  return makeTaskFrame(overrides);
}

describe("finalizeNormalizedAgentInput", () => {
  it("validates and normalizes a model Task Frame without rule correction", () => {
    const candidate = frame({
      rawInput: "日本家居banner KV 16:9主体是女生打扫家里的插画,四张",
      domain: "image",
      intent: "image.generate",
      action: "create",
      primaryAgent: "image_agent",
      explicit: [
        { key: "output_count", value: "4", sourceText: "四张" },
        { key: "aspect_ratio", value: "16:9", sourceText: "16:9" },
      ],
    });

    const normalized = finalizeNormalizedAgentInput(
      candidate,
      "日本家居banner KV 16:9主体是女生打扫家里的插画,四张"
    );

    expect(normalized.task).toMatchObject({
      domain: "image",
      intent: "image.generate",
      action: "create",
    });
    expect(normalized.routing.primaryAgent).toBe("image_agent");
    expect(normalized.constraints.explicit).toEqual([
      { key: "output_count", value: "4", sourceText: "四张" },
      { key: "aspect_ratio", value: "16:9", sourceText: "16:9" },
    ]);
    expect(normalized.rawInput).toBe(
      "日本家居 banner KV 16:9 主体是女生打扫家里的插画,四张"
    );
    expect(selectAgentRoute(normalized)).toBe("image");
  });

  it("preserves the model's routing decision verbatim (no fallback)", () => {
    const normalized = finalizeNormalizedAgentInput(
      frame({
        rawInput: "请用一句话解释什么是无限画布，不要生成图片。",
        domain: "text",
        intent: "text.answer",
        action: "analyze",
        primaryAgent: "manager_agent",
      }),
      "请用一句话解释什么是无限画布，不要生成图片。"
    );

    expect(normalized.task.domain).toBe("text");
    expect(normalized.routing.primaryAgent).toBe("manager_agent");
    expect(selectAgentRoute(normalized)).toBe("manager");
  });

  it("keeps multi-dimension expansion constraints for the Image Agent", () => {
    const normalized = finalizeNormalizedAgentInput(
      frame({
        rawInput: "帮我把这个图拓展4个尺寸：1125-450 / 1125-600 / 900-1200 / 800-800",
        domain: "image",
        intent: "image.generate",
        action: "create",
        primaryAgent: "image_agent",
        explicit: [
          { key: "dimension", value: "1125x450", sourceText: "1125-450" },
          { key: "dimension", value: "1125x600", sourceText: "1125-600" },
          { key: "dimension", value: "900x1200", sourceText: "900-1200" },
          { key: "dimension", value: "800x800", sourceText: "800-800" },
        ],
      }),
      "帮我把这个图拓展4个尺寸：1125-450 / 1125-600 / 900-1200 / 800-800"
    );

    expect(normalized.constraints.explicit).toHaveLength(4);
    expect(selectAgentRoute(normalized)).toBe("image");
  });

  it("routes diagrams to the document agent when the model says so", () => {
    const normalized = finalizeNormalizedAgentInput(
      frame({
        rawInput: "帮我创建一个视觉 H5 需求的流程时序图",
        domain: "text",
        intent: "document.create",
        action: "create",
        primaryAgent: "document_agent",
      }),
      "帮我创建一个视觉 H5 需求的流程时序图"
    );

    expect(selectAgentRoute(normalized)).toBe("document");
  });

  it("defaults missing optional collections to empty arrays", () => {
    const normalized = finalizeNormalizedAgentInput(
      {
        task: {
          domain: "text",
          intent: "text.answer",
          action: "analyze",
          confidence: 0.8,
        },
        userGoal: { original: "hi", normalized: "hi" },
        routing: { primaryAgent: "manager_agent" },
        inputs: { text: "hi" },
      },
      "hi"
    );

    expect(normalized.constraints.explicit).toEqual([]);
    expect(normalized.constraints.inferred).toEqual([]);
    expect(normalized.inputs.images).toEqual([]);
    expect(normalized.inputs.files).toEqual([]);
    expect(normalized.ambiguities).toEqual([]);
    expect(normalized.routing.candidateAgents).toEqual([]);
  });

  it("throws on an invalid primary agent", () => {
    expect(() =>
      finalizeNormalizedAgentInput(
        {
          task: {
            domain: "text",
            intent: "text.answer",
            action: "analyze",
            confidence: 0.8,
          },
          userGoal: { original: "hi", normalized: "hi" },
          routing: { primaryAgent: "ghost_agent" },
          inputs: { text: "hi" },
        },
        "hi"
      )
    ).toThrow();
  });
});
