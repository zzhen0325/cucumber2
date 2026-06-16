import { setTimeout as delay } from "node:timers/promises";

export type CozeGeneratedImage = {
  id: string;
  url: string;
  title?: string;
  metadata?: Record<string, unknown>;
};

export type CozeGenerateInput = {
  prompt: string;
  imageUrls?: string[];
  resultCount?: number;
  width?: number;
  height?: number;
  onImage?: (image: CozeGeneratedImage) => void | Promise<void>;
  signal?: AbortSignal;
};

export type CozeImageConfig = {
  url: string;
  token: string;
  maxInputImages: number;
  maxOutputImages: number;
  size?: string;
  watermark?: boolean;
  model?: string;
};

const DEFAULT_COZE_IMAGE_URL = "https://fr8nsskrnk.coze.site/run";

export async function generateCozeImage(
  input: CozeGenerateInput,
  config = readCozeImageConfigFromEnv()
): Promise<{ images: CozeGeneratedImage[] }> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error("Coze image prompt is empty.");
  }

  const resultCount = normalizeResultCount(
    input.resultCount,
    config.maxOutputImages
  );
  const imageUrls = uniqueNonEmpty(input.imageUrls ?? []).slice(
    0,
    config.maxInputImages
  );
  const images: CozeGeneratedImage[] = [];

  for (let index = 1; index <= resultCount; index += 1) {
    input.signal?.throwIfAborted();
    const response = await callCozeImageWorkflow({
      body: buildCozeImageRequestBody({
        config,
        imageUrls,
        prompt,
        width: input.width,
        height: input.height,
      }),
      config,
      signal: input.signal,
    });
    const urls = extractImageUrls(response.text, response.json);
    if (!urls.length) {
      throw new Error("Coze image generation returned no image URL.");
    }

    const image: CozeGeneratedImage = {
      id: `coze-${Date.now()}-${index}`,
      url: urls[0],
      title: resultCount === 1 ? "Coze image" : `Coze image ${index}`,
      metadata: {
        provider: "coze",
        endpoint: config.url,
        inputImageCount: imageUrls.length,
        requestedImageCount: resultCount,
        promptIndex: index,
        width: input.width,
        height: input.height,
      },
    };
    images.push(image);
    await input.onImage?.(image);

    if (index < resultCount) {
      await delay(100, undefined, { signal: input.signal });
    }
  }

  return { images };
}

export function buildCozeImageRequestBody({
  config,
  imageUrls,
  prompt,
  width,
  height,
}: {
  config: CozeImageConfig;
  imageUrls: string[];
  prompt: string;
  width?: number;
  height?: number;
}) {
  const body: Record<string, unknown> = {
    prompt,
    reference_images: imageUrls.map((url) => ({ url })),
  };
  const size = buildCozeSizeValue(config.size, width, height);
  if (size !== undefined) {
    body.size = size;
  }
  if (config.watermark !== undefined) {
    body.watermark = config.watermark;
  }
  if (config.model) {
    body.model = config.model;
  }
  return body;
}

export function isCozeImageConfigured() {
  return Boolean(readOptionalEnv("COZE_IMAGE_TOKEN", "COZE_API_TOKEN"));
}

export function readCozeImageConfigFromEnv(): CozeImageConfig {
  return {
    url: process.env.COZE_IMAGE_URL?.trim() || DEFAULT_COZE_IMAGE_URL,
    token: readRequiredEnv("COZE_IMAGE_TOKEN", "COZE_API_TOKEN"),
    maxInputImages: readNumberEnv("COZE_IMAGE_MAX_INPUT_IMAGES", 8),
    maxOutputImages: readNumberEnv("COZE_IMAGE_MAX_OUTPUT_IMAGES", 4),
    size: readStringEnv("COZE_IMAGE_SIZE"),
    watermark: readBooleanEnv("COZE_IMAGE_WATERMARK"),
    model: readStringEnv("COZE_IMAGE_MODEL"),
  };
}

async function callCozeImageWorkflow({
  body,
  config,
  signal,
}: {
  body: Record<string, unknown>;
  config: CozeImageConfig;
  signal?: AbortSignal;
}) {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Coze image generation failed (${response.status} ${response.statusText}): ${truncateForError(text)}`
    );
  }

  return {
    status: response.status,
    text,
    json: parseJson(text),
  };
}

function buildCozeSizeValue(
  defaultSize: string | undefined,
  width?: number,
  height?: number
) {
  if (width !== undefined || height !== undefined) {
    if (width === undefined || height === undefined) {
      throw new Error("Coze explicit dimensions require both width and height.");
    }
    return `${width}x${height}`;
  }
  return defaultSize;
}

function extractImageUrls(text: string, json: unknown) {
  const urls = new Set<string>();
  collectUrlsFromUnknown(json, urls);

  for (const match of text.matchAll(/https?:\/\/[^\s"'<>\\]+/g)) {
    urls.add(cleanUrl(match[0]));
  }
  for (const match of text.matchAll(/data:image\/[a-zA-Z0-9.+-]+;base64,[^\s"'<>\\]+/g)) {
    urls.add(cleanUrl(match[0]));
  }

  return Array.from(urls).filter(Boolean);
}

function collectUrlsFromUnknown(value: unknown, urls: Set<string>) {
  if (typeof value === "string") {
    if (/^(https?:\/\/|data:image\/)/i.test(value)) {
      urls.add(cleanUrl(value));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrlsFromUnknown(item, urls);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const nested of Object.values(value)) {
    collectUrlsFromUnknown(nested, urls);
  }
}

function cleanUrl(value: string) {
  return value.trim().replace(/[),.;\]]+$/g, "");
}

function normalizeResultCount(value: number | undefined, maxOutputImages: number) {
  const count = Math.max(1, Math.floor(value ?? 1));
  if (count > maxOutputImages) {
    throw new Error(`一次最多生成 ${maxOutputImages} 张图片。`);
  }
  return count;
}

function uniqueNonEmpty(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function readRequiredEnv(primary: string, fallback?: string) {
  const value = readOptionalEnv(primary, fallback)?.trim();
  if (!value) {
    throw new Error(
      `${primary}${fallback ? ` or ${fallback}` : ""} is not configured.`
    );
  }
  return value;
}

function readOptionalEnv(primary: string, fallback?: string) {
  return process.env[primary] ?? (fallback ? process.env[fallback] : undefined);
}

function readNumberEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readStringEnv(name: string) {
  const raw = process.env[name]?.trim();
  return raw || undefined;
}

function readBooleanEnv(name: string) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return undefined;
  }
  if (raw === "true" || raw === "1") {
    return true;
  }
  if (raw === "false" || raw === "0") {
    return false;
  }
  throw new Error(`${name} must be true or false.`);
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function truncateForError(text: string) {
  const trimmed = text.trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}
