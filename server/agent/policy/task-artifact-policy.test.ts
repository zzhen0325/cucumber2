import { describe, expect, it } from "vitest";

import type { CucumberAgentContext } from "../context.ts";
import {
  assertImageToolAllowed,
  assertTextArtifactToolAllowed,
} from "./task-artifact-policy.ts";

describe("task artifact policy", () => {
  it("rejects image generation for diagram tasks with negative capability", () => {
    expect(() =>
      assertImageToolAllowed(
        context({
          normalizedInput: {
            rawPrompt: "帮我创建一个视觉 H5 需求的流程时序图",
            userGoal: "帮我创建一个视觉 H5 需求的流程时序图",
            operation: "create",
            artifact: {
              kind: "diagram",
              subtype: "sequenceDiagram",
              format: "mermaid",
            },
            domain: "visual-design",
            requiredCapabilities: ["sequence-diagram", "markdown-artifact"],
            negativeCapabilities: ["image-generation"],
          },
        }),
        "generate_image"
      )
    ).toThrow("tool_policy_rejected");
  });

  it("allows text artifacts for diagram tasks", () => {
    expect(() =>
      assertTextArtifactToolAllowed(
        context({
          normalizedInput: {
            rawPrompt: "生成一个流程时序图",
            userGoal: "生成一个流程时序图",
            operation: "create",
            artifact: {
              kind: "diagram",
              subtype: "sequenceDiagram",
              format: "mermaid",
            },
            domain: "general",
            requiredCapabilities: ["sequence-diagram", "markdown-artifact"],
            negativeCapabilities: ["image-generation"],
          },
        })
      )
    ).not.toThrow();
  });

  it("rejects text artifact creation for image tasks", () => {
    expect(() =>
      assertTextArtifactToolAllowed(
        context({
          normalizedInput: {
            rawPrompt: "生成一张流程图风格海报",
            userGoal: "生成一张流程图风格海报",
            operation: "create",
            artifact: { kind: "image", subtype: "poster", format: "png" },
            domain: "visual-design",
            requiredCapabilities: ["image-generation"],
            negativeCapabilities: [],
          },
        })
      )
    ).toThrow("tool_policy_rejected");
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
