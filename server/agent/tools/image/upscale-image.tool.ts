import { tool } from "@openai/agents";
import { z } from "zod";

import {
  readSeedreamUpscaleConfigFromEnv,
  upscaleSeedreamImage,
  type SeedreamUpscaleResolution,
} from "../../../../seedream.ts";
import type { ArtifactRef } from "../../../../src/types/canvas.ts";
import { assertImageProviderConfigured } from "../../../provider-config.ts";
import type { CucumberAgentContext } from "../../context.ts";
import { assertImageToolAllowed } from "../../policy/task-artifact-policy.ts";
import {
  resolveSingleSourceImage,
  storeImageToolArtifact,
} from "./image-source.ts";

const upscaleImageInputSchema = z.object({
  resolution: z.enum(["4k", "8k"]).optional(),
  scale: z.number().int().min(0).max(100).optional(),
});

const upscaleImageJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    resolution: {
      type: "string",
      enum: ["4k", "8k"],
      description:
        "Target upscale resolution. Defaults to 4k unless the user explicitly asks for 8k.",
    },
    scale: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description:
        "Detail generation strength from 0 to 100. Defaults to 50.",
    },
  },
} as const;

export const upscaleImageTool = tool({
  name: "upscale_image",
  description:
    "Upscale exactly one selected or upstream image using Seedream intelligent super-resolution. Use this for requests like 高清, 超清, 放大, upscale, 4K, 8K, or 提升清晰度. The image itself is resolved by the Cucumber runtime and is not visible to you; do not ask for or fabricate URLs.",
  parameters: upscaleImageJsonSchema as never,
  strict: false,
  errorFunction: null,
  async execute(rawArgs, runContext, details) {
    const context = requireCucumberContext(runContext?.context);
    assertImageToolAllowed(context, "upscale_image");
    const parsed = upscaleImageInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        error: `invalid_upscale_input: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      };
    }

    assertImageProviderConfigured("upscale");

    const source = await resolveUpscaleSourceImage(context);
    const artifacts: ArtifactRef[] = [];
    const emitArtifact = async (image: {
      id: string;
      url: string;
      title?: string;
      metadata?: Record<string, unknown>;
    }) => {
      const artifact = await storeImageToolArtifact({
        context,
        image,
        metadata: {
          sourceNodeId: source.nodeId,
          operation: "upscale",
        },
        signal: details?.signal,
        sourceNodeId: source.nodeId,
        toolName: "upscale_image",
      });
      artifacts.push(artifact);
    };

    const config = readSeedreamUpscaleConfigFromEnv();
    await upscaleSeedreamImage(
      {
        imageUrl: source.imageUrl,
        onImage: emitArtifact,
        resolution: parsed.data.resolution as SeedreamUpscaleResolution | undefined,
        scale: parsed.data.scale,
        signal: details?.signal,
      },
      config
    );

    return {
      upscaled: artifacts.length,
      artifactIds: artifacts.map((artifact) => artifact.id),
      note: "Upscaled image rendered to the canvas. Image URLs are intentionally omitted from your context.",
    };
  },
});

async function resolveUpscaleSourceImage(context: CucumberAgentContext) {
  return resolveSingleSourceImage(context, "请选择一张图片后再执行高清放大。");
}

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}
