import { isSeedreamConfigured } from "../seedream.ts";
import { getAgentModelConfiguration } from "./agent/model-config.ts";

export type RuntimeProviderConfiguration = {
  configured: boolean;
  provider: string | null;
  model: string | null;
};

export function getRuntimeProviderConfiguration() {
  return {
    agent: getAgentModelConfiguration(),
    image: getImageProviderConfiguration(),
    video: getVideoProviderConfiguration(),
  };
}

export function getImageProviderConfiguration(): RuntimeProviderConfiguration {
  const provider = process.env.IMAGE_PROVIDER?.trim() || "seedream";
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

export function assertImageProviderConfigured(action: "generation" | "upscale") {
  const image = getImageProviderConfiguration();
  if (image.provider !== "seedream") {
    throw new Error(
      `Image ${action} provider "${image.provider ?? "none"}" is not supported. Set IMAGE_PROVIDER=seedream.`
    );
  }
  if (!image.configured) {
    throw new Error(
      `Seedream image ${action} is not configured. Set SEEDREAM_ACCESS_KEY_ID and SEEDREAM_SECRET_ACCESS_KEY.`
    );
  }
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
