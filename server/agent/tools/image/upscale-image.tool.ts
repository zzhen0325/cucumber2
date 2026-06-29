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
  resolution: z
    .enum(["4k", "8k"])
    .describe("Target upscale resolution. Defaults to 4k unless the user asks for 8k.")
    .optional(),
  scale: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("Detail generation strength from 0 to 100. Defaults to 50.")
    .optional(),
});

export const upscaleImageTool = tool({
  name: "upscale_image",
  description:
    "Upscale exactly one selected or upstream image using Seedream intelligent super-resolution. Use this for requests like 高清, 超清, 放大, upscale, 4K, 8K, or 提升清晰度. The image itself is resolved by the Cucumber runtime and is not visible to you; do not ask for or fabricate URLs.",
  parameters: upscaleImageInputSchema,
  strict: true,
  errorFunction: null,
  async execute(args, runContext, details) {
    const context = requireCucumberContext(runContext?.context);
    assertImageToolAllowed(context, "upscale_image");

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
        resolution: args.resolution as SeedreamUpscaleResolution | undefined,
        scale: args.scale,
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
