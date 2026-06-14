import { RunContext } from "@openai/agents";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CucumberAgentContext } from "../../context.ts";
import { publicWebFetchTestHooks } from "../web/public-web-fetch.ts";

const mocks = vi.hoisted(() => ({
  storeTextArtifactContent: vi.fn(),
}));

vi.mock("../../../storage.ts", () => ({
  storeTextArtifactContent: mocks.storeTextArtifactContent,
}));

const { collectResearchSourcesTool } = await import(
  "./collect-research-sources.tool.ts"
);
const { createResearchArtifactTool } = await import(
  "./create-research-artifact.tool.ts"
);

describe("research tools", () => {
  beforeEach(() => {
    mocks.storeTextArtifactContent.mockReset();
    publicWebFetchTestHooks.lookup = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
    ]);
    publicWebFetchTestHooks.fetch = vi.fn(async (url: URL) =>
      new Response(
        `<html><head><title>${url.hostname}</title></head><body><h1>Source</h1><p>Evidence from ${url.hostname}.</p></body></html>`,
        {
          headers: { "content-type": "text/html" },
          status: 200,
        }
      )
    );
  });

  it("collects readable excerpts from explicit public sources", async () => {
    const raw = await collectResearchSourcesTool.invoke(
      new RunContext(agentContext()),
      JSON.stringify({
        question: "What does the source say?",
        sources: [{ url: "https://example.com/article" }],
      })
    );
    const output = typeof raw === "string" ? JSON.parse(raw) : raw;

    expect(output).toMatchObject({
      question: "What does the source say?",
      sources: [
        {
          excerpt: expect.stringContaining("Evidence from example.com."),
          finalUrl: "https://example.com/article",
          index: 1,
          title: "example.com",
        },
      ],
    });
  });

  it("creates a research artifact with citation metadata", async () => {
    mocks.storeTextArtifactContent.mockResolvedValue({
      contentRef:
        "supabase://agent-assets/projects/project-1/runs/run-1/artifacts/research-1.md",
      id: "research-1",
      metadata: {
        citations: [{ title: "Example", url: "https://example.com" }],
        mimeType: "text/markdown",
        previewKind: "markdown",
        researchSourceCount: 1,
        sourceRunNodeId: "run-1",
        sourceToolName: "create_research_artifact",
      },
      title: "Research brief",
      type: "doc",
    });
    const context = agentContext();

    const raw = await createResearchArtifactTool.invoke(
      new RunContext(context),
      JSON.stringify({
        citations: [{ title: "Example", url: "https://example.com" }],
        content: "# Research brief\n\nConclusion [1].\n\n## Sources\n\n1. Example",
        title: "Research brief",
      })
    );
    const output = typeof raw === "string" ? JSON.parse(raw) : raw;

    expect(mocks.storeTextArtifactContent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          citations: [{ title: "Example", url: "https://example.com" }],
          researchSourceCount: 1,
        }),
        projectId: "project-1",
        runNodeId: "run-1",
        sourceToolName: "create_research_artifact",
        title: "Research brief",
        type: "doc",
        userId: "user-1",
      })
    );
    expect(output).toMatchObject({
      artifactId: "research-1",
      citationCount: 1,
      title: "Research brief",
    });
    expect(context.producedArtifacts).toHaveLength(1);
    expect(context.pendingEvents).toEqual([
      expect.objectContaining({
        artifact: expect.objectContaining({ id: "research-1" }),
        toolName: "create_research_artifact",
        type: "artifact_created",
      }),
    ]);
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
    prompt: "调研 https://example.com",
    runNodeId: "run-1",
    selectedNodeId: null,
    selectedNodeIds: [],
    skillCandidates: [],
    upstreamContext: [],
    userId: "user-1",
    ...overrides,
  };
}
