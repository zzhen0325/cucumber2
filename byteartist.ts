import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export type ByteArtistGeneratedImage = {
  id: string;
  url: string;
  title?: string;
  metadata?: Record<string, unknown>;
};

export type ByteArtistImageRequest = {
  height: number;
  image?: string;
  inputImageCount: number;
  prompt: string;
  promptIndex: number;
  targetHeight?: number;
  targetWidth?: number;
  width: number;
};

export type ByteArtistGenerateInput = {
  requests: ByteArtistImageRequest[];
  totalRequestedImageCount: number;
  onImage?: (image: ByteArtistGeneratedImage) => void | Promise<void>;
  signal?: AbortSignal;
};

export type ByteArtistConfig = {
  aid: string;
  appKey: string;
  appSecret: string;
  baseUrl: string;
  expiredDuration: number;
  imageReturnFormat: string;
  imageReturnType: string;
  maxAttempts: number;
  maxInputImages: number;
  maxOutputImages: number;
  modelId: string;
  pollIntervalMs: number;
  seed: number;
  width: number;
  height: number;
};

export type ByteArtistImageTaskInput = {
  image?: string;
  imageField?: "base64file" | "source";
  reqJson: Record<string, unknown>;
  signal?: AbortSignal;
};

type ByteArtistSubmitResponse = {
  data?: { task_id?: string };
  message?: string;
  status_code?: number;
};

export type ByteArtistPollResultItem = {
  binary_data?: string[];
  message?: string;
  pic_urls?: Array<{ backup_url?: string; main_url?: string }>;
  status?: number | string;
};

type ByteArtistPollResponse = {
  data?: {
    results?: ByteArtistPollResultItem[] | Record<string, ByteArtistPollResultItem>;
  };
  message?: string;
  status_code?: number;
};

type ByteArtistModelAdapter = {
  buildReqJson: (input: {
    height: number;
    prompt: string;
    seed: number;
    width: number;
  }) => Record<string, unknown>;
  extractImages?: (result: ByteArtistPollResultItem) => string[];
  supportsReferenceImages: boolean;
};

export const BYTEARTIST_LEMO_MODEL = "seed4_0407_lemo";
export const BYTEARTIST_MATTING_MODEL = "image_matting_lemo";
const DEFAULT_BYTEARTIST_MODEL = BYTEARTIST_LEMO_MODEL;
const DEFAULT_BYTEARTIST_BASE_URL = "https://lv-api-lf.ulikecam.com";

const modelAdapters: Record<string, ByteArtistModelAdapter> = {
  [BYTEARTIST_LEMO_MODEL]: {
    buildReqJson: ({ height, prompt, seed, width }) => ({
      Prompt: prompt,
      height,
      seed,
      width,
    }),
    supportsReferenceImages: false,
  },
};

class ByteArtistClient {
  private readonly config: ByteArtistConfig;

  constructor(config: ByteArtistConfig) {
    this.config = config;
  }

  async submitAndPoll(
    request: ByteArtistImageRequest,
    signal?: AbortSignal
  ): Promise<{ imageUrls: string[]; taskId: string }> {
    signal?.throwIfAborted();
    const taskId = await this.submitTask(request, signal);
    const imageUrls = await this.pollForResult(taskId, signal);
    return { imageUrls, taskId };
  }

  async submitRawAndPoll(
    input: Omit<ByteArtistImageTaskInput, "signal">,
    signal?: AbortSignal
  ): Promise<{ imageUrls: string[]; taskId: string }> {
    signal?.throwIfAborted();
    const taskId = await this.submitRawTask(input, signal);
    const imageUrls = await this.pollForResult(taskId, signal);
    return { imageUrls, taskId };
  }

  private async submitTask(
    request: ByteArtistImageRequest,
    signal?: AbortSignal
  ): Promise<string> {
    const adapter = getByteArtistModelAdapter(this.config.modelId);
    return this.submitRawTask(
      {
        image:
          request.image && adapter.supportsReferenceImages
            ? request.image
            : undefined,
        reqJson: adapter.buildReqJson({
          height: request.height,
          prompt: request.prompt,
          seed: this.config.seed,
          width: request.width,
        }),
      },
      signal
    );
  }

