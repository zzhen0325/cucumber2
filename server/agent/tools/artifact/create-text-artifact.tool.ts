import { tool } from "@openai/agents";
import { z } from "zod";

import type { ArtifactRef } from "../../../../src/types/canvas.ts";
import { storeTextArtifactContent } from "../../../storage.ts";
import type { CucumberAgentContext } from "../../context.ts";
import { assertTextArtifactToolAllowed } from "../../policy/task-artifact-policy.ts";

const createTextArtifactInputSchema = z.object({
  content: z.string().trim().min(1),
  format: z.enum(["markdown", "document"]).default("markdown"),
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
      enum: ["markdown", "document"],
      description:
        "Output surface. Use markdown for notes, briefs, specs, summaries, and editable Markdown drafts; use document for longer document-style drafts.",
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
    if (
      context.normalizedInput?.artifact?.kind === "diagram" &&
      context.normalizedInput.artifact.format === "mermaid" &&
      !/```mermaid[\s\S]+```/i.test(parsed.data.content)
    ) {
      throw new Error(
        "tool_policy_rejected: Mermaid diagram artifacts must include a fenced mermaid code block."
      );
    }

    const artifact = await storeTextArtifactContent({
      content: parsed.data.content,
      projectId: context.projectId,
      runNodeId: context.runNodeId,
      sourceToolName: "create_text_artifact",
      title: parsed.data.title,
      type: "doc",
      userId: context.userId,
    });

    context.producedArtifacts.push(artifact);
    emitArtifactCreated(context, artifact);

    return {
      artifactId: artifact.id,
      artifactType: artifact.type,
      format: parsed.data.format,
      note: "Text artifact created and rendered to the canvas.",
      title: artifact.title,
    };
  },
});

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
