import { z } from "zod";
import { tavilySearch } from "@tavily/ai-sdk";

import type { ArtifactRef, UpstreamContextItem } from "../../../src/types/canvas.ts";
import type { RuntimeToolDefinition } from "../tool-registry.ts";
import { runtimeErrorCodes, throwAgentError } from "../errors.ts";
import { toolResultSchema } from "../schemas.ts";
import { TOOL_DEFINITION_VERSION, toolIds } from "./ids.ts";

const noRetry = { maxRetries: 0, backoffMs: 0, retryableErrorCodes: [] };

const readWebpageInputSchema = z.object({
  urls: z.array(z.string().url()).max(5).optional(),
});

const searchWebInputSchema = z.object({
  query: z.string().min(1).max(500),
  searchDepth: z
    .enum(["basic", "advanced", "fast", "ultra-fast"])
    .optional(),
  timeRange: z
    .enum(["year", "month", "week", "day", "y", "m", "w", "d"])
    .optional(),
  exactMatch: z.boolean().optional(),
});

const analyzeAssetsInputSchema = z.object({
  imageContext: z.array(
    z.object({
      nodeId: z.string(),
      imageUrl: z.string().optional(),
      title: z.string().optional(),
      summary: z.string().optional(),
    })
  ).optional(),
});

const generateHtmlInputSchema = z.object({
  title: z.string().min(1).max(120).describe("Page title"),
  html: z.string().min(1).describe("Complete standalone HTML document"),
  summary: z.string().min(1).max(500).describe("Short summary of what was generated"),
});

const searchWebOutputSchema = z.object({
  answer: z.string().optional(),
  query: z.string(),
  responseTime: z.number().optional(),
  requestId: z.string().optional(),
  sources: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      content: z.string(),
      score: z.number().optional(),
      publishedDate: z.string().optional(),
    })
  ),
});

export function createReadWebpageTool(): RuntimeToolDefinition {
  return {
    id: toolIds.readWebpage,
    version: TOOL_DEFINITION_VERSION,
    toPlannerToolName: "web.read",
    capabilityId: "web.research",
    name: "Read webpage",
    description: "Fetch and summarize user-provided webpage URLs.",
    inputSchema: readWebpageInputSchema,
    outputSchema: z.object({
      sources: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          excerpt: z.string(),
        })
      ),
    }),
    policy: {
      canUseNetwork: true,
      canWriteFiles: false,
      canModifyProject: false,
      requiresApproval: false,
      mayExternalCost: false,
    },
    timeoutMs: 10_000,
    retryPolicy: { maxRetries: 1, backoffMs: 500, retryableErrorCodes: [runtimeErrorCodes.TOOL_TIMEOUT] },
    risk: "low",
    renderHint: { kind: "text", label: "Read webpage" },
    prepareInput({ context }) {
      return {
        urls: context.selectedItems
          .flatMap((item) => [item.contentRef, item.artifact?.uri])
          .filter(isHttpUrl)
          .slice(0, 5),
      };
    },
    async execute(input) {
      const parsed = readWebpageInputSchema.parse(input);
      if (!parsed.urls?.length) {
        throwAgentError({
          code: runtimeErrorCodes.CAPABILITY_UNAVAILABLE,
          message: "No webpage URL was provided for web.read.",
          retryable: false,
          severity: "error",
          toolId: toolIds.readWebpage,
        });
      }

      const sources = await Promise.all(
        parsed.urls.map(async (url) => {
          const response = await fetch(url);
          if (!response.ok) {
            throwAgentError({
              code: runtimeErrorCodes.TOOL_ERROR,
              message: `Failed to read ${url}: HTTP ${response.status}.`,
              retryable: false,
              severity: "error",
              toolId: toolIds.readWebpage,
            });
          }
          const html = await response.text();
          return {
            title: readTitle(html) ?? url,
            url,
            excerpt: stripHtml(html).slice(0, 2_000),
          };
        })
      );

      return toolResultSchema.parse({
        ok: true,
        data: { sources },
        artifacts: sources.map((source) => ({
          id: `web-${stableId(source.url)}`,
          type: "webpage",
          uri: source.url,
          title: source.title,
          metadata: { excerpt: source.excerpt },
        })),
        canvasOperations: [],
        logs: [toolLog(`Read ${sources.length} webpage source(s).`)],
      });
    },
  };
}

