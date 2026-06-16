import { describe, expect, it } from "vitest";

import type { CucumberAgentContext } from "../context.ts";
import { isSpecialistEnabledForContext } from "./registry.ts";

describe("specialist agent registry", () => {
  it("enables the document specialist from normalized document intents", () => {
    expect(
      isSpecialistEnabledForContext(
        {
          enabledRoutes: ["document"],
          handoffPolicy: () => false,
        },
        agentContext({
          normalizedInput: {
            rawPrompt: "写一份 PRD",
            userGoal: "写一份 PRD",
            operation: "create",
            artifact: { kind: "document", subtype: "prd", format: "markdown" },
            domain: "product",
            requiredCapabilities: ["markdown-artifact"],
            negativeCapabilities: [],
          },
        })
      )
    ).toBe(true);
  });

  it("keeps a specialist disabled when neither intent nor policy matches", () => {
    expect(
      isSpecialistEnabledForContext(
        {
          enabledRoutes: ["document"],
          handoffPolicy: () => false,
        },
        agentContext({
          normalizedInput: {
            rawPrompt: "解释一下这个概念",
            userGoal: "解释一下这个概念",
            operation: "answer",
            artifact: null,
            domain: "general",
            requiredCapabilities: [],
            negativeCapabilities: [],
          },
        })
      )
    ).toBe(false);
  });

  it("does not let fallback policy override a normalized non-matching intent", () => {
    expect(
      isSpecialistEnabledForContext(
        {
          enabledRoutes: ["image"],
          handoffPolicy: () => true,
        },
        agentContext({
          normalizedInput: {
            rawPrompt: "帮我分析这个视觉需求",
            userGoal: "帮我分析这个视觉需求",
            operation: "analyze",
            artifact: null,
            domain: "visual-design",
            requiredCapabilities: [],
            negativeCapabilities: ["image-generation"],
          },
        })
      )
    ).toBe(false);
  });

  it("uses fallback policy only before normalized intent exists", () => {
    expect(
      isSpecialistEnabledForContext(
        {
          enabledRoutes: ["image"],
          handoffPolicy: () => true,
        },
        agentContext()
      )
    ).toBe(true);
  });

  it("enables the web specialist from normalized web intent", () => {
    expect(
      isSpecialistEnabledForContext(
        {
          enabledRoutes: ["web"],
          handoffPolicy: () => false,
        },
        agentContext({
          normalizedInput: {
            rawPrompt: "读取 https://example.com",
            userGoal: "读取 https://example.com",
            operation: "create",
            artifact: { kind: "webpage", format: "html" },
            domain: "general",
            requiredCapabilities: ["web-fetch"],
            negativeCapabilities: [],
          },
        })
      )
    ).toBe(true);
  });

  it("enables the research specialist from normalized research intent", () => {
    expect(
      isSpecialistEnabledForContext(
        {
          enabledRoutes: ["research"],
          handoffPolicy: () => false,
        },
        agentContext({
          normalizedInput: {
            rawPrompt: "调研 https://example.com 并引用来源",
            userGoal: "调研 https://example.com 并引用来源",
            operation: "answer",
            artifact: null,
            domain: "general",
            requiredCapabilities: ["source-based-answer", "citations"],
            negativeCapabilities: [],
          },
        })
      )
    ).toBe(true);
  });

  it("enables document and web handoffs for a composite webpage-to-document task", () => {
    const context = agentContext({
      normalizedInput: {
        rawPrompt: "把这个页面总结成文档",
        userGoal: "把这个页面总结成文档",
        operation: "transform",
        artifact: { kind: "document", format: "markdown" },
        domain: "general",
        requiredCapabilities: ["web-fetch", "markdown-artifact"],
        negativeCapabilities: [],
      },
    });

    expect(
      isSpecialistEnabledForContext(
        { enabledRoutes: ["web"], handoffPolicy: () => false },
        context
      )
    ).toBe(true);
    expect(
      isSpecialistEnabledForContext(
        { enabledRoutes: ["document"], handoffPolicy: () => false },
        context
      )
    ).toBe(true);
    expect(
      isSpecialistEnabledForContext(
        { enabledRoutes: ["image"], handoffPolicy: () => false },
        context
      )
    ).toBe(false);
  });
});

function agentContext(
  overrides: Partial<CucumberAgentContext> = {}
): CucumberAgentContext {
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
