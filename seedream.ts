import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { request } from "node:https";
import { setTimeout as delay } from "node:timers/promises";

export type SeedreamUpstreamContext = {
  nodeId: string;
  type: "prompt" | "image";
  prompt?: string;
  imageUrl?: string;
  summary?: string;
};

export type SeedreamGenerateInput = {
  prompts: string[];
  selectedNodeId?: string | null;
  upstreamContext?: SeedreamUpstreamContext[];
  resultCount: number;
  promptBatchMode: "single_prompt" | "distinct_prompts";
  // Optional callback invoked the moment each image finishes, so callers can
  // stream results to the UI instead of waiting for the whole batch.
  onImage?: (image: SeedreamGeneratedImage) => void;
};

export type SeedreamGeneratedImage = {
  id: string;
  url: string;
  title?: string;
  metadata?: Record<string, unknown>;
};

export type SeedreamConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  reqKey: string;
  host: string;
  region: string;
  service: string;
  version: string;
  width: number;
  height: number;
  forceSingle: boolean;
  maxInputImages: number;
  maxOutputImages: number;
  maxConcurrency: number;
  staggerMs: number;
  maxRetries: number;
  scale?: number;
};

type SignedPostResult = {
  status: number;
  body: Record<string, unknown>;
};

type HttpsPostResult = {
  status: number;
  text: string;
};

let cachedCaPath: string | undefined;
let cachedCa: Buffer | undefined;
let cachedInlineCa: string | undefined;

class SeedreamClient {
  private readonly config: SeedreamConfig;

  constructor(config: SeedreamConfig) {
    this.config = config;
  }

