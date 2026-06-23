import { tool } from "@openai/agents";
import { z } from "zod";

import {
  generateSeedreamImage,
  readSeedreamConfigFromEnv,
} from "../../../../seedream.ts";
import {
  generateByteArtistImage,
  readByteArtistConfigFromEnv,
} from "../../../../byteartist.ts";
import {
  generateCozeImage,
  readCozeImageConfigFromEnv,
} from "../../../../coze.ts";
import type { ArtifactRef } from "../../../../src/types/canvas.ts";
import {
  resolveStorageBackedImageContext,
  storeGeneratedImageFromUrl,
} from "../../../storage.ts";
import { assertImageProviderConfigured } from "../../../provider-config.ts";
import type { CucumberAgentContext } from "../../context.ts";
import { assertImageToolAllowed } from "../../policy/task-artifact-policy.ts";
import {
  buildGenerateImageByteArtistInput,
  buildGenerateImageSeedreamInput,
  normalizeSeedreamProviderPrompt,
  resolveImageResultCount,
  toSeedreamUpstreamContext,
} from "./generate-image.request.ts";

const imageVariantInputSchema = z.object({
  height: z.number().int().positive(),
  label: z.string().min(1).optional(),
  width: z.number().int().positive(),
});

const generateImageInputSchema = z.object({
  aspectRatio: z.string().min(1).optional(),
  height: z.number().int().positive().optional(),
  prompt: z.string().min(1).optional(),
  resultCount: z.number().int().positive().optional(),
  variants: z.array(imageVariantInputSchema).optional(),
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
    variants: {
      type: "array",
      description:
        "Optional list of output size variants. Use one item per requested output dimension when normalized input provides multiple dimensions; do not also pass width/height for the batch.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          width: { type: "integer", minimum: 1 },
          height: { type: "integer", minimum: 1 },
          label: { type: "string", minLength: 1 },
        },
        required: ["width", "height"],
      },
    },
  },
} as const;

export const generateImageToolDescription =
  "Generate image artifacts from a text prompt using the configured image service. Generated images are rendered onto the canvas automatically as image result nodes. This tool does not write the database directly; it produces in-memory artifacts that the Cucumber runtime emits. Reference images are forwarded to the service directly and never exposed to you, so do not try to read or fabricate image URLs.";

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
  assertImageToolAllowed(context, "generate_image");
  const parsed = generateImageInputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      error: `invalid_image_input: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    };
  }

  // No silent fallback: surface a configuration error instead of faking output.
  const imageProvider = assertImageProviderConfigured(
    "generation",
    context.imageProvider
  );

  const prompt = normalizeSeedreamProviderPrompt(
    parsed.data.prompt?.trim() || context.prompt?.trim() || ""
  );
  if (!prompt) {
    return { error: "empty_prompt: no image prompt was provided." };
  }
  const variants = normalizeImageToolVariants(parsed.data.variants);

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
      sourceToolName: "generate_image",
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

  const upstreamContext = await resolveStorageBackedImageContext(
    context.upstreamContext
  );

  if (imageProvider.provider === "coze") {
    const config = readCozeImageConfigFromEnv();
    const imageUrls = toSeedreamUpstreamContext(upstreamContext)
      .flatMap((item) => item.type === "image" && item.imageUrl ? [item.imageUrl] : [])
      .slice(0, config.maxInputImages);
    if (variants.length > config.maxOutputImages) {
      throw new Error(`一次最多生成 ${config.maxOutputImages} 张图片。`);
    }
    if (variants.length) {
      for (const variant of variants) {
        await generateCozeImage(
          {
            prompt,
            resultCount: 1,
            width: variant.width,
            height: variant.height,
            imageUrls,
            onImage: emitArtifact,
            signal: signal ?? context.signal,
          },
          config
        );
      }
    } else {
      await generateCozeImage(
        {
          prompt,
          resultCount: resolveImageResultCount(
            parsed.data.resultCount,
            [prompt],
            config.maxOutputImages
          ),
          width: parsed.data.width,
          height: parsed.data.height,
          imageUrls,
          onImage: emitArtifact,
          signal: signal ?? context.signal,
        },
        config
      );
    }
  } else if (imageProvider.provider === "byteartist") {
    const config = readByteArtistConfigFromEnv();
    await generateByteArtistImage(
      buildGenerateImageByteArtistInput(
        {
          prompt,
          requestedResultCount: parsed.data.resultCount,
          aspectRatio: parsed.data.aspectRatio,
          variants,
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
  } else {
    const config = readSeedreamConfigFromEnv();
    await generateSeedreamImage(
      buildGenerateImageSeedreamInput(
        {
          prompt,
          requestedResultCount: parsed.data.resultCount,
          aspectRatio: parsed.data.aspectRatio,
          variants,
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
  }

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

function normalizeImageToolVariants(
  variants: GenerateImageToolArgs["variants"]
) {
  if (!variants?.length) {
    return [];
  }
  const seen = new Set<string>();
  return variants.flatMap((variant) => {
    const width = Math.floor(variant.width);
    const height = Math.floor(variant.height);
    const key = `${width}x${height}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{
      height,
      width,
    }];
  });
}
