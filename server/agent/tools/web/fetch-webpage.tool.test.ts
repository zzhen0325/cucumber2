import { RunContext } from "@openai/agents";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CucumberAgentContext } from "../../context.ts";

const mocks = vi.hoisted(() => ({
  storeTextArtifactContent: vi.fn(),
}));

vi.mock("../../../storage.ts", () => ({
  storeTextArtifactContent: mocks.storeTextArtifactContent,
}));

const { fetchWebpageTestHooks, fetchWebpageTool } = await import(
  "./fetch-webpage.tool.ts"
);

describe("fetch_webpage tool", () => {
  beforeEach(() => {
    mocks.storeTextArtifactContent.mockReset();
    fetchWebpageTestHooks.lookup = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
    ]);
    fetchWebpageTestHooks.fetch = vi.fn(async () =>
      new Response(
        "<html><head><title>Example Domain</title></head><body><h1>Hello</h1><script>ignore()</script><p>Readable text.</p></body></html>",
        {
          headers: { "content-type": "text/html; charset=utf-8" },
          status: 200,
        }
      )
    );
  });

  it("fetches a public webpage, stores a webpage artifact, and emits an artifact event", async () => {
    mocks.storeTextArtifactContent.mockResolvedValue({
      contentRef:
        "r2://agent-assets/projects/project-1/runs/run-1/artifacts/web-1.html",
      id: "web-1",
      metadata: {
        mimeType: "text/html",
        previewKind: "webpage",
        sourceRunNodeId: "run-1",
        sourceToolName: "fetch_webpage",
      },
      title: "Example Domain",
      type: "webpage",
    });
    const context = agentContext();

    const raw = await fetchWebpageTool.invoke(
      new RunContext(context),
      JSON.stringify({ url: "https://example.com" })
    );
    const output = typeof raw === "string" ? JSON.parse(raw) : raw;

    expect(mocks.storeTextArtifactContent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        runNodeId: "run-1",
        sourceToolName: "fetch_webpage",
        title: "Example Domain",
        type: "webpage",
        userId: "user-1",
      })
    );
    expect(output).toMatchObject({
      artifactId: "web-1",
      finalUrl: "https://example.com/",
      textPreview: expect.stringContaining("Readable text."),
      title: "Example Domain",
    });
    expect(output.textPreview).not.toContain("ignore()");
    expect(context.producedArtifacts).toHaveLength(1);
    expect(context.pendingEvents).toEqual([
      expect.objectContaining({
        artifact: expect.objectContaining({ id: "web-1" }),
        toolName: "fetch_webpage",
        type: "artifact_created",
      }),
    ]);
  });

  it("rejects private network URLs before fetching", async () => {
    const context = agentContext();

    await expect(
      fetchWebpageTool.invoke(
        new RunContext(context),
        JSON.stringify({ url: "http://127.0.0.1:8787/api/health" })
      )
    ).rejects.toThrow("Private network URLs cannot be fetched.");

    expect(fetchWebpageTestHooks.fetch).not.toHaveBeenCalled();
    expect(mocks.storeTextArtifactContent).not.toHaveBeenCalled();
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
    prompt: "读取 https://example.com",
    runNodeId: "run-1",
    selectedNodeId: null,
    selectedNodeIds: [],
    skillCandidates: [],
    upstreamContext: [],
    userId: "user-1",
    ...overrides,
  };
}