  async signedPost(
    action: "CVSync2AsyncSubmitTask" | "CVSync2AsyncGetResult",
    body: Record<string, unknown>
  ): Promise<SignedPostResult> {
    const payload = JSON.stringify(body);
    const payloadHash = createHash("sha256").update(payload).digest("hex");
    const now = new Date();
    const xDate = formatAmzDate(now);
    const dateStamp = xDate.slice(0, 8);
    const query = new URLSearchParams({
      Action: action,
      Version: this.config.version,
    }).toString();
    const contentType = "application/json";
    const signedHeaders = "content-type;host;x-content-sha256;x-date";
    const canonicalHeaders = [
      `content-type:${contentType}`,
      `host:${this.config.host}`,
      `x-content-sha256:${payloadHash}`,
      `x-date:${xDate}`,
      "",
    ].join("\n");
    const canonicalRequest = [
      "POST",
      "/",
      query,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const credentialScope = `${dateStamp}/${this.config.region}/${this.config.service}/request`;
    const stringToSign = [
      "HMAC-SHA256",
      xDate,
      credentialScope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");
    const signature = createHmac(
      "sha256",
      signingKey(
        this.config.secretAccessKey,
        dateStamp,
        this.config.region,
        this.config.service
      )
    )
      .update(stringToSign)
      .digest("hex");
    const authorization = [
      `HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(", ");

    const response = await signedHttpsPost(
      `https://${this.config.host}?${query}`,
      {
        Authorization: authorization,
        "Content-Type": contentType,
        Host: this.config.host,
        "X-Content-Sha256": payloadHash,
        "X-Date": xDate,
      },
      payload
    );

    const parsed = parseJsonObject(response.text);
    return { status: response.status, body: parsed };
  }

  async submitAndPoll(body: Record<string, unknown>) {
    const traceId = createHash("sha256")
      .update(`${this.config.reqKey}:${JSON.stringify(body)}:${Date.now()}`)
      .digest("hex")
      .slice(0, 12);
    const tag = `[seedream:${traceId}]`;

    console.log(
      `${tag} submit_start`,
      JSON.stringify({
        reqKey: this.config.reqKey,
        ...summarizeSeedreamBody(body),
      })
    );

    const submit = await this.submitWithRetry(body, tag);

    const taskId = getNestedString(submit.body, ["data", "task_id"]);
    if (!taskId) {
      throw new Error("Seedream did not return task_id.");
    }

    for (let attempt = 1; attempt <= 30; attempt++) {
      await delay(attempt <= 10 ? 4_000 : 8_000);
      const result = await this.signedPost("CVSync2AsyncGetResult", {
        req_key: this.config.reqKey,
        task_id: taskId,
        req_json: JSON.stringify({ return_url: true }),
      });
      const status = getNestedString(result.body, ["data", "status"]);

      console.log(
        `${tag} poll_response`,
        JSON.stringify({
          reqKey: this.config.reqKey,
          taskId,
          attempt,
          httpStatus: result.status,
          code: result.body.code ?? null,
          message:
            typeof result.body.message === "string"
              ? result.body.message
              : null,
          taskStatus: status ?? null,
          imageUrlCount: getNestedArray(result.body, ["data", "image_urls"])
            .length,
          requestId: getRequestId(result.body),
        })
      );
      assertSeedreamOk("poll", result);

      if (status === "done") {
        return result.body;
      }
      if (status === "not_found" || status === "expired") {
        throw new Error(`Seedream task ${status}: ${taskId}`);
      }
    }

    throw new Error(`Seedream task timed out: ${taskId}`);
  }

  // Submit a task, retrying with exponential backoff when Seedream rejects the
  // request because the account hit its API concurrency limit (code 50430 /
  // HTTP 429). Other failures propagate immediately.
  private async submitWithRetry(
    body: Record<string, unknown>,
    tag: string
  ): Promise<SignedPostResult> {
    for (let attempt = 0; ; attempt++) {
      const submit = await this.signedPost("CVSync2AsyncSubmitTask", {
        req_key: this.config.reqKey,
        ...body,
      });
      console.log(
        `${tag} submit_response`,
        JSON.stringify({
          reqKey: this.config.reqKey,
          httpStatus: submit.status,
          code: submit.body.code ?? null,
          message:
            typeof submit.body.message === "string"
              ? submit.body.message
              : null,
          requestId: getRequestId(submit.body),
          attempt,
        })
      );

      if (
        isSeedreamConcurrencyLimit(submit) &&
        attempt < this.config.maxRetries
      ) {
        // Exponential backoff with jitter: 1s, 2s, 4s, 8s (+0-500ms).
        const backoff = 1_000 * 2 ** attempt + Math.floor(Math.random() * 500);
        console.log(
          `${tag} submit_retry`,
          JSON.stringify({ attempt, backoffMs: backoff })
        );
        await delay(backoff);
        continue;
      }

      assertSeedreamOk("submit", submit);
      return submit;
    }
  }
}

export async function generateSeedreamImage(
  input: SeedreamGenerateInput,
  config = readSeedreamConfigFromEnv()
): Promise<{ images: SeedreamGeneratedImage[] }> {
  const requests = buildSeedreamRequestBodies(input, config);
  const client = new SeedreamClient(config);

  // Fan out one task per request so every image is generated independently.
  // Run them with a bounded concurrency and a stagger delay between submits to
  // stay under the Seedream account's API concurrency limit (code 50430).
  // Each task builds its own image and invokes `onImage` the moment it lands so
  // callers can stream results instead of waiting for the whole batch.
  const imagesPerRequest = await mapWithConcurrency(
    requests,
    config.maxConcurrency,
    config.staggerMs,
    async (request) => {
      const result = await client.submitAndPoll(request.body);
      const urls = getNestedArray(result, ["data", "image_urls"]).filter(
        (item): item is string => typeof item === "string" && item.length > 0
      );

      if (!urls.length) {
        throw new Error("Seedream returned no image URL.");
      }
      if (urls.length < request.resultCount) {
        throw new Error(
          `Seedream returned ${urls.length} image URL${
            urls.length === 1 ? "" : "s"
          }, but ${request.resultCount} were requested.`
        );
      }

      const selectedUrls = urls.slice(0, request.resultCount);
      const images = selectedUrls.map((url, offset) =>
        buildSeedreamGeneratedImage({
          url,
          // Each request maps to a single image, so promptIndex doubles as the
          // stable position within the overall batch.
          index: request.promptIndex + offset,
          request,
          config,
          totalRequestedImageCount: input.resultCount,
          promptBatchMode: input.promptBatchMode,
        })
      );

      for (const image of images) {
        input.onImage?.(image);
      }

      return images;
    }
  );

  return { images: imagesPerRequest.flat() };
}

function buildSeedreamGeneratedImage({
  url,
  index,
  request,
  config,
  totalRequestedImageCount,
  promptBatchMode,
}: {
  url: string;
  index: number;
  request: { body: Record<string, unknown>; imageUrls: string[]; resultCount: number; promptIndex: number };
  config: SeedreamConfig;
  totalRequestedImageCount: number;
  promptBatchMode: SeedreamGenerateInput["promptBatchMode"];
}): SeedreamGeneratedImage {
  const outputWidth = readPositiveNumber(request.body.width);
  const outputHeight = readPositiveNumber(request.body.height);
  const outputSize = readPositiveNumber(request.body.size);
  return {
    id: `seedream-${Date.now()}-${index}`,
    url,
    title:
      totalRequestedImageCount === 1
        ? "Seedream image"
        : `Seedream image ${index}`,
    metadata: {
      provider: "seedream",
      reqKey: config.reqKey,
      width: outputWidth,
      height: outputHeight,
      size: outputSize,
      inputImageCount: request.imageUrls.length,
      requestedImageCount: request.resultCount,
      totalRequestedImageCount,
      promptBatchMode,
      promptIndex: request.promptIndex,
    },
  };
}

// Map over items with a bounded number of in-flight tasks. Submits are spaced
// out by at least `staggerMs` via a shared gate so we never fire two requests
// at the same instant. Results preserve input order.
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  staggerMs: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  let nextIndex = 0;
  // Earliest timestamp (ms) at which the next task is allowed to start.
  let nextAllowedStart = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) {
        return;
      }
      if (staggerMs > 0) {
        const now = Date.now();
        const startAt = Math.max(now, nextAllowedStart);
        nextAllowedStart = startAt + staggerMs;
        const wait = startAt - now;
        if (wait > 0) {
          await delay(wait);
        }
      }
      results[index] = await task(items[index]);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

export function buildSeedreamRequestBodies(
  input: SeedreamGenerateInput,
  config: SeedreamConfig
) {
  const imageUrls = collectInputImageUrls(
    input.upstreamContext ?? [],
    config.maxInputImages
  );
  return resolveSeedreamPromptRequests(input, config.maxOutputImages).map(
    (request) => {
      const geometry = resolveSeedreamGeometry(request.prompt, config);
      const body: Record<string, unknown> = {
        prompt: request.prompt,
        force_single:
          request.resultCount === 1 ? config.forceSingle : false,
        ...geometry,
      };

      if (imageUrls.length) {
        body.image_urls = imageUrls;
      }
      if (config.scale !== undefined) {
        body.scale = config.scale;
      }

      return { ...request, body, imageUrls };
    }
  );
}

export function inferSeedreamResultCount(prompt: string, maxOutputImages = 4) {
  return inferSeedreamResultCountFromPrompts([prompt], maxOutputImages);
}

export function inferSeedreamResultCountFromPrompts(
  prompts: readonly string[],
  maxOutputImages = 4
) {
  for (const prompt of prompts) {
    const normalized = normalizeSeedreamPrompt(prompt);
    const explicitCount = findExplicitImageCount(normalized);

    if (!explicitCount) {
      continue;
    }
    if (explicitCount > maxOutputImages) {
      throw new Error(`一次最多生成 ${maxOutputImages} 张图片。`);
    }

    return explicitCount;
  }
  return 1;
}

function resolveSeedreamPromptRequests(
  input: SeedreamGenerateInput,
  maxOutputImages: number
) {
  if (!Number.isInteger(input.resultCount) || input.resultCount < 1) {
    throw new Error("Seedream resultCount must be a positive integer.");
  }
  if (input.resultCount > maxOutputImages) {
    throw new Error(`一次最多生成 ${maxOutputImages} 张图片。`);
  }

  const prompts = input.prompts.map(normalizeSeedreamPrompt).filter(Boolean);
  if (!prompts.length) {
    throw new Error("Seedream image prompt is empty.");
  }

  if (input.promptBatchMode === "distinct_prompts") {
    if (prompts.length !== input.resultCount) {
      throw new Error(
        "Seedream distinct prompt batch must include one prompt per requested image."
      );
    }

    return prompts.map((prompt, index) => ({
      prompt,
      promptIndex: index + 1,
      resultCount: 1,
    }));
  }

  if (prompts.length !== 1) {
    throw new Error("Seedream single prompt batch must include exactly one prompt.");
  }

  // Split the requested count into independent single-image requests so every
  // image is generated by its own task. This keeps the results independent and
  // lets the runtime fan them out in parallel.
  return Array.from({ length: input.resultCount }, (_, index) => ({
    prompt: prompts[0],
    promptIndex: index + 1,
    resultCount: 1,
  }));
}

function resolveSeedreamGeometry(prompt: string, config: SeedreamConfig) {
  const explicitDimensions = findExplicitDimensions(prompt);
  if (explicitDimensions) {
    return explicitDimensions;
  }

  const area = findExplicitOutputArea(prompt) ?? config.width * config.height;
  const aspectRatio = findExplicitAspectRatio(prompt);
  if (aspectRatio) {
    return dimensionsFromAspectRatio(aspectRatio, area);
  }

  if (findExplicitOutputArea(prompt)) {
    return { size: area };
  }

  return { width: config.width, height: config.height };
}

function findExplicitDimensions(prompt: string) {
  const dimensionMatch = prompt.match(
    /\b(\d{3,5})\s*(?:x|×|\*)\s*(\d{3,5})\b/i
  );
  if (!dimensionMatch) {
    return null;
  }

  const width = Number(dimensionMatch[1]);
  const height = Number(dimensionMatch[2]);
  validateSeedreamDimensions(width, height);
  return { width, height };
}

function findExplicitOutputArea(prompt: string) {
  if (/\b4\s*k\b|4k|4K|４K|４k/.test(prompt)) {
    return 4096 * 4096;
  }
  if (/\b2\s*k\b|2k|2K|２K|２k/.test(prompt)) {
    return 2048 * 2048;
  }
  if (/\b1\s*k\b|1k|1K|１K|１k/.test(prompt)) {
    return 1024 * 1024;
  }

  return null;
}

function findExplicitAspectRatio(prompt: string) {
  const ratioMatch = prompt.match(/\b(\d{1,2})\s*[:：]\s*(\d{1,2})\b/);
  if (ratioMatch) {
    const widthRatio = Number(ratioMatch[1]);
    const heightRatio = Number(ratioMatch[2]);
    if (widthRatio > 0 && heightRatio > 0) {
      return widthRatio / heightRatio;
    }
  }

  if (/(横版|横图|宽屏|landscape|wide)/i.test(prompt)) {
    return 16 / 9;
  }
  if (/(竖版|竖图|纵向|portrait|vertical)/i.test(prompt)) {
    return 9 / 16;
  }
  if (/(方图|方形|正方形|square)/i.test(prompt)) {
    return 1;
  }

  return null;
}

function dimensionsFromAspectRatio(aspectRatio: number, targetArea: number) {
  const boundedArea = Math.min(
    Math.max(Math.round(targetArea), 1024 * 1024),
    4096 * 4096
  );
  const height = Math.sqrt(boundedArea / aspectRatio);
  let width = Math.max(1, Math.round(height * aspectRatio));
  let roundedHeight = Math.max(1, Math.round(height));

  if (width * roundedHeight < 1024 * 1024) {
    const scale = Math.sqrt((1024 * 1024) / (width * roundedHeight));
    width = Math.ceil(width * scale);
    roundedHeight = Math.ceil(roundedHeight * scale);
  }
  if (width * roundedHeight > 4096 * 4096) {
    const scale = Math.sqrt((4096 * 4096) / (width * roundedHeight));
    width = Math.floor(width * scale);
    roundedHeight = Math.floor(roundedHeight * scale);
  }

  validateSeedreamDimensions(width, roundedHeight);
  return { width, height: roundedHeight };
}

function validateSeedreamDimensions(width: number, height: number) {
  const area = width * height;
  const aspectRatio = width / height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    area < 1024 * 1024 ||
    area > 4096 * 4096 ||
    aspectRatio < 1 / 16 ||
    aspectRatio > 16
  ) {
    throw new Error(
      "Seedream width and height must produce a 1K to 4K image within the supported aspect ratio."
    );
  }
}

