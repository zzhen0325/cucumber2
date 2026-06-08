import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentRuntimeError, runtimeErrorCodes } from "../errors";
import { createSearchWebTool } from "./web-page-tools";
import { toolIds } from "./ids";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  tavilySearch: vi.fn(),
}));

vi.mock("@tavily/ai-sdk", () => ({
  tavilySearch: mocks.tavilySearch,
}));

describe("web page tools", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.tavilySearch.mockReset();
    mocks.tavilySearch.mockReturnValue({ execute: mocks.execute });
  });

  it("runs web.search through Tavily and normalizes sources", async () => {
    mocks.execute.mockResolvedValue({
      answer: "Tavily found recent AI SDK documentation.",
      query: "AI SDK tool calling",
      requestId: "request-1",
      responseTime: 1.25,
      results: [
        {
          title: "AI SDK Tools",
          url: "https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling",
          rawContent: "Tool calling documentation in markdown.",
          score: 0.91,
          publishedDate: "2026-06-01",
        },
        {
          title: "Invalid source",
          url: "not-a-url",
          content: "This should be ignored.",
        },
      ],
    });

    const tool = createSearchWebTool();
    const result = await tool.execute(
      {
        query: "AI SDK tool calling",
        searchDepth: "fast",
        exactMatch: true,
      },
      {} as never
    );

    expect(tool).toMatchObject({
      id: toolIds.searchWeb,
      toPlannerToolName: "web_search",
      capabilityId: "web.research",
      timeoutMs: 20_000,
      retryPolicy: {
        maxRetries: 1,
        retryableErrorCodes: [runtimeErrorCodes.TOOL_TIMEOUT],
      },
    });
    expect(mocks.tavilySearch).toHaveBeenCalledWith({
      includeAnswer: "basic",
      includeRawContent: "markdown",
      maxResults: 5,
      searchDepth: "fast",
    });
    expect(mocks.execute).toHaveBeenCalledWith(
      {
        query: "AI SDK tool calling",
        searchDepth: "fast",
        exactMatch: true,
      },
      expect.objectContaining({
        messages: [],
        toolCallId: expect.stringMatching(/^web_search-/),
      })
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        answer: "Tavily found recent AI SDK documentation.",
        query: "AI SDK tool calling",
        requestId: "request-1",
        responseTime: 1.25,
        sources: [
          {
            title: "AI SDK Tools",
            url: "https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling",
            content: "Tool calling documentation in markdown.",
            score: 0.91,
            publishedDate: "2026-06-01",
          },
        ],
      },
      artifacts: [],
      canvasOperations: [],
      logs: [
        {
          level: "info",
          message: "Searched Tavily and found 1 source(s).",
        },
      ],
    });
  });

  it("prepares web.search input with fast search depth by default", () => {
    const tool = createSearchWebTool();

    expect(
      tool.prepareInput?.({
        context: {
          promptParts: [
            {
              id: "runtime.user-message",
              content: "搜索 AI SDK 最新工具调用文档",
            },
          ],
          taskContext: "fallback query",
        } as never,
        previousSteps: [],
        step: {} as never,
      })
    ).toEqual({
      query: "搜索 AI SDK 最新工具调用文档",
      searchDepth: "fast",
    });
  });

  it("maps Tavily API key failures to ENV_MISSING", async () => {
    mocks.execute.mockRejectedValue(new Error("TAVILY_API_KEY is missing."));

    await expect(
      createSearchWebTool().execute({ query: "latest news" }, {} as never)
    ).rejects.toMatchObject({
      agentError: {
        code: runtimeErrorCodes.ENV_MISSING,
        toolId: toolIds.searchWeb,
        retryable: false,
      },
    });
  });

  it("fails when Tavily does not expose an execute function", async () => {
    mocks.tavilySearch.mockReturnValue({});

    await expect(
      createSearchWebTool().execute({ query: "latest news" }, {} as never)
    ).rejects.toBeInstanceOf(AgentRuntimeError);
  });
});
