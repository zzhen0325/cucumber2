import { z } from "zod";

import {
  generateTextWithProvider,
  type ModelProviderId,
} from "../../model-providers.ts";
import { renderRuntimePromptAssembly } from "../../prompts.ts";
import type { ArtifactRef } from "../../../src/types/canvas.ts";
import type { AgentStep, BuiltContext } from "../../../src/types/runtime.ts";
import type { RuntimeToolDefinition } from "../tool-registry.ts";
import { toolResultSchema } from "../schemas.ts";
import { TOOL_DEFINITION_VERSION, toolIds } from "./ids.ts";

const noRetry = { maxRetries: 0, backoffMs: 0, retryableErrorCodes: [] };

const documentInputSchema = z.object({
  brief: z.string().min(1),
  contextPrompt: z.string().min(1),
  modelProvider: z.enum(["deepseek", "ark"]),
  promptTrace: z.record(z.string(), z.unknown()).optional(),
});

const documentOutputSchema = z.object({
  artifactId: z.string(),
  title: z.string(),
  markdown: z.string(),
  summary: z.string(),
  promptTrace: z.record(z.string(), z.unknown()).optional(),
});

const documentWriterSystemPrompt = [
  "You are Cucumber's document writer tool for an infinite canvas agent runtime.",
  "Return a concrete Markdown document artifact, not a chat reply.",
  "Write in the user's language unless the user asks otherwise.",
  "For analysis, comparison, strategy, summaries, reports, or general questions, produce a useful structured document.",
  "If the request asks for an action that was not actually performed, such as browsing the web, editing code, reading an unavailable file, or generating an image, do not pretend it happened. Write an honest document with current limitations, required inputs, and next steps.",
  "Do not include fenced code around the full Markdown document.",
].join("\n");

export function createDocumentWriteTool({
  modelProvider,
}: {
  modelProvider: ModelProviderId;
}): RuntimeToolDefinition {
  return {
    id: toolIds.writeDocument,
    version: TOOL_DEFINITION_VERSION,
    toPlannerToolName: "write_document",
    capabilityId: "document.write",
    name: "Write Markdown document",
    description:
      "Create a Markdown document artifact for analysis, summaries, reports, plans, answers, and capability gap reports.",
    inputSchema: documentInputSchema,
    outputSchema: documentOutputSchema,
    policy: {
      canUseNetwork: true,
      canWriteFiles: false,
      canModifyProject: false,
      requiresApproval: false,
      mayExternalCost: true,
    },
    timeoutMs: 60_000,
    retryPolicy: noRetry,
    risk: "low",
    renderHint: { kind: "artifact", label: "Write document" },
    prepareInput({ context, previousSteps }) {
      const assembly = buildDocumentPromptAssembly(context, previousSteps);
      return {
        brief:
          context.promptParts.find((part) => part.id === "runtime.user-message")
            ?.content ?? context.taskContext,
        contextPrompt: assembly.prompt,
        modelProvider,
        promptTrace: assembly.trace,
      };
    },
    async execute(input, toolContext) {
      const parsed = documentInputSchema.parse(input);
      const markdown = normalizeMarkdown(
        await generateTextWithProvider(parsed.modelProvider, {
          system: documentWriterSystemPrompt,
          prompt: parsed.contextPrompt,
          maxOutputTokens: 2_400,
        })
      );
      if (!markdown) {
        throw new Error("document.write returned an empty Markdown document.");
      }

      const title = inferMarkdownTitle(markdown) ?? inferDocumentTitle(parsed.brief);
      const summary = summarizeMarkdown(markdown);
      const artifactId = `doc-${toolContext.run.input.metadata.runNodeId}-${stableId(
        `${title}:${markdown}`
      )}`;
      const artifact: ArtifactRef = {
        id: artifactId,
        type: "doc",
        title,
        contentRef: `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`,
        metadata: {
          content: markdown,
          format: "markdown",
          markdown,
          mimeType: "text/markdown",
          modelProvider: parsed.modelProvider,
          promptTrace: parsed.promptTrace,
          summary,
        },
      };

      return toolResultSchema.parse({
        ok: true,
        data: {
          artifactId,
          markdown,
          promptTrace: parsed.promptTrace,
          summary,
          title,
        },
        artifacts: [artifact],
        canvasOperations: [],
        logs: [toolLog("Generated Markdown document artifact.")],
      });
    },
  };
}

function buildDocumentPromptAssembly(
  context: BuiltContext,
  previousSteps: AgentStep[]
) {
  return renderRuntimePromptAssembly([
    ...context.promptParts,
    {
      id: "document-writer.tool-results",
      category: "tool_result",
      content: formatPreviousToolResults(previousSteps),
      tokenEstimate: 320,
    },
    {
      id: "document-writer.instruction",
      category: "instruction",
      content: [
        "Create a self-contained Markdown document for the current routed task.",
        "Make the document suitable as a canvas artifact that can be selected for follow-up work.",
        "Prefer useful headings and concise bullets over conversational filler.",
        "When web search results are available, ground claims in those sources and include source links.",
        "If the available tools/context are insufficient for the requested action, document what is missing and what can be concluded from current context.",
      ].join("\n"),
      tokenEstimate: 80,
    },
  ]);
}

function formatPreviousToolResults(previousSteps: AgentStep[]) {
  const searchOutputs = previousSteps
    .filter((step) => step.planStepId === "search_web")
    .flatMap((step) => formatSearchOutput(step.output?.data));

  return searchOutputs.length ? searchOutputs.join("\n\n") : "No previous tool results.";
}

function formatSearchOutput(data: unknown) {
  if (!data || typeof data !== "object") {
    return [];
  }
  const candidate = data as {
    answer?: unknown;
    query?: unknown;
    sources?: unknown;
  };
  const sources = Array.isArray(candidate.sources) ? candidate.sources : [];
  const lines = [
    "Tavily web search result",
    typeof candidate.query === "string" ? `query: ${candidate.query}` : "",
    typeof candidate.answer === "string" && candidate.answer.trim()
      ? `answer: ${candidate.answer.trim()}`
      : "",
    "sources:",
    ...sources.flatMap((source, index) => formatSearchSource(source, index)),
  ].filter(Boolean);

  return [lines.join("\n")];
}

function formatSearchSource(source: unknown, index: number) {
  if (!source || typeof source !== "object") {
    return [];
  }
  const candidate = source as Record<string, unknown>;
  const title = readString(candidate.title) || "Untitled source";
  const url = readString(candidate.url);
  const content = readString(candidate.content);
  if (!url) {
    return [];
  }

  return [
    `${index + 1}. ${title}`,
    `url: ${url}`,
    content ? `excerpt: ${content.slice(0, 900)}` : "",
  ].filter(Boolean);
}

function normalizeMarkdown(markdown: string) {
  return markdown
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function inferDocumentTitle(brief: string) {
  const compact = brief.replace(/\s+/g, " ").trim();
  return compact.length > 32 ? `${compact.slice(0, 32)}...` : compact || "Document";
}

function inferMarkdownTitle(markdown: string) {
  const heading = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#\s+\S/.test(line));
  return heading?.replace(/^#\s+/, "").trim() || undefined;
}

function summarizeMarkdown(markdown: string) {
  return markdown
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
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