function findExplicitImageCount(prompt: string) {
  const groupedArabicMatch = prompt.match(
    /(?:一|1)\s*组\s*(\d{1,2})\s*(?:张|幅|个|款|版|images?|imgs?|pictures?|results?)/i
  );
  if (groupedArabicMatch) {
    return Number(groupedArabicMatch[1]);
  }

  const groupedChineseMatch = prompt.match(
    /(?:一|1)\s*组\s*([一二两三四五六七八九十])\s*(?:张|幅|个|款|版|图片|图|结果)/
  );
  if (groupedChineseMatch) {
    return chineseImageCountToNumber(groupedChineseMatch[1]);
  }

  const arabicMatch = prompt.match(
    /(?:生成|出|要|做|给我|create|generate|make)?\s*(\d{1,2})\s*(?:张|幅|个|款|版|组|images?|imgs?|pictures?|results?)/i
  );
  if (arabicMatch) {
    return Number(arabicMatch[1]);
  }

  const chineseMatch = prompt.match(
    /(?:生成|出|要|做|给我)?\s*([一二两三四五六七八九十])\s*(?:张|幅|个|款|版|组|图片|图|结果)/
  );
  if (chineseMatch) {
    return chineseImageCountToNumber(chineseMatch[1]);
  }

  return null;
}

