import { tool } from "@openai/agents";
import { z } from "zod";

import { toHtmlDocumentBaseUrl } from "../../../../src/lib/html-preview.ts";
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
  title: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .describe("Optional short title for the webpage artifact.")
    .optional(),
  url: z
    .string()
    .trim()
    .url()
    .describe("The public http(s) URL to fetch and save as a webpage artifact."),
});

export const fetchWebpageTool = tool({
  name: "fetch_webpage",
  description:
    "Fetch one public http(s) webpage, save the HTML as a Cucumber webpage artifact, and return a short extracted text preview. Do not use for browser automation, logged-in pages, local files, localhost, private network URLs, or arbitrary binary downloads.",
  parameters: fetchWebpageInputSchema,
  strict: true,
  errorFunction: null,
  async execute(args, runContext, details) {
    const context = requireCucumberContext(runContext?.context);

    const fetched = await fetchPublicReadableWebpage(
      args.url,
      details?.signal
    );
    const extractedTitle = extractHtmlTitle(fetched.html);
    const title = args.title ?? extractedTitle ?? fetched.url.hostname;
    const artifact = await storeTextArtifactContent({
      content: fetched.html,
      metadata: {
        sourceUrl: toHtmlDocumentBaseUrl(fetched.url),
      },
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