  private async submitRawTask(
    input: Omit<ByteArtistImageTaskInput, "signal">,
    signal?: AbortSignal
  ): Promise<string> {
    const formData = buildSignedFormParams(this.config);
    formData.append("req_json", JSON.stringify(input.reqJson));
    formData.append("expired_duration", String(this.config.expiredDuration));

    if (input.image) {
      appendByteArtistImageFormField(formData, input.image, input.imageField);
    }

    const data = await postByteArtistForm<ByteArtistSubmitResponse>({
      body: formData,
      signal,
      url: `${this.config.baseUrl}/media/api/pic/submit_task_v2`,
    });
    assertByteArtistOk("submit", data);

    const taskId = data.data?.task_id;
    if (!taskId) {
      throw new Error("ByteArtist did not return task_id.");
    }
    return taskId;
  }

  private async pollForResult(
    taskId: string,
    signal?: AbortSignal
  ): Promise<string[]> {
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt += 1) {
      signal?.throwIfAborted();
      const formData = buildSignedFormParams(this.config);
      formData.append("task_ids", taskId);

      const data = await postByteArtistForm<ByteArtistPollResponse>({
        body: formData,
        signal,
        url: `${this.config.baseUrl}/media/api/pic/batch_get_result_v2`,
      });
      assertByteArtistOk("poll", data);

      const result = readByteArtistResult(data, taskId);
      if (!result) {
        await waitBeforeNextPoll(attempt, this.config, signal);
        continue;
      }

      if (isByteArtistDoneStatus(result.status)) {
        const images = getByteArtistModelAdapter(
          this.config.modelId
        ).extractImages?.(result) ?? extractDefaultByteArtistImages(result);
        if (images.length) {
          return images;
        }
        throw new Error(
          `ByteArtist task completed but returned no image data: ${
            result.message ?? taskId
          }`
        );
      }

      if (isByteArtistFailedStatus(result.status)) {
        throw new Error(
          `ByteArtist task failed: ${result.message ?? String(result.status)}`
        );
      }

      await waitBeforeNextPoll(attempt, this.config, signal);
    }

    throw new Error(
      `ByteArtist task timed out after ${Math.round(
        (this.config.maxAttempts * this.config.pollIntervalMs) / 1000
      )} seconds.`
    );
  }
}

export async function generateByteArtistImage(
  input: ByteArtistGenerateInput,
  config = readByteArtistConfigFromEnv()
): Promise<{ images: ByteArtistGeneratedImage[] }> {
  if (!input.requests.length) {
    throw new Error("ByteArtist image request is empty.");
  }
  if (input.requests.length > config.maxOutputImages) {
    throw new Error(`一次最多生成 ${config.maxOutputImages} 张图片。`);
  }

  const client = new ByteArtistClient(config);
  const images: ByteArtistGeneratedImage[] = [];

  for (const request of input.requests) {
    input.signal?.throwIfAborted();
    const { imageUrls, taskId } = await client.submitAndPoll(
      request,
      input.signal
    );
    const selectedUrl = imageUrls[0];
    if (!selectedUrl) {
      throw new Error("ByteArtist returned no image URL.");
    }

    const image = buildByteArtistGeneratedImage({
      config,
      request,
      taskId,
      totalRequestedImageCount: input.totalRequestedImageCount,
      url: selectedUrl,
    });
    images.push(image);
    await input.onImage?.(image);
  }

  return { images };
}

export async function submitAndPollByteArtistImageTask(
  input: ByteArtistImageTaskInput,
  config = readByteArtistConfigFromEnv()
): Promise<{ imageUrls: string[]; taskId: string }> {
  const client = new ByteArtistClient(config);
  return client.submitRawAndPoll(
    {
      image: input.image,
      imageField: input.imageField,
      reqJson: input.reqJson,
    },
    input.signal
  );
}

export function isByteArtistConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(
    readOptionalEnv(env, "BYTEARTIST_BASE_URL", "GATEWAY_BASE_URL") &&
      readOptionalEnv(env, "BYTEARTIST_AID", "BYTEDANCE_AID") &&
      readOptionalEnv(env, "BYTEARTIST_APP_KEY", "BYTEDANCE_APP_KEY") &&
      readOptionalEnv(env, "BYTEARTIST_APP_SECRET", "BYTEDANCE_APP_SECRET")
  );
}