function chineseImageCountToNumber(value: string) {
  const numbers: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };

  return numbers[value] ?? null;
}

export function isSeedreamConfigured() {
  return Boolean(
    readOptionalEnv("SEEDREAM_ACCESS_KEY_ID", "VOLCENGINE_ACCESS_KEY_ID") &&
      readOptionalEnv("SEEDREAM_SECRET_ACCESS_KEY", "VOLCENGINE_SECRET_ACCESS_KEY")
  );
}

export function readSeedreamMaxOutputImagesFromEnv() {
  return readNumberEnv("SEEDREAM_MAX_OUTPUT_IMAGES", 4);
}

function readSeedreamConfigFromEnv(): SeedreamConfig {
  const accessKeyId = readRequiredEnv(
    "SEEDREAM_ACCESS_KEY_ID",
    "VOLCENGINE_ACCESS_KEY_ID"
  );
  const secretAccessKey = readRequiredEnv(
    "SEEDREAM_SECRET_ACCESS_KEY",
    "VOLCENGINE_SECRET_ACCESS_KEY"
  );

  return {
    accessKeyId,
    secretAccessKey,
    reqKey: process.env.SEEDREAM_REQ_KEY ?? "jimeng_seedream46_cvtob",
    host: process.env.SEEDREAM_HOST ?? "visual.volcengineapi.com",
    region: process.env.SEEDREAM_REGION ?? "cn-north-1",
    service: process.env.SEEDREAM_SERVICE ?? "cv",
    version: process.env.SEEDREAM_VERSION ?? "2022-08-31",
    width: readNumberEnv("SEEDREAM_WIDTH", 1024),
    height: readNumberEnv("SEEDREAM_HEIGHT", 1024),
    forceSingle: process.env.SEEDREAM_FORCE_SINGLE !== "false",
    maxInputImages: readNumberEnv("SEEDREAM_MAX_INPUT_IMAGES", 14),
    maxOutputImages: readSeedreamMaxOutputImagesFromEnv(),
    maxConcurrency: Math.max(1, readNumberEnv("SEEDREAM_MAX_CONCURRENCY", 2)),
    staggerMs: Math.max(0, readNumberEnv("SEEDREAM_STAGGER_MS", 800)),
    maxRetries: Math.max(0, readNumberEnv("SEEDREAM_MAX_RETRIES", 4)),
    scale: readOptionalNumberEnv("SEEDREAM_SCALE"),
  };
}

