import { tool } from "@openai/agents";
import { z } from "zod";

import type { ArtifactRef } from "../../../../src/types/canvas.ts";
import { repairMarkdownBlockBoundaries } from "../../../../src/lib/markdown-artifact.ts";
import { storeTextArtifactContent } from "../../../storage.ts";
import type { CucumberAgentContext } from "../../context.ts";
import { assertTextArtifactToolAllowed } from "../../policy/task-artifact-policy.ts";

const createTextArtifactInputSchema = z.object({
  content: z.string().trim().min(1),
  format: z.enum(["markdown", "document", "html", "code"]).optional(),
  language: z.string().trim().min(1).max(64).optional(),
  title: z.string().trim().min(1).max(160),
});

const createTextArtifactJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    content: {
      type: "string",
      description:
        "Complete user-facing artifact content. Use Markdown for markdown/document drafts.",
    },
    format: {
      type: "string",
      enum: ["markdown", "document", "html", "code"],
      description:
        "Output surface. Use markdown for notes, briefs, specs, and summaries; document for longer document drafts; html for generated HTML pages/animations; code for source code artifacts.",
    },
    language: {
      type: "string",
      maxLength: 64,
      description: "Optional code language label, such as html, css, ts, or json.",
    },
    title: {
      type: "string",
      maxLength: 160,
      description: "Short artifact title shown on the canvas.",
    },
  },
  required: ["title", "content"],
} as const;

export const createTextArtifactTool = tool({
  name: "create_text_artifact",
  description:
    "Create a trusted text artifact for the canvas. Use this only from a specialist that is producing a markdown or document result. It writes artifact content through Cucumber runtime storage and emits an artifact event; it does not directly mutate canvas nodes.",
  parameters: createTextArtifactJsonSchema as never,
  strict: false,
  errorFunction: null,
  async execute(rawArgs, runContext) {
    const context = requireCucumberContext(runContext?.context);
    assertTextArtifactToolAllowed(context);
    const parsed = createTextArtifactInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        error: `invalid_text_artifact_input: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      };
    }
    const artifactType = getArtifactTypeForContext(context, parsed.data.format);
    const content = normalizeArtifactContent(parsed.data.content, parsed.data.format);
    if (
      context.normalizedInput?.artifact?.kind === "diagram" &&
      context.normalizedInput.artifact.format === "mermaid" &&
      !/```mermaid[\s\S]+```/i.test(content)
    ) {
      throw new Error(
        "tool_policy_rejected: Mermaid diagram artifacts must include a fenced mermaid code block."
      );
    }
    if (artifactType === "webpage" && !looksLikeHtmlDocument(content)) {
      throw new Error(
        "tool_policy_rejected: webpage artifacts must contain a complete HTML document."
      );
    }

    const artifact = await storeTextArtifactContent({
      content,
      metadata: {
        language: parsed.data.language ?? inferLanguage(artifactType, parsed.data.format),
      },
      projectId: context.projectId,
      runNodeId: context.runNodeId,
      sourceToolName: "create_text_artifact",
      title: parsed.data.title,
      type: artifactType,
      userId: context.userId,
    });

    context.producedArtifacts.push(artifact);
    emitArtifactCreated(context, artifact);

    return {
      artifactId: artifact.id,
      artifactType: artifact.type,
      format: parsed.data.format ?? inferFormat(artifactType),
      note: "Text artifact created and rendered to the canvas.",
      title: artifact.title,
    };
  },
});

function getArtifactTypeForContext(
  context: CucumberAgentContext,
  requestedFormat: z.infer<typeof createTextArtifactInputSchema>["format"]
) {
  const kind = context.normalizedInput?.artifact?.kind;
  if (kind === "webpage" || requestedFormat === "html") {
    return "webpage" as const;
  }
  if (kind === "code" || requestedFormat === "code") {
    return "code" as const;
  }
  return "doc" as const;
}

function normalizeArtifactContent(content: string, format: string | undefined) {
  if (format !== "html" && format !== "code") {
    return repairMarkdownBlockBoundaries(content);
  }
  const match = content.match(/^```(?:html|css|js|javascript|ts|typescript|json)?\s*\n([\s\S]*?)\n```$/i);
  return match?.[1]?.trim() ?? content;
}

function looksLikeHtmlDocument(content: string) {
  return /<!doctype\s+html/i.test(content) || /<html[\s>]/i.test(content);
}

function inferLanguage(
  artifactType: "code" | "doc" | "webpage",
  format: string | undefined
) {
  if (artifactType === "webpage") {
    return "html";
  }
  return format === "code" ? "text" : undefined;
}

function inferFormat(artifactType: "code" | "doc" | "webpage") {
  if (artifactType === "webpage") {
    return "html";
  }
  if (artifactType === "code") {
    return "code";
  }
  return "markdown";
}

function emitArtifactCreated(context: CucumberAgentContext, artifact: ArtifactRef) {
  const event = {
    type: "artifact_created" as const,
    artifact,
    toolName: "create_text_artifact",
  };
  if (context.pushLiveEvent) {
    context.pushLiveEvent(event);
  } else {
    context.pendingEvents.push(event);
  }
}

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}
