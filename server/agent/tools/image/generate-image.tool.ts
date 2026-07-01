import { tool } from "@openai/agents";
import { z } from "zod";

import {
  generateSeedreamImage,
  readSeedreamConfigFromEnv,
} from "../../../../seedream.ts";
import {
  BYTEARTIST_LEMO_MODEL,
  BYTEARTIST_SEED5_DUOTU_MODEL,
  doesByteArtistModelSupportReferenceImages,
  generateByteArtistImage,
  readByteArtistConfigFromEnv,
  withByteArtistModelConfig,
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
import {
  isLemoImagePrompt,
  rewritePromptWithReferenceImagesForTextOnlyModel,
} from "./reference-image-prompt.ts";
import { normalizeImageGenerationParameters } from "./image-generation-parameters.ts";

const imageVariantInputSchema = z.object({
  height: z.number().int().positive(),
  label: z.string().min(1).optional(),
  width: z.number().int().positive(),
});

const generateImageInputSchema = z.object({
  aspectRatio: z.string().min(1).optional(),
  height: z.number().int().positive().optional(),
  prompt: z.string().trim().min(1),
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
        "The image description to render. Required: derive it from the raw prompt, trusted context, input-mode controls, and any available Task Frame constraints before calling this tool. Reference images attached on the canvas are resolved by the server and are NOT visible to you; providers that cannot accept images receive a server-authored text prompt instead.",
    },
    aspectRatio: {
      type: "string",
      description:
        "Optional output aspect ratio such as 16:9, 9:16, or 1:1. Prefer this when the user, input mode, or available Task Frame includes an aspect ratio constraint.",
    },
    width: {
      type: "integer",
      minimum: 1,
      description:
        "Optional explicit output width in pixels. Use with height when the user, input mode, or available Task Frame includes exact dimensions.",
    },
    height: {
      type: "integer",
      minimum: 1,
      description:
        "Optional explicit output height in pixels. Use with width when the user, input mode, or available Task Frame includes exact dimensions.",
    },
    resultCount: {
      type: "integer",
      minimum: 1,
      description:
        "How many images to generate. Match the number the user asked for or selected in input mode; also honor available Task Frame constraints. Defaults to 1 when omitted.",
    },
    variants: {
      type: "array",
      description:
        "Optional list of output size variants. Use one item per requested output dimension when the user, input mode, or available Task Frame includes multiple dimensions; do not also pass width/height for the batch.",
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
  required: ["prompt"],
} as const;

export const generateImageToolDescription =
  "Generate image artifacts from a text prompt using the configured image service. Generated images are rendered onto the canvas automatically as image result nodes. This tool does not write the database directly; it produces in-memory artifacts that the Cucumber runtime emits. Reference images are resolved by the server and never exposed to you, so do not try to read or fabricate image URLs.";

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

  const imageParameters = normalizeImageGenerationParameters({
    candidate: parsed.data,
  });
  let prompt = normalizeSeedreamProviderPrompt(imageParameters.prompt);
  if (!prompt) {
    return { error: "empty_prompt: no image prompt was provided." };
  }

  // No silent fallback: surface a configuration error instead of faking output.
  const lemoRequested =
    isLemoImagePrompt(prompt) || isLemoImagePrompt(context.prompt);
  const imageProvider = assertImageProviderConfigured(
    "generation",
    lemoRequested ? "byteartist" : context.imageProvider
  );

  const variants = normalizeImageToolVariants(imageParameters.variants);
  let providerPromptMetadata: Record<string, unknown> = {};

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
        ...providerPromptMetadata,
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
    context.upstreamContext,
    {
      projectId: context.projectId,
      userId: context.userId,
    }
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
            imageParameters.resultCount,
            config.maxOutputImages
          ),
          width: imageParameters.width,
          height: imageParameters.height,
          imageUrls,
          onImage: emitArtifact,
          signal: signal ?? context.signal,
        },
        config
      );
    }
  } else if (imageProvider.provider === "byteartist") {
    let config = readByteArtistConfigFromEnv();
    if (lemoRequested || context.imageProvider === "byteartist") {
      config = withByteArtistModelConfig(config, BYTEARTIST_LEMO_MODEL);
    } else if (imageProvider.model === BYTEARTIST_SEED5_DUOTU_MODEL) {
      config = withByteArtistModelConfig(config, BYTEARTIST_SEED5_DUOTU_MODEL);
    }
    let byteArtistUpstreamContext = upstreamContext;
    const byteArtistReferenceImages = collectResolvedReferenceImages(upstreamContext);
    if (
      byteArtistReferenceImages.length &&
      !doesByteArtistModelSupportReferenceImages(config.modelId)
    ) {
      const rewritten = await rewritePromptWithReferenceImagesForTextOnlyModel({
        images: byteArtistReferenceImages,
        modelId: config.modelId,
        prompt,
        signal: signal ?? context.signal,
      });
      if (rewritten) {
        prompt = rewritten.prompt;
        providerPromptMetadata = {
          lemoModelForced: lemoRequested || undefined,
          referenceImageDescriptionModel: rewritten.descriptionModel,
          referenceImageDescriptionProvider: rewritten.descriptionProvider,
          referenceImageDescriptions: rewritten.descriptions,
          referenceImagePromptRewrite: true,
        };
        byteArtistUpstreamContext = upstreamContext.filter(
          (item) => item.type !== "image"
        );
      }
    } else if (lemoRequested) {
      providerPromptMetadata = {
        lemoModelForced: true,
      };
    }

    await generateByteArtistImage(
      buildGenerateImageByteArtistInput(
        {
          prompt,
          requestedResultCount: imageParameters.resultCount,
          aspectRatio: imageParameters.aspectRatio,
          variants,
          width: imageParameters.width,
          height: imageParameters.height,
          upstreamContext: byteArtistUpstreamContext,
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
          requestedResultCount: imageParameters.resultCount,
          aspectRatio: imageParameters.aspectRatio,
          variants,
          width: imageParameters.width,
          height: imageParameters.height,
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

function collectResolvedReferenceImages(
  upstreamContext: CucumberAgentContext["upstreamContext"]
) {
  return upstreamContext.flatMap((item) => {
    if (item.type !== "image" || !item.imageUrl) {
      return [];
    }
    return [
      {
        imageUrl: item.imageUrl,
        nodeId: item.nodeId,
        prompt: item.prompt,
        summary: item.summary,
        title: item.title ?? item.artifact?.title,
      },
    ];
  });
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
