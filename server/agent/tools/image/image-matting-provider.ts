import { randomUUID } from "node:crypto";

import {
  isRembgCliConfigured,
  readRembgMattingConfigFromEnv,
  runRembgCliMatting,
} from "./rembg-matting.ts";

export type ImageMattingBackground = "transparent" | "white" | "neutral";

export type ImageMattingRunInput = {
  aspectRatio?: string;
  background?: ImageMattingBackground;
  height?: number;
  signal?: AbortSignal;
  sourceUrl: string;
  width?: number;
};

export type ImageMattingRunResult = {
  bytes: Uint8Array;
  engine: string;
  metadata: Record<string, unknown>;
  mimeType: "image/png";
  provider: string;
};

export type ImageMattingProviderConfiguration = {
  configured: boolean;
  model: string | null;
  provider: string | null;
};

export function runImageMatting(
  input: ImageMattingRunInput
): Promise<ImageMattingRunResult> {
  const provider = readImageMattingProviderName();
  if (provider !== "rembg") {
    throw new Error(
      `Image matting provider "${provider}" is not supported. Set IMAGE_MATTING_PROVIDER=rembg.`
    );
  }

  return runRembgCliMatting(input, readRembgMattingConfigFromEnv());
}

export function createImageMattingArtifactId() {
  const provider = readImageMattingProviderName();
  return `${provider}-matting-${randomUUID().slice(0, 12)}`;
}

export function getImageMattingProviderConfiguration(): ImageMattingProviderConfiguration {
  const provider = readImageMattingProviderName();
  if (provider !== "rembg") {
    return {
      configured: false,
      model: process.env.REMBG_MODEL?.trim() || null,
      provider,
    };
  }

  const config = readRembgMattingConfigFromEnv();
  return {
    configured: isRembgCliConfigured(config),
    model: config.model,
    provider,
  };
}

function readImageMattingProviderName() {
  return process.env.IMAGE_MATTING_PROVIDER?.trim() || "rembg";
}
