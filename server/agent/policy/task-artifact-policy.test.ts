import { describe, expect, it } from "vitest";

import type { CucumberAgentContext } from "../context.ts";
import { makeTaskFrame } from "../test-task-frame.ts";
import {
  assertImageInspectionToolAllowed,
  assertImageToolAllowed,
  assertTextArtifactToolAllowed,
} from "./task-artifact-policy.ts";

describe("task artifact policy", () => {
  it("does not require set_task_frame before execution tools", () => {
    expect(() =>
      assertTextArtifactToolAllowed(context())
    ).not.toThrow();
    expect(() =>
      assertImageToolAllowed(context(), "generate_image")
    ).not.toThrow();
  });

  it("does not use Task Frame as a hard execution gate", () => {
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
    ).not.toThrow();

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
    ).not.toThrow();

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
    ).not.toThrow();
  });

  it("keeps compatibility helpers permissive for existing tool call sites", () => {
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