function collectInputImageUrls(
  upstreamContext: SeedreamUpstreamContext[],
  limit: number
) {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const item of upstreamContext) {
    if (item.type !== "image" || !item.imageUrl || seen.has(item.imageUrl)) {
      continue;
    }
    seen.add(item.imageUrl);
    urls.push(item.imageUrl);
    if (urls.length >= limit) {
      break;
    }
  }

  return urls;
}

function normalizeSeedreamPrompt(prompt: string) {
  return Array.from(prompt, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? " " : char;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function readRequiredEnv(primary: string, fallback?: string) {
  const value = readOptionalEnv(primary, fallback);
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

function readOptionalNumberEnv(name: string) {
  const raw = process.env[name];
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function signingKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
) {
  const kDate = hmac(secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "request");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function formatAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
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

function signedHttpsPost(
  url: string,
  headers: Record<string, string>,
  body: string
): Promise<HttpsPostResult> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        headers,
        ca: readCustomCaFromEnv(),
        timeout: 120_000,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, text });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Seedream request timed out: ${new URL(url).host}`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function readCustomCaFromEnv() {
  const caPem = process.env.SEEDREAM_CA_CERT_PEM;
  if (caPem) {
    if (cachedInlineCa === caPem) {
      return cachedCa;
    }

    cachedCaPath = undefined;
    cachedInlineCa = caPem;
    cachedCa = Buffer.from(caPem.replaceAll("\\n", "\n"));
    return cachedCa;
  }

  const caPath = process.env.SEEDREAM_CA_CERT ?? process.env.NODE_EXTRA_CA_CERTS;
  if (!caPath) {
    return undefined;
  }
  if (cachedCaPath === caPath) {
    return cachedCa;
  }
  if (!existsSync(caPath)) {
    throw new Error(`TLS CA certificate file not found: ${caPath}`);
  }

  cachedCaPath = caPath;
  cachedInlineCa = undefined;
  cachedCa = readFileSync(caPath);
  return cachedCa;
}

function assertSeedreamOk(step: string, result: SignedPostResult) {
  const code = result.body.code;
  if (result.status !== 200 || code !== 10000) {
    const message =
      typeof result.body.message === "string"
        ? result.body.message
        : JSON.stringify(result.body);
    const requestId = getRequestId(result.body);
    throw new Error(
      `Seedream ${step} failed (${result.status}/${String(code)}${
        requestId ? ` request_id=${requestId}` : ""
      }): ${message}`
    );
  }
}

function isSeedreamConcurrencyLimit(result: SignedPostResult): boolean {
  if (result.status === 429 || result.body.code === 50430) {
    return true;
  }
  const message =
    typeof result.body.message === "string" ? result.body.message : "";
  return /concurrent limit/i.test(message);
}

function getRequestId(source: Record<string, unknown>): string | undefined {
  const requestId = source.request_id;
  return typeof requestId === "string" ? requestId : undefined;
}

function summarizeSeedreamBody(body: Record<string, unknown>) {
  const imageUrls = Array.isArray(body.image_urls) ? body.image_urls : [];
  return {
    hasPrompt: typeof body.prompt === "string" && body.prompt.length > 0,
    promptLength: typeof body.prompt === "string" ? body.prompt.length : 0,
    imageCount: imageUrls.length,
    width: typeof body.width === "number" ? body.width : null,
    height: typeof body.height === "number" ? body.height : null,
    size: typeof body.size === "number" ? body.size : null,
    scale: typeof body.scale === "number" ? body.scale : null,
    forceSingle: body.force_single === true,
  };
}

function getNestedString(
  source: Record<string, unknown>,
  path: string[]
): string | undefined {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : undefined;
}

function getNestedArray(
  source: Record<string, unknown>,
  path: string[]
): unknown[] {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return [];
    }
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? current : [];
}