export function createSearchWebTool(): RuntimeToolDefinition {
  return {
    id: toolIds.searchWeb,
    version: TOOL_DEFINITION_VERSION,
    toPlannerToolName: "web_search",
    capabilityId: "web.research",
    name: "Search web",
    description:
      "Search the web with Tavily for current information, citations, news, articles, and research sources.",
    inputSchema: searchWebInputSchema,
    outputSchema: searchWebOutputSchema,
    policy: {
      canUseNetwork: true,
      canWriteFiles: false,
      canModifyProject: false,
      requiresApproval: false,
      mayExternalCost: true,
    },
    timeoutMs: 20_000,
    retryPolicy: {
      maxRetries: 1,
      backoffMs: 500,
      retryableErrorCodes: [runtimeErrorCodes.TOOL_TIMEOUT],
    },
    risk: "low",
    renderHint: { kind: "text", label: "Search web" },
    prepareInput({ context }) {
      return {
        query:
          context.promptParts.find((part) => part.id === "runtime.user-message")
            ?.content ?? context.taskContext,
        searchDepth: "fast",
      };
    },
    async execute(input) {
      const parsed = searchWebInputSchema.parse(input);
      const tool = tavilySearch({
        includeAnswer: "basic",
        includeRawContent: "markdown",
        maxResults: 5,
        searchDepth: "fast",
      });
      const result = await executeTavilySearch(tool, parsed);
      const sources = readTavilySources(result);

      return toolResultSchema.parse({
        ok: true,
        data: searchWebOutputSchema.parse({
          answer: readStringFromRecord(result, "answer") || undefined,
          query: readStringFromRecord(result, "query") || parsed.query,
          requestId: readStringFromRecord(result, "requestId") || undefined,
          responseTime: readNumberFromRecord(result, "responseTime"),
          sources,
        }),
        artifacts: [],
        canvasOperations: [],
        logs: [toolLog(`Searched Tavily and found ${sources.length} source(s).`)],
      });
    },
  };
}

export function createAnalyzeAssetsTool(): RuntimeToolDefinition {
  return {
    id: toolIds.analyzeAssets,
    version: TOOL_DEFINITION_VERSION,
    toPlannerToolName: "asset.analyze_context",
    capabilityId: "asset.analyze",
    name: "Analyze canvas assets",
    description: "Summarize selected image and artifact context for downstream generation.",
    inputSchema: analyzeAssetsInputSchema,
    outputSchema: z.object({
      imageCount: z.number(),
      summary: z.string(),
    }),
    policy: {
      canUseNetwork: false,
      canWriteFiles: false,
      canModifyProject: false,
      requiresApproval: false,
      mayExternalCost: false,
    },
    timeoutMs: 5_000,
    retryPolicy: noRetry,
    risk: "low",
    renderHint: { kind: "text", label: "Analyze assets" },
    prepareInput({ context }) {
      return {
        imageContext: context.selectedItems
          .filter((item) => item.type === "image" || item.artifact?.type === "image")
          .map(readImageContext),
      };
    },
    async execute(input) {
      const parsed = analyzeAssetsInputSchema.parse(input);
      const imageContext = parsed.imageContext ?? [];
      const summary = imageContext.length
        ? imageContext
            .map((item) => item.summary ?? item.title ?? item.imageUrl ?? item.nodeId)
            .join("\n")
        : "No image assets were selected.";

      return toolResultSchema.parse({
        ok: true,
        data: {
          imageCount: imageContext.length,
          summary,
        },
        artifacts: [],
        canvasOperations: [],
        logs: [toolLog(`Analyzed ${imageContext.length} image asset(s).`)],
      });
    },
  };
}

