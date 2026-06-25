import { describe, expect, it } from "vitest";

import type { AgentRunInput } from "./context.ts";
import {
  finalizeFastRouteDecision,
  routeAgentRunFast,
} from "./fast-intent-router.ts";

describe("fast intent router", () => {
  it("accepts high-confidence answer routes and keeps image tooling questions out of generation", async () => {
    const route = await routeAgentRunFast(
      input({ message: "有哪些免费的图片生成工具推荐" }),
      {
        decision: {
          operation: "answer",
          artifact: null,
          domain: "general",
          requiredCapabilities: [],
          negativeCapabilities: ["image-generation"],
          preferredRoute: "manager",
          candidateTools: [],
          confidence: 0.92,
          needsFullNormalization: false,
          reason: "The user asks for recommendations about tools.",
        },
      }
    );

    expect(route).toMatchObject({
      route: "simple_chat",
      routerSource: "fast-intent-router",
      requiresModelNormalization: false,
      confidence: 0.92,
      preferredRoute: "manager",
      normalizedInput: {
        operation: "answer",
        artifact: null,
        negativeCapabilities: ["image-generation"],
        intent: "text.answer",
      },
    });
    expect(route.normalizedInput?.image).toBeUndefined();
  });

  it("accepts high-confidence image generation routes", () => {
    const route = finalizeFastRouteDecision(
      {
        operation: "create",
        artifact: { kind: "image", subtype: "poster", format: "png" },
        domain: "visual-design",
        requiredCapabilities: ["image-generation"],
        negativeCapabilities: [],
        preferredRoute: "image",
        candidateTools: ["generate_image"],
        confidence: 0.94,
        needsFullNormalization: false,
        reason: "The user explicitly asks to generate an image.",
      },
      input({ message: "生成一张 16:9 黄瓜海报" })
    );

    expect(route).toMatchObject({
      route: "image_task",
      routerSource: "fast-intent-router",
      requiresModelNormalization: false,
      confidence: 0.94,
      preferredRoute: "image",
      normalizedInput: {
        artifact: { kind: "image", subtype: "poster", format: "png" },
        requiredCapabilities: ["image-generation"],
        intent: "image.generate",
        image: {
          aspectRatio: "16:9",
          resultCount: 1,
        },
      },
    });
  });

  it("accepts HTML animation routes as document-owned webpage artifacts", () => {
    const route = finalizeFastRouteDecision(
      {
        operation: "create",
        artifact: { kind: "webpage", subtype: "animation", format: "html" },
        domain: "visual-design",
        requiredCapabilities: ["html-artifact", "animation"],
        negativeCapabilities: ["image-generation"],
        preferredRoute: "document",
        candidateTools: ["create_text_artifact"],
        confidence: 0.91,
        needsFullNormalization: false,
      },
      input({ message: "用huashu skill 帮我做个30秒的HTML动画，讲agent怎么工作" })
    );

    expect(route).toMatchObject({
      route: "complex_agent_task",
      routerSource: "fast-intent-router",
      requiresModelNormalization: false,
      preferredRoute: "document",
      normalizedInput: {
        artifact: { kind: "webpage", subtype: "animation", format: "html" },
        negativeCapabilities: ["image-generation"],
        intent: "webpage.create",
      },
    });
    expect(route.normalizedInput?.image).toBeUndefined();
  });

  it("falls back when confidence is low", () => {
    const route = finalizeFastRouteDecision(
      {
        operation: "edit",
        artifact: null,
        requiredCapabilities: [],
        negativeCapabilities: [],
        preferredRoute: "manager",
        candidateTools: [],
        confidence: 0.54,
        needsFullNormalization: false,
      },
      input({
        message: "优化这个",
        selectedNodeId: "node-1",
        selectedNodeIds: ["node-1"],
        upstreamContext: [{ nodeId: "node-1", type: "artifact", summary: "old" }],
      })
    );

    expect(route).toMatchObject({
      route: "complex_agent_task",
      routerSource: "fast-intent-router",
      requiresModelNormalization: true,
      fallbackReason: "low_confidence:0.54",
    });
  });

  it("falls back when the model asks for full normalization", () => {
    const route = finalizeFastRouteDecision(
      {
        operation: "edit",
        artifact: null,
        requiredCapabilities: [],
        negativeCapabilities: [],
        preferredRoute: "manager",
        candidateTools: [],
        confidence: 0.9,
        needsFullNormalization: true,
      },
      input({ message: "优化这个" })
    );

    expect(route).toMatchObject({
      requiresModelNormalization: true,
      fallbackReason: "model_requested_full_normalization",
    });
  });

  it("falls back on schema-invalid mock output", async () => {
    const route = await routeAgentRunFast(input({ message: "你好" }), {
      decision: { operation: "answer" },
    });

    expect(route).toMatchObject({
      route: "complex_agent_task",
      routerSource: "fast-intent-router",
      requiresModelNormalization: true,
      fallbackReason: "schema_invalid",
    });
  });

  it("falls back when model preference conflicts with finalized capabilities", () => {
    const route = finalizeFastRouteDecision(
      {
        operation: "create",
        artifact: { kind: "image", format: "png" },
        domain: "general",
        requiredCapabilities: ["image-generation"],
        negativeCapabilities: [],
        preferredRoute: "image",
        candidateTools: ["generate_image"],
        confidence: 0.91,
        needsFullNormalization: false,
      },
      input({ message: "有哪些免费的图片生成工具推荐" })
    );

    expect(route).toMatchObject({
      route: "complex_agent_task",
      routerSource: "fast-intent-router",
      requiresModelNormalization: true,
      fallbackReason: "capability_mismatch:image",
    });
  });
});

function input(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    canvasId: "project-1",
    canvasSnapshot: {
      edges: [],
      nodes: [
        {
          id: "run-1",
          type: "runNode",
          position: { x: 0, y: 240 },
          data: {
            kind: "run",
            prompt: "哈喽",
            status: "queued",
          },
        },
      ],
    },
    message: "哈喽",
    projectId: "project-1",
    promptNodeId: "prompt-1",
    runNodeId: "run-1",
    selectedNodeId: null,
    selectedNodeIds: [],
    upstreamContext: [],
    userId: "user-1",
    ...overrides,
  };
}
