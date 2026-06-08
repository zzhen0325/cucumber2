import { z } from "zod";

import type { ArtifactRef } from "../../../src/types/canvas.ts";
import type { RuntimeToolDefinition } from "../tool-registry.ts";
import { toolResultSchema } from "../schemas.ts";
import { TOOL_DEFINITION_VERSION, toolIds } from "./ids.ts";

const noRetry = { maxRetries: 0, backoffMs: 0, retryableErrorCodes: [] };

const documentInputSchema = z.object({
  title: z.string().min(1).max(120).describe("Document title"),
  markdown: z.string().min(1).describe("Complete Markdown document content"),
  summary: z
    .string()
    .min(1)
    .max(500)
    .describe("Short summary of what the Markdown document contains"),
  sourcesUsed: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().url(),
      })
    )
    .optional()
    .describe("Source links used to write the document, when applicable"),
});

const documentOutputSchema = z.object({
  artifactId: z.string(),
  title: z.string(),
  markdown: z.string(),
  summary: z.string(),
});

export function createDocumentWriteTool(): RuntimeToolDefinition {
  return {
    id: toolIds.writeDocument,
    version: TOOL_DEFINITION_VERSION,
    toPlannerToolName: "write_document",
    capabilityId: "document.write",
    name: "Write Markdown document",
    description:
      "Create a Markdown document artifact from complete Markdown already provided by the main model. Use for analysis, summaries, reports, plans, answers, and capability gap reports.",
    inputSchema: documentInputSchema,
    outputSchema: documentOutputSchema,
    policy: {
      canUseNetwork: false,
      canWriteFiles: false,
      canModifyProject: false,
      requiresApproval: false,
      mayExternalCost: false,
    },
    timeoutMs: 60_000,
    retryPolicy: noRetry,
    risk: "low",
    renderHint: { kind: "artifact", label: "Write document" },
    async execute(input, toolContext) {
      const parsed = documentInputSchema.parse(input);
      const artifactId = `doc-${toolContext.run.input.metadata.runNodeId}-${stableId(
        `${parsed.title}:${parsed.markdown}`
      )}`;
      const artifact: ArtifactRef = {
        id: artifactId,
        type: "doc",
        title: parsed.title,
        contentRef: `data:text/markdown;charset=utf-8,${encodeURIComponent(parsed.markdown)}`,
        metadata: {
          format: "markdown",
          markdown: parsed.markdown,
          summary: parsed.summary,
          sourcesUsed: parsed.sourcesUsed,
        },
      };

      return toolResultSchema.parse({
        ok: true,
        data: {
          artifactId,
          title: parsed.title,
          markdown: parsed.markdown,
          summary: parsed.summary,
        },
        artifacts: [artifact],
        canvasOperations: [],
        logs: [toolLog("Created Markdown document artifact.")],
      });
    },
  };
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
