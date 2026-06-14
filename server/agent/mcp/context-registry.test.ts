import { describe, expect, it } from "vitest";

import type { CucumberAgentContext } from "../context.ts";
import {
  getMcpRunContext,
  registerMcpRunContext,
  unregisterMcpRunContext,
} from "./context-registry.ts";

describe("MCP run context registry", () => {
  it("registers and clears run-scoped Cucumber context", () => {
    const context = agentContext();
    const contextId = registerMcpRunContext(context);

    expect(context.mcpRunContextId).toBe(contextId);
    expect(getMcpRunContext(contextId)).toBe(context);

    unregisterMcpRunContext(contextId);

    expect(context.mcpRunContextId).toBeUndefined();
    expect(getMcpRunContext(contextId)).toBeUndefined();
  });
});

function agentContext(): CucumberAgentContext {
  return {
    userId: "user-1",
    projectId: "project-1",
    canvasId: "project-1",
    runNodeId: "run-1",
    canvasSnapshot: { nodes: [], edges: [] },
    selectedNodeIds: [],
    knownNodeIds: ["run-1"],
    producedArtifacts: [],
    pendingEvents: [],
    prompt: "生成图片",
    selectedNodeId: null,
    skillCandidates: [],
    upstreamContext: [],
  };
}
