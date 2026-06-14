import { describe, expect, it } from "vitest";

import type { CucumberAgentContext } from "../context.ts";
import { isSpecialistEnabledForContext } from "./registry.ts";

describe("specialist agent registry", () => {
  it("enables the document specialist from normalized document intents", () => {
    expect(
      isSpecialistEnabledForContext(
        {
          enabledIntents: ["document.create", "document.edit"],
          handoffPolicy: () => false,
        },
        agentContext({
          normalizedInput: {
            rawPrompt: "写一份 PRD",
            intent: "document.create",
          },
        })
      )
    ).toBe(true);
  });

  it("keeps a specialist disabled when neither intent nor policy matches", () => {
    expect(
      isSpecialistEnabledForContext(
        {
          enabledIntents: ["document.create", "document.edit"],
          handoffPolicy: () => false,
        },
        agentContext({
          normalizedInput: {
            rawPrompt: "解释一下这个概念",
            intent: "text.answer",
          },
        })
      )
    ).toBe(false);
  });

  it("enables the web specialist from normalized web intent", () => {
    expect(
      isSpecialistEnabledForContext(
        {
          enabledIntents: ["web.fetch"],
          handoffPolicy: () => false,
        },
        agentContext({
          normalizedInput: {
            rawPrompt: "读取 https://example.com",
            intent: "web.fetch",
          },
        })
      )
    ).toBe(true);
  });

  it("enables the research specialist from normalized research intent", () => {
    expect(
      isSpecialistEnabledForContext(
        {
          enabledIntents: ["research.answer"],
          handoffPolicy: () => false,
        },
        agentContext({
          normalizedInput: {
            rawPrompt: "调研 https://example.com 并引用来源",
            intent: "research.answer",
          },
        })
      )
    ).toBe(true);
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
