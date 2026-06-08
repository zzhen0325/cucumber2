import { z } from "zod";

import type { ArtifactRef, UpstreamContextItem } from "../../../src/types/canvas.ts";
import type { RuntimeToolDefinition } from "../tool-registry.ts";
import { runtimeErrorCodes, throwAgentError } from "../errors.ts";
import { toolResultSchema } from "../schemas.ts";
import { TOOL_DEFINITION_VERSION, toolIds } from "./ids.ts";

const noRetry = { maxRetries: 0, backoffMs: 0, retryableErrorCodes: [] };

const readWebpageInputSchema = z.object({
  urls: z.array(z.string().url()).max(5).optional(),
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

const generatePageInputSchema = z.object({
  brief: z.string().min(1),
  sourceUrls: z.array(z.string().url()).optional(),
  assetSummary: z.string().optional(),
  title: z.string().min(1).optional(),
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

export function createGeneratePageTool(): RuntimeToolDefinition {
  return {
    id: toolIds.generatePage,
    version: TOOL_DEFINITION_VERSION,
    toPlannerToolName: "page.generate",
    capabilityId: "page.generate",
    name: "Generate page artifact",
    description: "Create a lightweight HTML webpage artifact from the task brief and gathered context.",
    inputSchema: generatePageInputSchema,
    outputSchema: z.object({
      artifactId: z.string(),
      html: z.string(),
      title: z.string(),
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
    renderHint: { kind: "artifact", label: "Generate page" },
    prepareInput({ context, previousSteps }) {
      const webSources = previousSteps.flatMap((step) =>
        readSources(step.output?.data)
      );
      const assetSummary = previousSteps
        .map((step) => readStringFromRecord(step.output?.data, "summary"))
        .find((summary) => summary.length > 0);
      const brief =
        context.promptParts.find((part) => part.id === "runtime.user-message")
          ?.content ?? context.taskContext;

      return {
        brief,
        sourceUrls: webSources.map((source) => source.url),
        assetSummary,
        title: inferPageTitle(brief),
      };
    },
    async execute(input) {
      const parsed = generatePageInputSchema.parse(input);
      const title = parsed.title ?? inferPageTitle(parsed.brief);
      const html = renderLandingPageHtml({
        assetSummary: parsed.assetSummary,
        brief: parsed.brief,
        sourceUrls: parsed.sourceUrls ?? [],
        title,
      });
      const artifactId = `page-${stableId(`${title}:${parsed.brief}`)}`;
      const artifact: ArtifactRef = {
        id: artifactId,
        type: "webpage",
        title,
        contentRef: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
        metadata: {
          format: "html",
          mimeType: "text/html",
          sourceUrls: parsed.sourceUrls ?? [],
          summary: parsed.brief.slice(0, 220),
        },
      };

      return toolResultSchema.parse({
        ok: true,
        data: { artifactId, html, title },
        artifacts: [artifact],
        canvasOperations: [],
        logs: [toolLog("Generated webpage artifact.")],
      });
    },
  };
}

function readImageContext(item: UpstreamContextItem) {
  return {
    nodeId: item.nodeId,
    imageUrl: item.imageUrl ?? item.artifact?.uri,
    title: item.title ?? item.artifact?.title,
    summary: item.summary,
  };
}

function readSources(value: unknown) {
  if (!value || typeof value !== "object" || !Array.isArray((value as { sources?: unknown }).sources)) {
    return [];
  }

  return (value as { sources: unknown[] }).sources.flatMap((source) => {
    if (!source || typeof source !== "object") {
      return [];
    }
    const candidate = source as { url?: unknown; title?: unknown };
    return typeof candidate.url === "string"
      ? [{ url: candidate.url, title: String(candidate.title ?? candidate.url) }]
      : [];
  });
}

function readStringFromRecord(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return "";
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : "";
}

function renderLandingPageHtml({
  assetSummary,
  brief,
  sourceUrls,
  title,
}: {
  assetSummary?: string;
  brief: string;
  sourceUrls: string[];
  title: string;
}) {
  const sources = sourceUrls.length
    ? sourceUrls.map((url) => `<li><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></li>`).join("")
    : "<li>No external source URL was provided.</li>";

  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(title)}</title>`,
    "<style>body{font-family:Inter,system-ui,sans-serif;margin:0;color:#20201d;background:#faf8f1}main{max-width:960px;margin:auto;padding:48px 24px}section{margin-top:32px}h1{font-size:44px;line-height:1.08;margin:0 0 16px}p,li{font-size:17px;line-height:1.7}.panel{border:1px solid #ded8c7;background:#fffdf7;border-radius:8px;padding:24px}</style>",
    "</head>",
    "<body>",
    "<main>",
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>${escapeHtml(brief)}</p>`,
    '<section class="panel">',
    "<h2>视觉与素材方向</h2>",
    `<p>${escapeHtml(assetSummary ?? "Use the selected canvas context as the primary visual reference.")}</p>`,
    "</section>",
    '<section class="panel">',
    "<h2>参考来源</h2>",
    `<ul>${sources}</ul>`,
    "</section>",
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

function inferPageTitle(brief: string) {
  const compact = brief.replace(/\s+/g, " ").trim();
  return compact.length > 28 ? `${compact.slice(0, 28)}...` : compact || "Landing Page";
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toolLog(message: string) {
  return { level: "info" as const, message, createdAt: new Date().toISOString() };
}