export function readByteArtistConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ByteArtistConfig {
  return {
    aid: readRequiredEnv(env, "BYTEARTIST_AID", "BYTEDANCE_AID"),
    appKey: readRequiredEnv(env, "BYTEARTIST_APP_KEY", "BYTEDANCE_APP_KEY"),
    appSecret: readRequiredEnv(
      env,
      "BYTEARTIST_APP_SECRET",
      "BYTEDANCE_APP_SECRET"
    ),
    baseUrl: trimTrailingSlash(
      readOptionalEnv(env, "BYTEARTIST_BASE_URL", "GATEWAY_BASE_URL")?.trim() ||
        DEFAULT_BYTEARTIST_BASE_URL
    ),
    expiredDuration: readNumberEnv(env, "BYTEARTIST_EXPIRED_DURATION", 600),
    height: readNumberEnv(env, "BYTEARTIST_HEIGHT", 1024),
    imageReturnFormat: env.BYTEARTIST_IMAGE_RETURN_FORMAT?.trim() || "png",
    imageReturnType: env.BYTEARTIST_IMAGE_RETURN_TYPE?.trim() || "url",
    maxAttempts: readNumberEnv(env, "BYTEARTIST_MAX_ATTEMPTS", 120),
    maxInputImages: readNumberEnv(env, "BYTEARTIST_MAX_INPUT_IMAGES", 1),
    maxOutputImages: readNumberEnv(env, "BYTEARTIST_MAX_OUTPUT_IMAGES", 4),
    modelId:
      env.IMAGE_MODEL?.trim() ||
      env.BYTEARTIST_MODEL?.trim() ||
      DEFAULT_BYTEARTIST_MODEL,
    pollIntervalMs: readNumberEnv(env, "BYTEARTIST_POLL_INTERVAL_MS", 1000),
    seed: readNumberEnv(env, "BYTEARTIST_SEED", -1),
    width: readNumberEnv(env, "BYTEARTIST_WIDTH", 1024),
  };
}

export function buildByteArtistReqJson({
  height,
  modelId,
  prompt,
  seed,
  width,
}: {
  height: number;
  modelId: string;
  prompt: string;
  seed: number;
  width: number;
}) {
  return getByteArtistModelAdapter(modelId).buildReqJson({
    height,
    prompt,
    seed,
    width,
  });
}

export function extractDefaultByteArtistImages(
  result: ByteArtistPollResultItem
) {
  const urls = (result.pic_urls ?? [])
    .map((item) => item.main_url || item.backup_url)
    .filter((url): url is string => Boolean(url?.trim()))
    .map((url) => url.trim());

  if (urls.length) {
    return urls;
  }

  return (result.binary_data ?? [])
    .filter((item) => item.trim().length > 0)
    .map((base64) => `data:image/png;base64,${base64.trim()}`);
}

function getByteArtistModelAdapter(modelId: string): ByteArtistModelAdapter {
  return (
    modelAdapters[modelId] ?? {
      buildReqJson: ({ height, prompt, seed, width }) => ({
        height,
        seed,
        string: prompt,
        width,
      }),
      supportsReferenceImages: true,
    }
  );
}

export function doesByteArtistModelSupportReferenceImages(modelId: string) {
  return getByteArtistModelAdapter(modelId).supportsReferenceImages;
}

function buildByteArtistGeneratedImage({
  config,
  request,
  taskId,
  totalRequestedImageCount,
  url,
}: {
  config: ByteArtistConfig;
  request: ByteArtistImageRequest;
  taskId: string;
  totalRequestedImageCount: number;
  url: string;
}): ByteArtistGeneratedImage {
  return {
    id: `byteartist-${Date.now()}-${request.promptIndex}`,
    metadata: {
      provider: "byteartist",
      model: config.modelId,
      taskId,
      width: request.width,
      height: request.height,
      ...(request.targetWidth !== undefined && request.targetHeight !== undefined
        ? {
            targetWidth: request.targetWidth,
            targetHeight: request.targetHeight,
          }
        : {}),
      inputImageCount: request.inputImageCount,
      requestedImageCount: 1,
      totalRequestedImageCount,
      promptIndex: request.promptIndex,
    },
    title:
      totalRequestedImageCount === 1
        ? "ByteArtist image"
        : `ByteArtist image ${request.promptIndex}`,
    url,
  };
}

