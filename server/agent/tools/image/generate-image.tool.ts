import { tool } from "@openai/agents";
import { z } from "zod";

import {
  generateSeedreamImage,
  isSeedreamConfigured,
  readSeedreamConfigFromEnv,
} from "../../../../seedream.ts";
import type { ArtifactRef } from "../../../../src/types/canvas.ts";
import {
  resolveStorageBackedImageContext,
  storeGeneratedImageFromUrl,
} from "../../../storage.ts";
import type { CucumberAgentContext } from "../../context.ts";
import {
  buildGenerateImageSeedreamInput,
  normalizeSeedreamProviderPrompt,
} from "./generate-image.request.ts";

const generateImageInputSchema = z.object({
  aspectRatio: z.string().min(1).optional(),
  height: z.number().int().positive().optional(),
  prompt: z.string().min(1).optional(),
  resultCount: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
});

export type GenerateImageToolArgs = z.infer<typeof generateImageInputSchema>;

// Hand-written JSON schema (strict:false) to mirror the other Agent tools.
export const generateImageJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    prompt: {
      type: "string",
      description:
        "The image description to render. Optional. Defaults to the run prompt when omitted. Reference images attached on the canvas are sent to the image service automatically and are NOT visible to you.",
    },
    aspectRatio: {
      type: "string",
      description:
        "Optional output aspect ratio such as 16:9, 9:16, or 1:1. Prefer this when normalized input provides an aspect ratio.",
    },
    width: {
      type: "integer",
      minimum: 1,
      description:
        "Optional explicit output width in pixels. Use with height when normalized input provides exact dimensions.",
    },
    height: {
      type: "integer",
      minimum: 1,
      description:
        "Optional explicit output height in pixels. Use with width when normalized input provides exact dimensions.",
    },
    resultCount: {
      type: "integer",
      minimum: 1,
      description:
        "How many images to generate. Match the number the user asked for; defaults to what the prompt implies (usually 1).",
    },
  },
} as const;

export const generateImageToolDescription =
  "Generate image artifacts from a text prompt using the Seedream image service. Generated images are rendered onto the canvas automatically as image result nodes. This tool does not write the database directly; it produces in-memory artifacts that the Cucumber runtime emits. Reference images are forwarded to the service directly and never exposed to you, so do not try to read or fabricate image URLs.";

export const generateImageTool = tool({
  name: "generate_image",
  description: generateImageToolDescription,
  parameters: generateImageJsonSchema as never,
  strict: false,
  // Let real failures (misconfiguration, image-service errors) propagate so the
  // runtime surfaces them as a failed run instead of returning a fake result.
  errorFunction: null,
  async execute(rawArgs, runContext, details) {
    const context = requireCucumberContext(runContext?.context);
    return executeGenerateImageTool({
      args: rawArgs,
      context,
      signal: details?.signal,
    });
  },
});

export async function executeGenerateImageTool({
  args,
  context,
  signal,
}: {
  args: unknown;
  context: CucumberAgentContext;
  signal?: AbortSignal;
}) {
  const parsed = generateImageInputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      error: `invalid_image_input: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    };
  }

  // No silent fallback: surface a configuration error instead of faking output.
  if (!isSeedreamConfigured()) {
    throw new Error(
      "Seedream image generation is not configured. Set SEEDREAM_ACCESS_KEY_ID and SEEDREAM_SECRET_ACCESS_KEY."
    );
  }

  const prompt = normalizeSeedreamProviderPrompt(
    parsed.data.prompt?.trim() || context.prompt?.trim() || ""
  );
  if (!prompt) {
    return { error: "empty_prompt: no image prompt was provided." };
  }

  const artifacts: ArtifactRef[] = [];
  const emitArtifact = async (image: {
    id: string;
    url: string;
    title?: string;
    metadata?: Record<string, unknown>;
  }) => {
    const artifact = await storeGeneratedImageFromUrl({
      artifactId: image.id,
      metadata: {
        ...image.metadata,
        prompt,
        sourcePrompt: context.prompt,
      },
      projectId: context.projectId,
      runNodeId: context.runNodeId,
      signal: signal ?? context.signal,
      sourceUrl: image.url,
      title: image.title,
      userId: context.userId,
    });
    context.producedArtifacts.push(artifact);
    artifacts.push(artifact);
    // Stream each image to the client the moment it lands so the canvas renders
    // results one-by-one. Falls back to `pendingEvents` if no live sink is wired.
    const event = {
      type: "artifact_created" as const,
      artifact,
      toolName: "generate_image",
    };
    if (context.pushLiveEvent) {
      context.pushLiveEvent(event);
    } else {
      context.pendingEvents.push(event);
    }
  };

  const config = readSeedreamConfigFromEnv();
  const upstreamContext = await resolveStorageBackedImageContext(
    context.upstreamContext
  );
  await generateSeedreamImage(
    buildGenerateImageSeedreamInput(
      {
        prompt,
        requestedResultCount: parsed.data.resultCount,
        aspectRatio: parsed.data.aspectRatio,
        width: parsed.data.width,
        height: parsed.data.height,
        upstreamContext,
        onImage: emitArtifact,
        signal: signal ?? context.signal,
      },
      config
    ),
    config
  );

  return {
    generated: artifacts.length,
    artifactIds: artifacts.map((artifact) => artifact.id),
    prompt,
    note: "Images rendered to the canvas. Image URLs are intentionally omitted from your context.",
  };
}

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}