export function createGenerateHtmlTool(): RuntimeToolDefinition {
  return {
    id: toolIds.generateHtml,
    version: TOOL_DEFINITION_VERSION,
    toPlannerToolName: "generate_html",
    capabilityId: "html.generate",
    name: "Generate HTML artifact",
    description:
      "Generate a complete standalone HTML page. Use this when the user asks for a page, component, landing page, website, or HTML.",
    inputSchema: generateHtmlInputSchema,
    outputSchema: z.object({
      artifactId: z.string(),
      type: z.literal("html_artifact"),
      html: z.string(),
      title: z.string(),
      summary: z.string(),
    }),
    policy: {
      canUseNetwork: false,
      canWriteFiles: false,
      canModifyProject: false,
      requiresApproval: false,
      mayExternalCost: false,
    },
    timeoutMs: 5_000,
    retryPolicy: noRetry,
    risk: "low",
    renderHint: { kind: "artifact", label: "Generate HTML" },
    async execute(input) {
      const parsed = generateHtmlInputSchema.parse(input);
      assertStandaloneHtml(parsed.html, toolIds.generateHtml);
      const artifactId = `html-${stableId(`${parsed.title}:${parsed.html}`)}`;
      const artifact: ArtifactRef = {
        id: artifactId,
        type: "webpage",
        title: parsed.title,
        contentRef: `data:text/html;charset=utf-8,${encodeURIComponent(parsed.html)}`,
        metadata: {
          format: "html",
          mimeType: "text/html",
          html: parsed.html,
          generatedBy: "generate_html",
          summary: parsed.summary,
        },
      };

      return toolResultSchema.parse({
        ok: true,
        data: {
          artifactId,
          type: "html_artifact",
          html: parsed.html,
          title: parsed.title,
          summary: parsed.summary,
        },
        artifacts: [artifact],
        canvasOperations: [],
        logs: [toolLog("Generated HTML webpage artifact.")],
      });
    },
  };
}

async function executeTavilySearch(
  tool: ReturnType<typeof tavilySearch>,
  input: z.infer<typeof searchWebInputSchema>
) {
  if (!tool.execute) {
    throwAgentError({
      code: runtimeErrorCodes.TOOL_ERROR,
      message: "Tavily search tool does not expose an execute function.",
      retryable: false,
      severity: "error",
      toolId: toolIds.searchWeb,
    });
  }

  try {
    return await tool.execute(input, {
      abortSignal: undefined,
      messages: [],
      toolCallId: `web_search-${stableId(input.query)}`,
    } as never);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throwAgentError({
      code: /TAVILY_API_KEY|api key/i.test(message)
        ? runtimeErrorCodes.ENV_MISSING
        : runtimeErrorCodes.TOOL_ERROR,
      message,
      retryable: false,
      severity: "error",
      toolId: toolIds.searchWeb,
    });
  }
}

function readTavilySources(value: unknown) {
  const results =
    value && typeof value === "object" && Array.isArray((value as { results?: unknown }).results)
      ? (value as { results: unknown[] }).results
      : [];

  return results.flatMap((source) => {
    if (!source || typeof source !== "object") {
      return [];
    }

    const candidate = source as Record<string, unknown>;
    const url = readStringFromRecord(candidate, "url");
    if (!isHttpUrl(url)) {
      return [];
    }

    return [
      {
        title: readStringFromRecord(candidate, "title") || url,
        url,
        content:
          readStringFromRecord(candidate, "rawContent") ||
          readStringFromRecord(candidate, "content") ||
          "",
        score: readNumberFromRecord(candidate, "score"),
        publishedDate:
          readStringFromRecord(candidate, "publishedDate") || undefined,
      },
    ];
  });
}

function readImageContext(item: UpstreamContextItem) {
  return {
    nodeId: item.nodeId,
    imageUrl: item.imageUrl ?? item.artifact?.uri,
    title: item.title ?? item.artifact?.title,
    summary: item.summary,
  };
}

function readStringFromRecord(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return "";
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : "";
}

function readNumberFromRecord(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" ? candidate : undefined;
}

function assertStandaloneHtml(html: string, toolId: string) {
  const checks = [
    [/<!doctype\s+html/i, "HTML must include <!doctype html>."],
    [/<html[\s>]/i, "HTML must include an <html> root element."],
    [/<head[\s>]/i, "HTML must include a <head> element."],
    [/<body[\s>]/i, "HTML must include a <body> element."],
    [/<style[\s>]/i, "CSS must be written inline in a <style> tag."],
  ] as const;

  const missing = checks
    .filter(([pattern]) => !pattern.test(html))
    .map(([, message]) => message);
  const hasExternalDependency =
    /<script\b[^>]*\bsrc\s*=/i.test(html) ||
    /<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/i.test(html) ||
    /@import\s+url/i.test(html);

  if (missing.length || hasExternalDependency) {
    throwAgentError({
      code: runtimeErrorCodes.TOOL_ERROR,
      message: [
        ...missing,
        hasExternalDependency
          ? "HTML must not use external scripts, stylesheets, or CSS imports."
          : "",
      ].filter(Boolean).join(" "),
      retryable: true,
      severity: "error",
      toolId,
    });
  }
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function readTitle(html: string) {
  return html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.trim();
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function toolLog(message: string) {
  return { level: "info" as const, message, createdAt: new Date().toISOString() };
}