function buildSignedFormParams(config: ByteArtistConfig) {
  const nonce = generateNonce();
  const timestamp = generateTimestamp();
  const sign = generateByteArtistSign(nonce, timestamp, config.appSecret);
  const formData = new URLSearchParams();
  formData.append("aid", config.aid);
  formData.append("app_key", config.appKey);
  formData.append("nonce", nonce);
  formData.append("timestamp", timestamp);
  formData.append("sign", sign);
  formData.append("req_key", config.modelId);
  formData.append("img_return_type", config.imageReturnType);
  formData.append("img_return_format", config.imageReturnFormat);
  return formData;
}

function generateByteArtistSign(
  nonce: string,
  timestamp: string,
  secretKey: string
) {
  return createHash("sha1")
    .update([nonce, timestamp, secretKey].sort().join(""))
    .digest("hex");
}

function generateNonce() {
  return Math.floor(Math.random() * 2_147_483_647).toString();
}

function generateTimestamp() {
  return Math.floor(Date.now() / 1000).toString();
}

function appendByteArtistImageFormField(
  formData: URLSearchParams,
  image: string,
  imageField?: ByteArtistImageTaskInput["imageField"]
) {
  if (imageField === "source" || (!imageField && isByteArtistSourceImage(image))) {
    formData.append("source", image);
    return;
  }

  formData.append("base64file", stripDataImagePrefix(image));
}

function isByteArtistSourceImage(image: string) {
  return /^(https?:|tos:)\/\//i.test(image);
}

function stripDataImagePrefix(image: string) {
  if (image.startsWith("data:")) {
    return image.split(",")[1] ?? image;
  }
  return image;
}

async function postByteArtistForm<T>({
  body,
  signal,
  url,
}: {
  body: URLSearchParams;
  signal?: AbortSignal;
  url: string;
}): Promise<T> {
  const response = await fetch(url, {
    body: body.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
    signal,
  });
  const text = await response.text();
  const data = parseJsonObject(text) as T & { message?: string; status_code?: number };

  if (!response.ok) {
    throw new Error(
      `ByteArtist request failed (${response.status} ${response.statusText}): ${
        data.message ?? truncateForError(text)
      }`
    );
  }

  return data;
}

function readByteArtistResult(
  data: ByteArtistPollResponse,
  taskId: string
): ByteArtistPollResultItem | null {
  const results = data.data?.results;
  if (Array.isArray(results)) {
    return results[0] ?? null;
  }
  if (results && typeof results === "object") {
    return results[taskId] ?? Object.values(results)[0] ?? null;
  }
  return null;
}

function isByteArtistDoneStatus(status: number | string | undefined) {
  return status === 1 || status === "done" || status === "DONE";
}

function isByteArtistFailedStatus(status: number | string | undefined) {
  return status === 2 || status === "failed" || status === "FAILED";
}

async function waitBeforeNextPoll(
  attempt: number,
  config: ByteArtistConfig,
  signal?: AbortSignal
) {
  if (attempt < config.maxAttempts) {
    await delay(config.pollIntervalMs, undefined, { signal });
  }
}

function assertByteArtistOk(
  step: "poll" | "submit",
  data: { message?: string; status_code?: number }
) {
  if (data.status_code !== 0) {
    throw new Error(
      `ByteArtist ${step} failed [${String(data.status_code)}]: ${
        data.message ?? "unknown error"
      }`
    );
  }
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { raw: text };
  } catch {
    return { raw: text };
  }
}

function truncateForError(text: string) {
  const trimmed = text.trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function readRequiredEnv(
  env: NodeJS.ProcessEnv,
  primary: string,
  fallback?: string
) {
  const value = readOptionalEnv(env, primary, fallback)?.trim();
  if (!value) {
    throw new Error(
      `${primary}${fallback ? ` or ${fallback}` : ""} is not configured.`
    );
  }
  return value;
}

function readOptionalEnv(
  env: NodeJS.ProcessEnv,
  primary: string,
  fallback?: string
) {
  return env[primary] ?? (fallback ? env[fallback] : undefined);
}

function readNumberEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number
) {
  const raw = env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
