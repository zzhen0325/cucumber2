import { tool } from "@openai/agents";
import { z } from "zod";

import type { ArtifactRef } from "../../../../src/types/canvas.ts";
import { storeTextArtifactContent } from "../../../storage.ts";
import type { CucumberAgentContext } from "../../context.ts";

const citationSchema = z.object({
  quote: z.string().trim().min(1).max(1_000).optional(),
  title: z.string().trim().min(1).max(160),
  url: z.string().trim().url(),
});

const createResearchArtifactInputSchema = z.object({
  citations: z.array(citationSchema).min(1).max(10),
  content: z.string().trim().min(1),
  title: z.string().trim().min(1).max(160),
});

const createResearchArtifactJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    citations: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          quote: { type: "string" },
          title: { type: "string" },
          url: { type: "string" },
        },
        required: ["title", "url"],
      },
      description:
        "Citation metadata for sources used in the research markdown.",
    },
    content: {
      type: "string",
      description:
        "Complete research markdown. Include inline citation markers or a Sources section matching the citation metadata.",
    },
    title: {
      type: "string",
      maxLength: 160,
      description: "Short title shown on the canvas.",
    },
  },
  required: ["title", "content", "citations"],
} as const;

export const createResearchArtifactTool = tool({
  name: "create_research_artifact",
  description:
    "Create a research markdown artifact with citation metadata. Use only after collecting source excerpts from collect_research_sources or trusted canvas context. It writes through Cucumber runtime storage and emits an artifact event; it does not directly mutate canvas nodes.",
  parameters: createResearchArtifactJsonSchema as never,
  strict: false,
  errorFunction: null,
  async execute(rawArgs, runContext) {
    const context = requireCucumberContext(runContext?.context);
    const parsed = createResearchArtifactInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        error: `invalid_research_artifact_input: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      };
    }

    const artifact = await storeTextArtifactContent({
      content: parsed.data.content,
      metadata: {
        citations: parsed.data.citations,
        previewKind: "markdown",
        researchSourceCount: parsed.data.citations.length,
      },
      projectId: context.projectId,
      runNodeId: context.runNodeId,
      sourceToolName: "create_research_artifact",
      title: parsed.data.title,
      type: "doc",
      userId: context.userId,
    });

    context.producedArtifacts.push(artifact);
    emitArtifactCreated(context, artifact);

    return {
      artifactId: artifact.id,
      citationCount: parsed.data.citations.length,
      note: "Research artifact created and rendered to the canvas.",
      title: artifact.title,
    };
  },
});

function emitArtifactCreated(context: CucumberAgentContext, artifact: ArtifactRef) {
  const event = {
    type: "artifact_created" as const,
    artifact,
    toolName: "create_research_artifact",
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
