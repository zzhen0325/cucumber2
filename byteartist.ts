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
  images?: string[];
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
  generateStaggerMs: number;
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
  imageField?: "base64file" | "files" | "source";
  images?: string[];
  reqJson: Record<string, unknown>;
  signal?: AbortSignal;
};

type ByteArtistSubmitResponse = {
  data?: { task_id?: string };
  message?: string;
  status_code?: number;
};

export type ByteArtistPollResultItem = {
  algo_status_code?: number;
  algo_status_message?: string;
  binary_data?: string[];
  req_key?: string;
  message?: string;
  pic_urls?: Array<{ backup_url?: string; main_url?: string }>;
  status?: number | string;
  status_code?: number;
  status_message?: string;
  task_id?: string;
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
  defaultHeight: number;
  defaultWidth: number;
  extractImages?: (result: ByteArtistPollResultItem) => string[];
  maxInputImages: number;
  referenceImageTransport?: "multipart_files" | "single_source";
  supportsReferenceImages: boolean;
};

export const BYTEARTIST_LEMO_MODEL = "seed4_0407_lemo";
export const BYTEARTIST_MATTING_MODEL = "image_matting_lemo";
export const BYTEARTIST_SEED5_DUOTU_MODEL = "seed5_duotu_zz";
const DEFAULT_BYTEARTIST_MODEL = BYTEARTIST_LEMO_MODEL;
const DEFAULT_BYTEARTIST_BASE_URL = "https://lv-api-lf.ulikecam.com";
const DEFAULT_BYTEARTIST_GENERATE_STAGGER_MS = 800;

