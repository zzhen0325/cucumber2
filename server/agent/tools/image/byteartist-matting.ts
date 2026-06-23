import { Buffer } from "node:buffer";

import {
  BYTEARTIST_MATTING_MODEL,
  isByteArtistConfigured,
  readByteArtistConfigFromEnv,
  submitAndPollByteArtistImageTask,
  type ByteArtistConfig,
} from "../../../../byteartist.ts";
import type {
  ImageMattingBackground,
  ImageMattingRunInput,
  ImageMattingRunResult,
} from "./image-matting-provider.ts";

export type ByteArtistMattingConfig = ByteArtistConfig & {
  blue: number;
  green: number;
  onlyMask: number;
  red: number;
  refineMask: number;
};

type Rgb = {
  blue: number;
  green: number;
  red: number;
};

type ByteArtistMattingSourceImage = {
  byteSize?: number;
  field: "base64file" | "source";
  mimeType?: string;
  transfer: "base64" | "url";
  value: string;
};

export function readByteArtistMattingConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ByteArtistMattingConfig {
  return {
    ...readByteArtistConfigFromEnv(env),
    blue: readIntegerEnv(env.BYTEARTIST_MATTING_BLUE, -1),
    green: readIntegerEnv(env.BYTEARTIST_MATTING_GREEN, -1),
    imageReturnFormat: env.BYTEARTIST_MATTING_IMAGE_RETURN_FORMAT?.trim() || "png",
    imageReturnType: env.BYTEARTIST_MATTING_IMAGE_RETURN_TYPE?.trim() || "url",
    modelId: readByteArtistMattingModelFromEnv(env),
    onlyMask: readIntegerEnv(env.BYTEARTIST_MATTING_ONLY_MASK, 0),
    red: readIntegerEnv(env.BYTEARTIST_MATTING_RED, -1),
    refineMask: readIntegerEnv(env.BYTEARTIST_MATTING_REFINE_MASK, 2),
  };
}

export function readByteArtistMattingModelFromEnv(
  env: NodeJS.ProcessEnv = process.env
) {
  return env.BYTEARTIST_MATTING_MODEL?.trim() || BYTEARTIST_MATTING_MODEL;
}

export function isByteArtistMattingConfigured(
  env: NodeJS.ProcessEnv = process.env
) {
  return isByteArtistConfigured(env);
}

export async function runByteArtistMatting(
  input: ImageMattingRunInput,
  config = readByteArtistMattingConfigFromEnv()
): Promise<ImageMattingRunResult> {
  assertSupportedByteArtistMattingOptions(input);
  const background = input.background ?? "transparent";
  const reqJson = buildByteArtistMattingReqJson({
    background,
    config,
  });
  const sourceImage = resolveByteArtistMattingSourceImage(input);
  const { imageUrls, taskId } = await submitAndPollByteArtistImageTask(
    {
      image: sourceImage.value,
      imageField: sourceImage.field,
      reqJson,
      signal: input.signal,
    },
    config
  );
  const outputImage = imageUrls[0];
  if (!outputImage) {
    throw new Error("ByteArtist matting returned no image URL.");
  }

  const bytes = await downloadByteArtistMattingImage(outputImage, input.signal);
  if (bytes.byteLength === 0) {
    throw new Error("ByteArtist matting produced an empty output image.");
  }

  return {
    bytes,
    engine: config.modelId,
    metadata: {
      ...reqJson,
      background,
      engine: config.modelId,
      model: config.modelId,
      provider: "byteartist",
      sourceByteSize: sourceImage.byteSize,
      sourceMimeType: sourceImage.mimeType,
      sourceTransfer: sourceImage.transfer,
      taskId,
    },
    mimeType: "image/png",
    provider: "byteartist",
  };
}

export function buildByteArtistMattingReqJson({
  background,
  config,
}: {
  background: ImageMattingBackground;
  config: Pick<
    ByteArtistMattingConfig,
    "blue" | "green" | "onlyMask" | "red" | "refineMask"
  >;
}) {
  const color = resolveMattingBackgroundColor(background, config);
  return {
    blue: color.blue,
    green: color.green,
    only_mask: config.onlyMask,
    red: color.red,
    refine_mask: config.refineMask,
  };
}

function encodeByteArtistMattingSourceImage({
  bytes,
  mimeType,
}: {
  bytes: Uint8Array;
  mimeType?: string;
}): ByteArtistMattingSourceImage {
  if (bytes.byteLength === 0) {
    throw new Error("Source image for ByteArtist matting is empty.");
  }
  const normalizedMimeType = mimeType?.trim() || "image/png";
  if (!normalizedMimeType.startsWith("image/")) {
    throw new Error(`Source asset is not an image (${normalizedMimeType}).`);
  }
  return {
    byteSize: bytes.byteLength,
    field: "base64file" as const,
    mimeType: normalizedMimeType,
    transfer: "base64" as const,
    value: Buffer.from(bytes).toString("base64"),
  };
}

function resolveByteArtistMattingSourceImage(
  input: ImageMattingRunInput
): ByteArtistMattingSourceImage {
  if (isByteArtistProviderReadableUrl(input.sourceUrl)) {
    return {
      field: "source" as const,
      transfer: "url" as const,
      value: input.sourceUrl,
    };
  }

  if (!input.sourceBytes) {
    throw new Error(
      "ByteArtist matting requires a public http(s) source URL or source image bytes."
    );
  }
  return encodeByteArtistMattingSourceImage({
    bytes: input.sourceBytes,
    mimeType: input.sourceMimeType,
  });
}

function isByteArtistProviderReadableUrl(value: string) {
  return /^https?:\/\//i.test(value) || /^tos:\/\//i.test(value);
}

async function downloadByteArtistMattingImage(
  image: string,
  signal?: AbortSignal
) {
  if (image.startsWith("data:")) {
    return decodeDataImage(image);
  }

  const response = await fetch(image, { signal });
  if (!response.ok) {
    throw new Error(
      `Failed to download ByteArtist matting result (${response.status} ${response.statusText}).`
    );
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim();
  if (mimeType && !mimeType.startsWith("image/")) {
    throw new Error(`ByteArtist matting result is not an image (${mimeType}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function decodeDataImage(image: string) {
  const match = /^data:([^;,]+)?;base64,(.*)$/is.exec(image);
  if (!match) {
    throw new Error("ByteArtist matting returned an unsupported data URL.");
  }
  const mimeType = match[1]?.trim();
  if (mimeType && !mimeType.startsWith("image/")) {
    throw new Error(`ByteArtist matting result is not an image (${mimeType}).`);
  }
  return new Uint8Array(Buffer.from(match[2], "base64"));
}

function assertSupportedByteArtistMattingOptions(input: ImageMattingRunInput) {
  if (input.aspectRatio || input.width || input.height) {
    throw new Error(
      "unsupported_image_matting_dimensions: ByteArtist image_matting_lemo preserves source dimensions; omit aspectRatio, width, and height."
    );
  }
}

function resolveMattingBackgroundColor(
  background: ImageMattingBackground,
  config: Pick<ByteArtistMattingConfig, "blue" | "green" | "red">
): Rgb {
  if (background === "white") {
    return { blue: 255, green: 255, red: 255 };
  }
  if (background === "neutral") {
    return { blue: 239, green: 242, red: 242 };
  }
  return {
    blue: config.blue,
    green: config.green,
    red: config.red,
  };
}

function readIntegerEnv(value: string | undefined, fallback: number) {
  if (value === undefined || !value.trim()) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
