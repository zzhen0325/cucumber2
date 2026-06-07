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
  prompt: string;
  selectedNodeId?: string | null;
  upstreamContext?: SeedreamUpstreamContext[];
};

export type SeedreamGeneratedImage = {
  id: string;
  url: string;
  title?: string;
  metadata?: Record<string, unknown>;
};

type SeedreamConfig = {
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
          typeof submit.body.message === "string" ? submit.body.message : null,
        requestId: getRequestId(submit.body),
      })
    );
    assertSeedreamOk("submit", submit);

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
}

export async function generateSeedreamImage(
  input: SeedreamGenerateInput,
  config = readSeedreamConfigFromEnv()
): Promise<{ images: SeedreamGeneratedImage[] }> {
  const prompt = normalizeSeedreamPrompt(input.prompt);
  if (!prompt) {
    throw new Error("Seedream image prompt is empty.");
  }

  const imageUrls = collectInputImageUrls(
    input.upstreamContext ?? [],
    config.maxInputImages
  );
  const body: Record<string, unknown> = {
    prompt,
    width: config.width,
    height: config.height,
    force_single: config.forceSingle,
  };

  if (imageUrls.length) {
    body.image_urls = imageUrls;
  }

  const result = await new SeedreamClient(config).submitAndPoll(body);
  const url = getNestedArray(result, ["data", "image_urls"]).find(
    (item): item is string => typeof item === "string" && item.length > 0
  );

  if (!url) {
    throw new Error("Seedream returned no image URL.");
  }

  return {
    images: [
      {
        id: `seedream-${Date.now()}`,
        url,
        title: "Seedream image",
        metadata: {
          provider: "seedream",
          reqKey: config.reqKey,
          width: config.width,
          height: config.height,
          inputImageCount: imageUrls.length,
        },
      },
    ],
  };
}

export function isSeedreamConfigured() {
  return Boolean(
    readOptionalEnv("SEEDREAM_ACCESS_KEY_ID", "VOLCENGINE_ACCESS_KEY_ID") &&
      readOptionalEnv("SEEDREAM_SECRET_ACCESS_KEY", "VOLCENGINE_SECRET_ACCESS_KEY")
  );
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
    .trim()
    .slice(0, 800);
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