const modelAdapters: Record<string, ByteArtistModelAdapter> = {
  [BYTEARTIST_LEMO_MODEL]: {
    buildReqJson: ({ height, prompt, seed, width }) => ({
      Prompt: prompt,
      height,
      seed,
      width,
    }),
    defaultHeight: 1024,
    defaultWidth: 1024,
    maxInputImages: 1,
    supportsReferenceImages: false,
  },
  [BYTEARTIST_SEED5_DUOTU_MODEL]: {
    buildReqJson: ({ height, prompt, width }) => ({
      extra_inputs: {
        height,
        width,
      },
      user_prompt: prompt,
    }),
    defaultHeight: 2048,
    defaultWidth: 2048,
    maxInputImages: 6,
    referenceImageTransport: "multipart_files",
    supportsReferenceImages: true,
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
    const images = adapter.supportsReferenceImages
      ? collectRequestImages(request).slice(0, adapter.maxInputImages)
      : [];
    const useMultipartImages =
      images.length > 0 && adapter.referenceImageTransport === "multipart_files";
    return this.submitRawTask(
      {
        image: !useMultipartImages ? images[0] : undefined,
        imageField: useMultipartImages ? "files" : undefined,
        images: useMultipartImages ? images : undefined,
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
    const usesMultipart = input.imageField === "files";
    const formData = buildSignedFormParams(this.config, usesMultipart);
    appendTextFormField(formData, "req_json", JSON.stringify(input.reqJson));
    appendTextFormField(
      formData,
      "expired_duration",
      String(this.config.expiredDuration)
    );

    if (input.images?.length) {
      if (!(formData instanceof FormData)) {
        throw new Error("ByteArtist multi-image upload requires multipart form data.");
      }
      await appendByteArtistImageFiles(formData, input.images, signal);
    } else if (input.image) {
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
      appendTextFormField(formData, "task_ids", taskId);

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
        const providerError = readByteArtistResultProviderError(result);
        if (providerError) {
          throw new Error(providerError);
        }
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
  const images = await Promise.all(
    input.requests.map(async (request, index) => {
      if (index > 0 && config.generateStaggerMs > 0) {
        await delay(index * config.generateStaggerMs, undefined, {
          signal: input.signal,
        });
      }
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
      await input.onImage?.(image);
      return image;
    })
  );

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
      images: input.images,
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
  const modelId =
    env.IMAGE_MODEL?.trim() ||
    env.BYTEARTIST_MODEL?.trim() ||
    DEFAULT_BYTEARTIST_MODEL;
  const adapter = getByteArtistModelAdapter(modelId);
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
    generateStaggerMs: Math.max(
      0,
      readNumberEnv(
        env,
        "BYTEARTIST_GENERATE_STAGGER_MS",
        DEFAULT_BYTEARTIST_GENERATE_STAGGER_MS
      )
    ),
    height: readNumberEnv(env, "BYTEARTIST_HEIGHT", adapter.defaultHeight),
    imageReturnFormat: env.BYTEARTIST_IMAGE_RETURN_FORMAT?.trim() || "png",
    imageReturnType: env.BYTEARTIST_IMAGE_RETURN_TYPE?.trim() || "url",
    maxAttempts: readNumberEnv(env, "BYTEARTIST_MAX_ATTEMPTS", 120),
    maxInputImages: readNumberEnv(
      env,
      "BYTEARTIST_MAX_INPUT_IMAGES",
      adapter.maxInputImages
    ),
    maxOutputImages: readNumberEnv(env, "BYTEARTIST_MAX_OUTPUT_IMAGES", 4),
    modelId,
    pollIntervalMs: readNumberEnv(env, "BYTEARTIST_POLL_INTERVAL_MS", 1000),
    seed: readNumberEnv(env, "BYTEARTIST_SEED", -1),
    width: readNumberEnv(env, "BYTEARTIST_WIDTH", adapter.defaultWidth),
  };
}

export function withByteArtistModelConfig(
  config: ByteArtistConfig,
  modelId: string
): ByteArtistConfig {
  const adapter = getByteArtistModelAdapter(modelId);
  return {
    ...config,
    height: adapter.defaultHeight,
    maxInputImages: Math.max(config.maxInputImages, adapter.maxInputImages),
    modelId,
    width: adapter.defaultWidth,
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
      defaultHeight: 1024,
      defaultWidth: 1024,
      maxInputImages: 1,
      referenceImageTransport: "single_source",
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

function buildSignedFormParams(config: ByteArtistConfig, multipart = false) {
  const nonce = generateNonce();
  const timestamp = generateTimestamp();
  const sign = generateByteArtistSign(nonce, timestamp, config.appSecret);
  const formData = multipart ? new FormData() : new URLSearchParams();
  appendTextFormField(formData, "aid", config.aid);
  appendTextFormField(formData, "app_key", config.appKey);
  appendTextFormField(formData, "nonce", nonce);
  appendTextFormField(formData, "timestamp", timestamp);
  appendTextFormField(formData, "sign", sign);
  appendTextFormField(formData, "req_key", config.modelId);
  appendTextFormField(formData, "img_return_type", config.imageReturnType);
  appendTextFormField(formData, "img_return_format", config.imageReturnFormat);
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
  formData: URLSearchParams | FormData,
  image: string,
  imageField?: ByteArtistImageTaskInput["imageField"]
) {
  if (imageField === "files") {
    throw new Error("ByteArtist files upload requires images[].");
  }
  if (imageField === "source" || (!imageField && isByteArtistSourceImage(image))) {
    appendTextFormField(formData, "source", image);
    return;
  }

  appendTextFormField(formData, "base64file", stripDataImagePrefix(image));
}

async function appendByteArtistImageFiles(
  formData: FormData,
  images: string[],
  signal?: AbortSignal
) {
  appendTextFormField(formData, "input_img_type", "multiple_files");
  const uniqueImages = uniqueNonEmpty(images);

  for (const [index, image] of uniqueImages.entries()) {
    const { blob, extension } = await readImageAsBlob(image, signal);
    formData.append("files[]", blob, `reference-${index + 1}.${extension}`);
  }
}

async function readImageAsBlob(image: string, signal?: AbortSignal) {
  const dataUrlMatch = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    const mimeType = dataUrlMatch[1];
    const bytes = Buffer.from(dataUrlMatch[2], "base64");
    return {
      blob: new Blob([bytes], { type: mimeType }),
      extension: extensionFromMimeType(mimeType),
    };
  }

  if (!/^https?:\/\//i.test(image)) {
    throw new Error(
      "ByteArtist multi-image upload requires HTTP(S) or data image references."
    );
  }

  const response = await fetch(image, { signal });
  if (!response.ok) {
    throw new Error(
      `ByteArtist failed to download reference image (${response.status} ${response.statusText}).`
    );
  }
  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  const bytes = await response.arrayBuffer();
  return {
    blob: new Blob([bytes], { type: mimeType }),
    extension: extensionFromMimeType(mimeType),
  };
}

function extensionFromMimeType(mimeType: string) {
  if (/jpe?g$/i.test(mimeType)) {
    return "jpg";
  }
  if (/webp$/i.test(mimeType)) {
    return "webp";
  }
  if (/gif$/i.test(mimeType)) {
    return "gif";
  }
  return "png";
}

function appendTextFormField(
  formData: URLSearchParams | FormData,
  name: string,
  value: string
) {
  formData.append(name, value);
}

function collectRequestImages(request: ByteArtistImageRequest) {
  return uniqueNonEmpty([
    ...(request.images ?? []),
    ...(request.image ? [request.image] : []),
  ]);
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
  body: URLSearchParams | FormData;
  signal?: AbortSignal;
  url: string;
}): Promise<T> {
  const isMultipart = body instanceof FormData;
  const response = await fetch(url, {
    body: isMultipart ? body : body.toString(),
    headers: isMultipart
      ? undefined
      : { "Content-Type": "application/x-www-form-urlencoded" },
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

function readByteArtistResultProviderError(result: ByteArtistPollResultItem) {
  const statusCode =
    typeof result.status_code === "number" ? result.status_code : undefined;
  const algoStatusCode =
    typeof result.algo_status_code === "number"
      ? result.algo_status_code
      : undefined;
  const statusMessage = normalizeErrorMessage(
    result.status_message ?? result.algo_status_message ?? result.message
  );

  if (statusCode !== undefined && statusCode !== 0) {
    return `ByteArtist task completed with provider error [${statusCode}]: ${
      statusMessage ?? "unknown error"
    }`;
  }
  if (algoStatusCode !== undefined && algoStatusCode !== 0) {
    return `ByteArtist task completed with algorithm error [${algoStatusCode}]: ${
      statusMessage ?? "unknown error"
    }`;
  }
  return null;
}

function normalizeErrorMessage(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
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

function uniqueNonEmpty(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
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
