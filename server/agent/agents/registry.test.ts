import { describe, expect, it } from "vitest";

import { listAgentCapabilityRoutes } from "../agent-capability-manifest.ts";
import type { CucumberAgentContext } from "../context.ts";
import { makeTaskFrame } from "../test-task-frame.ts";
import {
  createSpecialistAgentRegistry,
  isSpecialistEnabledForContext,
} from "./registry.ts";

describe("specialist agent registry", () => {
  it("keeps specialist registry metadata aligned with the capability manifest", () => {
    const registry = createSpecialistAgentRegistry();
    const manifestRoutes = listAgentCapabilityRoutes().filter(
      (route) => route.route !== "manager"
    );

    for (const manifestRoute of manifestRoutes) {
      const specialist = registry.find((definition) =>
        definition.enabledRoutes.includes(manifestRoute.route)
      );
      expect(specialist).toMatchObject({
        name: manifestRoute.agentName,
        producedArtifactTypes: manifestRoute.producedArtifactTypes,
        requiredTools: manifestRoute.requiredTools,
      });
    }
  });

  it("enables the document specialist from document routing", () => {
    expect(
      isSpecialistEnabledForContext(
        {
          enabledRoutes: ["document"],
          handoffPolicy: () => false,
        },
        agentContext({
          normalizedInput: makeTaskFrame({
            rawInput: "写一份 PRD",
            domain: "text",
            intent: "document.create",
            action: "create",
            primaryAgent: "document_agent",
          }),
        })
      )
    ).toBe(true);
  });

  it("keeps a specialist disabled when routing does not match", () => {
    expect(
      isSpecialistEnabledForContext(
        {
          enabledRoutes: ["document"],
          handoffPolicy: () => false,
        },
        agentContext({
          normalizedInput: makeTaskFrame({
            rawInput: "解释一下这个概念",
            domain: "text",
            intent: "text.answer",
            action: "analyze",
            primaryAgent: "manager_agent",
          }),
        })
      )
    ).toBe(false);
  });

  it("does not let fallback policy override routing", () => {
    expect(
      isSpecialistEnabledForContext(
        {
          enabledRoutes: ["image"],
          handoffPolicy: () => true,
        },
        agentContext({
          normalizedInput: makeTaskFrame({
            rawInput: "帮我分析这个视觉需求",
            domain: "text",
            intent: "text.answer",
            action: "analyze",
            primaryAgent: "manager_agent",
          }),
        })
      )
    ).toBe(false);
  });

  it("uses fallback policy only before routing exists", () => {
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

  it("enables the web specialist from web routing", () => {
    expect(
      isSpecialistEnabledForContext(
        {
          enabledRoutes: ["web"],
          handoffPolicy: () => false,
        },
        agentContext({
          normalizedInput: makeTaskFrame({
            rawInput: "读取 https://example.com",
            domain: "text",
            intent: "web.fetch",
            action: "create",
            primaryAgent: "web_agent",
          }),
        })
      )
    ).toBe(true);
  });

  it("routes generated webpage artifacts to the document specialist via routing", () => {
    const context = agentContext({
      normalizedInput: makeTaskFrame({
        rawInput: "做个 30 秒 HTML 动画",
        domain: "text",
        intent: "webpage.create",
        action: "create",
        primaryAgent: "document_agent",
      }),
    });

    expect(
      isSpecialistEnabledForContext(
        { enabledRoutes: ["document"], handoffPolicy: () => false },
        context
      )
    ).toBe(true);
    expect(
      isSpecialistEnabledForContext(
        { enabledRoutes: ["web"], handoffPolicy: () => false },
        context
      )
    ).toBe(false);
  });

  it("enables the research specialist from research routing", () => {
    expect(
      isSpecialistEnabledForContext(
        {
          enabledRoutes: ["research"],
          handoffPolicy: () => false,
        },
        agentContext({
          normalizedInput: makeTaskFrame({
            rawInput: "调研 https://example.com 并引用来源",
            domain: "text",
            intent: "research.answer",
            action: "analyze",
            primaryAgent: "research_agent",
          }),
        })
      )
    ).toBe(true);
  });

  it("enables document and web handoffs for a composite webpage-to-document task", () => {
    const context = agentContext({
      normalizedInput: makeTaskFrame({
        rawInput: "把这个页面总结成文档",
        domain: "text",
        intent: "web.fetch",
        action: "transform",
        primaryAgent: "web_agent",
        candidateAgents: ["document_agent"],
      }),
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

  it("enables specialists from hybrid workflow required agents and stages", () => {
    const context = agentContext({
      normalizedInput: makeTaskFrame({
        rawInput: "分析这张图，生成海报和 HTML 代码",
        domain: "mixed",
        intent: "hybrid.visual.code.create",
        action: "create",
        primaryAgent: "manager_agent",
        workflow: {
          mode: "hybrid",
          outputArtifacts: ["image", "code"],
          requiredAgents: ["image_agent", "document_agent"],
          requiredCapabilities: ["media-analysis", "image-generation", "code-artifact"],
          stages: [
            {
              id: "generate-image",
              goal: "生成海报",
              action: "create",
              agent: "image_agent",
              outputArtifacts: ["image"],
            },
            {
              id: "create-code",
              goal: "生成 HTML 代码",
              action: "create",
              agent: "document_agent",
              outputArtifacts: ["code"],
              dependsOn: ["generate-image"],
            },
          ],
        },
      }),
    });

    expect(
      isSpecialistEnabledForContext(
        { enabledRoutes: ["image"], handoffPolicy: () => false },
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
        { enabledRoutes: ["web"], handoffPolicy: () => false },
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
