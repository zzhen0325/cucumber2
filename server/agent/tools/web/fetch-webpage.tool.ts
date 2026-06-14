import { tool } from "@openai/agents";
import { z } from "zod";

import type { ArtifactRef } from "../../../../src/types/canvas.ts";
import { storeTextArtifactContent } from "../../../storage.ts";
import type { CucumberAgentContext } from "../../context.ts";
import {
  extractHtmlTitle,
  extractReadableText,
  fetchPublicReadableWebpage,
  publicWebFetchTestHooks,
} from "./public-web-fetch.ts";

const fetchWebpageInputSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  url: z.string().trim().url(),
});

const fetchWebpageJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: {
      type: "string",
      maxLength: 160,
      description: "Optional short title for the webpage artifact.",
    },
    url: {
      type: "string",
      description: "The public http(s) URL to fetch and save as a webpage artifact.",
    },
  },
  required: ["url"],
} as const;

export const fetchWebpageTool = tool({
  name: "fetch_webpage",
  description:
    "Fetch one public http(s) webpage, save the HTML as a Cucumber webpage artifact, and return a short extracted text preview. Do not use for browser automation, logged-in pages, local files, localhost, private network URLs, or arbitrary binary downloads.",
  parameters: fetchWebpageJsonSchema as never,
  strict: false,
  errorFunction: null,
  async execute(rawArgs, runContext, details) {
    const context = requireCucumberContext(runContext?.context);
    const parsed = fetchWebpageInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        error: `invalid_webpage_input: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      };
    }

    const fetched = await fetchPublicReadableWebpage(
      parsed.data.url,
      details?.signal
    );
    const extractedTitle = extractHtmlTitle(fetched.html);
    const title = parsed.data.title ?? extractedTitle ?? fetched.url.hostname;
    const artifact = await storeTextArtifactContent({
      content: fetched.html,
      projectId: context.projectId,
      runNodeId: context.runNodeId,
      sourceToolName: "fetch_webpage",
      title,
      type: "webpage",
      userId: context.userId,
    });

    context.producedArtifacts.push(artifact);
    emitArtifactCreated(context, artifact);

    return {
      artifactId: artifact.id,
      finalUrl: fetched.url.toString(),
      note: "Webpage artifact created and rendered to the canvas.",
      textPreview: extractReadableText(fetched.html, 4_000),
      title,
    };
  },
});

export const fetchWebpageTestHooks = publicWebFetchTestHooks;

function emitArtifactCreated(context: CucumberAgentContext, artifact: ArtifactRef) {
  const event = {
    type: "artifact_created" as const,
    artifact,
    toolName: "fetch_webpage",
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
