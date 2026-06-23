import { isSeedreamConfigured } from "../seedream.ts";
import { isCozeImageConfigured } from "../coze.ts";
import { isByteArtistConfigured } from "../byteartist.ts";
import { getAgentModelConfiguration } from "./agent/model-config.ts";
import { getImageMattingProviderConfiguration } from "./agent/tools/image/image-matting-provider.ts";

export type RuntimeProviderConfiguration = {
  configured: boolean;
  provider: string | null;
  model: string | null;
};

export type ImageProviderSelection = "seedream" | "coze" | "byteartist";

export function getRuntimeProviderConfiguration() {
  return {
    agent: getAgentModelConfiguration(),
    image: getImageProviderConfiguration(),
    imageMatting: getImageMattingProviderConfiguration(),
    video: getVideoProviderConfiguration(),
  };
}

export function getImageProviderConfiguration(
  providerOverride?: ImageProviderSelection | null
): RuntimeProviderConfiguration {
  const provider = providerOverride ?? process.env.IMAGE_PROVIDER?.trim() ?? "seedream";
  if (provider === "coze") {
    return {
      configured: isCozeImageConfigured(),
      provider,
      model:
        process.env.IMAGE_MODEL?.trim() ||
        process.env.COZE_IMAGE_MODEL?.trim() ||
        null,
      };
  }

  if (provider === "byteartist") {
    return {
      configured: isByteArtistConfigured(),
      provider,
      model:
        process.env.IMAGE_MODEL?.trim() ||
        process.env.BYTEARTIST_MODEL?.trim() ||
        "seed4_0407_lemo",
    };
  }

  if (provider !== "seedream") {
    return {
      configured: false,
      provider,
      model: process.env.IMAGE_MODEL?.trim() || null,
    };
  }

  return {
    configured: isSeedreamConfigured(),
    provider,
    model:
      process.env.IMAGE_MODEL?.trim() ||
      process.env.SEEDREAM_REQ_KEY?.trim() ||
      "jimeng_seedream46_cvtob",
  };
}

export function assertImageProviderConfigured(
  action: "generation" | "matting" | "upscale",
  providerOverride?: ImageProviderSelection | null
) {
  if (action === "matting") {
    const matting = getImageMattingProviderConfiguration();
    if (!matting.configured) {
      const expected =
        matting.provider === "rembg"
          ? "Set IMAGE_MATTING_PROVIDER=rembg and REMBG_BIN."
          : "Set IMAGE_MATTING_PROVIDER=byteartist and BYTEARTIST_BASE_URL, BYTEARTIST_AID, BYTEARTIST_APP_KEY, and BYTEARTIST_APP_SECRET, or the docs aliases GATEWAY_BASE_URL, BYTEDANCE_AID, BYTEDANCE_APP_KEY, and BYTEDANCE_APP_SECRET.";
      throw new Error(
        `Image matting provider "${matting.provider ?? "none"}" is not configured. ${expected}`
      );
    }
    return matting;
  }

  const image = getImageProviderConfiguration(providerOverride);
  if (image.provider === "coze" && action === "generation") {
    if (!image.configured) {
      throw new Error(
        "Coze image generation is not configured. Set COZE_IMAGE_TOKEN."
      );
    }
    return image;
  }

  if (image.provider === "byteartist" && action === "generation") {
    if (!image.configured) {
      throw new Error(
        "ByteArtist image generation is not configured. Set BYTEARTIST_BASE_URL, BYTEARTIST_AID, BYTEARTIST_APP_KEY, and BYTEARTIST_APP_SECRET, or the docs aliases GATEWAY_BASE_URL, BYTEDANCE_AID, BYTEDANCE_APP_KEY, and BYTEDANCE_APP_SECRET."
      );
    }
    return image;
  }

  if (image.provider !== "seedream") {
    const expected =
      action === "generation"
        ? "Set IMAGE_PROVIDER=seedream, coze, or byteartist."
        : "Set IMAGE_PROVIDER=seedream.";
    throw new Error(
      `Image ${action} provider "${image.provider ?? "none"}" is not supported. ${expected}`
    );
  }
  if (!image.configured) {
    throw new Error(
      `Seedream image ${action} is not configured. Set SEEDREAM_ACCESS_KEY_ID and SEEDREAM_SECRET_ACCESS_KEY.`
    );
  }
  return image;
}

export function getVideoProviderConfiguration(): RuntimeProviderConfiguration {
  const provider = process.env.VIDEO_PROVIDER?.trim() || null;
  if (!provider) {
    return { configured: false, provider: null, model: null };
  }

  const model =
    process.env.VIDEO_MODEL?.trim() ||
    process.env.SEEDANCE_MODEL?.trim() ||
    null;

  if (provider === "seedance") {
    return {
      configured: Boolean(
        readOptionalEnv("SEEDANCE_ACCESS_KEY_ID", "VOLCENGINE_ACCESS_KEY_ID") &&
          readOptionalEnv("SEEDANCE_SECRET_ACCESS_KEY", "VOLCENGINE_SECRET_ACCESS_KEY")
      ),
      provider,
      model,
    };
  }

  return {
    configured: Boolean(process.env.VIDEO_API_KEY?.trim()),
    provider,
    model,
  };
}

function readOptionalEnv(primary: string, fallback?: string) {
  return process.env[primary] ?? (fallback ? process.env[fallback] : undefined);
}
