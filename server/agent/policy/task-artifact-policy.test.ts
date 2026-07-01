import { describe, expect, it } from "vitest";

import type { CucumberAgentContext } from "../context.ts";
import { makeTaskFrame } from "../test-task-frame.ts";
import {
  assertImageInspectionToolAllowed,
  assertImageToolAllowed,
  assertTextArtifactToolAllowed,
} from "./task-artifact-policy.ts";

describe("task artifact policy", () => {
  it("rejects image generation for non-image (diagram/text) tasks", () => {
    expect(() =>
      assertImageToolAllowed(
        context({
          normalizedInput: makeTaskFrame({
            rawInput: "帮我创建一个视觉 H5 需求的流程时序图",
            domain: "text",
            intent: "document.create",
            action: "create",
            primaryAgent: "document_agent",
          }),
        }),
        "generate_image"
      )
    ).toThrow("tool_policy_rejected");
  });

  it("allows text artifacts for text-domain diagram tasks", () => {
    expect(() =>
      assertTextArtifactToolAllowed(
        context({
          normalizedInput: makeTaskFrame({
            rawInput: "生成一个流程时序图",
            domain: "text",
            intent: "document.create",
            action: "create",
            primaryAgent: "document_agent",
          }),
        })
      )
    ).not.toThrow();
  });

  it("allows text artifact creation for generated HTML webpage tasks", () => {
    expect(() =>
      assertTextArtifactToolAllowed(
        context({
          normalizedInput: makeTaskFrame({
            rawInput: "做个 30 秒 HTML 动画",
            domain: "text",
            intent: "webpage.create",
            action: "create",
            primaryAgent: "document_agent",
          }),
        })
      )
    ).not.toThrow();
  });

  it("rejects image generation for generated HTML webpage tasks", () => {
    expect(() =>
      assertImageToolAllowed(
        context({
          normalizedInput: makeTaskFrame({
            rawInput: "做个 30 秒 HTML 动画",
            domain: "text",
            intent: "webpage.create",
            action: "create",
            primaryAgent: "document_agent",
          }),
        }),
        "generate_image"
      )
    ).toThrow("tool_policy_rejected");
  });

  it("rejects text artifact creation for image tasks", () => {
    expect(() =>
      assertTextArtifactToolAllowed(
        context({
          normalizedInput: makeTaskFrame({
            rawInput: "生成一张流程图风格海报",
            domain: "image",
            intent: "image.generate",
            action: "create",
            primaryAgent: "image_agent",
          }),
        })
      )
    ).toThrow("tool_policy_rejected");
  });

  it("allows image generation tools for hybrid workflows with image output", () => {
    expect(() =>
      assertImageToolAllowed(
        context({
          normalizedInput: makeTaskFrame({
            rawInput: "分析这张图并生成海报",
            domain: "mixed",
            intent: "analysis.then.image",
            action: "create",
            primaryAgent: "manager_agent",
            workflow: {
              mode: "multi_step",
              outputArtifacts: ["image"],
              requiredAgents: ["image_agent"],
              requiredCapabilities: ["media-analysis", "image-generation"],
            },
          }),
        }),
        "generate_image"
      )
    ).not.toThrow();
  });

  it("allows text artifacts for hybrid workflows with code or document output", () => {
    expect(() =>
      assertTextArtifactToolAllowed(
        context({
          normalizedInput: makeTaskFrame({
            rawInput: "生成海报并输出 HTML 代码",
            domain: "mixed",
            intent: "hybrid.visual.code.create",
            action: "create",
            primaryAgent: "manager_agent",
            workflow: {
              mode: "hybrid",
              outputArtifacts: ["image", "code"],
              requiredAgents: ["image_agent", "document_agent"],
            },
          }),
        })
      )
    ).not.toThrow();
  });

  it("blocks image generation for image analysis tasks", () => {
    expect(() =>
      assertImageToolAllowed(
        context({
          normalizedInput: makeTaskFrame({
            rawInput: "分析这张图的风格",
            domain: "image",
            intent: "media.analyze",
            action: "analyze",
            primaryAgent: "image_agent",
          }),
        }),
        "generate_image"
      )
    ).toThrow("tool_policy_rejected");
  });

  it("allows image matting for image transform tasks", () => {
    expect(() =>
      assertImageToolAllowed(
        context({
          normalizedInput: makeTaskFrame({
            rawInput: "给这张图去背景",
            domain: "image",
            intent: "image.matting",
            action: "transform",
            primaryAgent: "image_agent",
          }),
        }),
        "image_matting"
      )
    ).not.toThrow();
  });

  it("allows image inspection tools for image analysis tasks", () => {
    expect(() =>
      assertImageInspectionToolAllowed(
        context({
          normalizedInput: makeTaskFrame({
            rawInput: "分析这张图的风格",
            domain: "image",
            intent: "image.decompose",
            action: "analyze",
            primaryAgent: "image_agent",
          }),
        }),
        "decompose_image",
        "image-decompose"
      )
    ).not.toThrow();
  });
});

function context(overrides: Partial<CucumberAgentContext> = {}): CucumberAgentContext {
  return {
    activatedSkills: [],
    canvasId: "project-1",
    canvasSnapshot: { edges: [], nodes: [] },
    knownNodeIds: [],
    pendingEvents: [],
    producedArtifacts: [],
    projectId: "project-1",
    prompt: "hello",
    runNodeId: "run-1",
    selectedNodeId: null,
    selectedNodeIds: [],
    skillCandidates: [],
    upstreamContext: [],
    userId: "user-1",
    ...overrides,
  };
}
