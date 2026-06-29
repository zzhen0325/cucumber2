import { tool } from "@openai/agents";
import { z } from "zod";

import type { ArtifactRef } from "../../../../src/types/canvas.ts";
import { repairMarkdownBlockBoundaries } from "../../../../src/lib/markdown-artifact.ts";
import { storeTextArtifactContent } from "../../../storage.ts";
import type { CucumberAgentContext } from "../../context.ts";
import { assertTextArtifactToolAllowed } from "../../policy/task-artifact-policy.ts";

const createTextArtifactInputSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1)
    .describe("Complete user-facing artifact content."),
  format: z
    .enum(["markdown", "document", "html", "code"])
    .describe("Output surface for the text artifact.")
    .optional(),
  language: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .describe("Optional code language label, such as html, css, ts, or json.")
    .optional(),
  title: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .describe("Short artifact title shown on the canvas."),
});

export const createTextArtifactTool = tool({
  name: "create_text_artifact",
  description:
    "Create a trusted text artifact for the canvas. Use this only from a specialist that is producing a markdown or document result. It writes artifact content through Cucumber runtime storage and emits an artifact event; it does not directly mutate canvas nodes.",
  parameters: createTextArtifactInputSchema,
  strict: true,
  errorFunction: null,
  async execute(args, runContext) {
    const context = requireCucumberContext(runContext?.context);
    assertTextArtifactToolAllowed(context);
    const artifactType = getArtifactTypeForContext(context, args.format);
    const content = normalizeArtifactContent(args.content, args.format);
    if (
      /diagram|mermaid|时序图|流程图|sequence|flowchart/i.test(
        context.normalizedInput?.task.intent ?? ""
      ) &&
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
        language: args.language ?? inferLanguage(artifactType, args.format),
      },
      projectId: context.projectId,
      runNodeId: context.runNodeId,
      sourceToolName: "create_text_artifact",
      title: args.title,
      type: artifactType,
      userId: context.userId,
    });

    context.producedArtifacts.push(artifact);
    emitArtifactCreated(context, artifact);

    return {
      artifactId: artifact.id,
      artifactType: artifact.type,
      format: args.format ?? inferFormat(artifactType),
      note: "Text artifact created and rendered to the canvas.",
      title: artifact.title,
    };
  },
});

function getArtifactTypeForContext(
  context: CucumberAgentContext,
  requestedFormat: z.infer<typeof createTextArtifactInputSchema>["format"]
) {
  if (requestedFormat === "html") {
    return "webpage" as const;
  }
  if (requestedFormat === "code") {
    return "code" as const;
  }
  if (context.normalizedInput?.task.domain === "code") {
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
