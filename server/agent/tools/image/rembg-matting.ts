import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ImageMattingBackground,
  ImageMattingRunInput,
  ImageMattingRunResult,
} from "./image-matting-provider.ts";

export type RembgMattingConfig = {
  alphaBackgroundThreshold?: number;
  alphaErodeSize?: number;
  alphaForegroundThreshold?: number;
  alphaMatting: boolean;
  bin: string;
  healthCheckTimeoutMs: number;
  model: string;
  postProcessMask: boolean;
  timeoutMs: number;
};

const defaultTimeoutMs = 120_000;
const defaultHealthCheckTimeoutMs = 10_000;

export function readRembgMattingConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): RembgMattingConfig {
  return {
    alphaBackgroundThreshold: readOptionalInteger(
      env.REMBG_ALPHA_BACKGROUND_THRESHOLD
    ),
    alphaErodeSize: readOptionalInteger(env.REMBG_ALPHA_ERODE_SIZE),
    alphaForegroundThreshold: readOptionalInteger(
      env.REMBG_ALPHA_FOREGROUND_THRESHOLD
    ),
    alphaMatting: readBoolean(env.REMBG_ALPHA_MATTING, true),
    bin: env.REMBG_BIN?.trim() || "rembg",
    healthCheckTimeoutMs:
      readOptionalInteger(env.REMBG_HEALTHCHECK_TIMEOUT_MS) ??
      defaultHealthCheckTimeoutMs,
    model: env.REMBG_MODEL?.trim() || "u2net",
    postProcessMask: readBoolean(env.REMBG_POST_PROCESS_MASK, false),
    timeoutMs: readOptionalInteger(env.REMBG_TIMEOUT_MS) ?? defaultTimeoutMs,
  };
}

export function isRembgCliConfigured(config = readRembgMattingConfigFromEnv()) {
  const result = spawnSync(config.bin, ["--version"], {
    stdio: "ignore",
    timeout: config.healthCheckTimeoutMs,
  });
  return !result.error && result.status === 0;
}

export async function runRembgCliMatting(
  input: ImageMattingRunInput,
  config = readRembgMattingConfigFromEnv()
): Promise<ImageMattingRunResult> {
  assertSupportedRembgOptions(input);
  const background = input.background ?? "transparent";
  const source = await downloadSourceImage(input.sourceUrl, input.signal);
  const tempDir = await mkdtemp(path.join(tmpdir(), "cucumber-rembg-"));
  const inputPath = path.join(tempDir, "source.image");
  const outputPath = path.join(tempDir, "foreground.png");

  try {
    await writeFile(inputPath, source.bytes);
    await runRembgCliProcess({
      background,
      config,
      inputPath,
      outputPath,
      signal: input.signal,
    });
    const bytes = new Uint8Array(await readFile(outputPath));
    if (bytes.byteLength === 0) {
      throw new Error("rembg CLI produced an empty output image.");
    }
    return {
      bytes,
      engine: "rembg",
      metadata: {
        background,
        engine: "rembg",
        model: config.model,
        provider: "rembg-cli",
        rembgAlphaMatting: config.alphaMatting,
        rembgPostProcessMask: config.postProcessMask,
      },
      mimeType: "image/png",
      provider: "rembg-cli",
    };
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

export function buildRembgCliArgs({
  background,
  config,
  inputPath,
  outputPath,
}: {
  background: ImageMattingBackground;
  config: RembgMattingConfig;
  inputPath: string;
  outputPath: string;
}) {
  const args = ["i", "--model", config.model];
  if (config.alphaMatting) {
    args.push("--alpha-matting");
    if (config.alphaForegroundThreshold !== undefined) {
      args.push(
        "--alpha-matting-foreground-threshold",
        String(config.alphaForegroundThreshold)
      );
    }
    if (config.alphaBackgroundThreshold !== undefined) {
      args.push(
        "--alpha-matting-background-threshold",
        String(config.alphaBackgroundThreshold)
      );
    }
    if (config.alphaErodeSize !== undefined) {
      args.push("--alpha-matting-erode-size", String(config.alphaErodeSize));
    }
  }
  if (config.postProcessMask) {
    args.push("--post-process-mask");
  }
  const backgroundColor = getRembgBackgroundColor(background);
  if (backgroundColor) {
    args.push("--bgcolor", ...backgroundColor.map(String));
  }
  args.push(inputPath, outputPath);
  return args;
}

async function downloadSourceImage(sourceUrl: string, signal?: AbortSignal) {
  const response = await fetch(sourceUrl, { signal });
  if (!response.ok) {
    throw new Error(
      `Failed to download source image for matting (${response.status} ${response.statusText}).`
    );
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim();
  if (mimeType && !mimeType.startsWith("image/")) {
    throw new Error(`Source asset is not an image (${mimeType}).`);
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: mimeType || "image/png",
  };
}

async function runRembgCliProcess({
  background,
  config,
  inputPath,
  outputPath,
  signal,
}: {
  background: ImageMattingBackground;
  config: RembgMattingConfig;
  inputPath: string;
  outputPath: string;
  signal?: AbortSignal;
}) {
  const args = buildRembgCliArgs({ background, config, inputPath, outputPath });
  return new Promise<void>((resolve, reject) => {
    const child = spawn(config.bin, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() =>
        reject(new Error(`rembg matting timed out after ${config.timeoutMs}ms.`))
      );
    }, config.timeoutMs);
    const abort = () => {
      child.kill("SIGTERM");
      finish(() => reject(new Error("rembg matting was aborted.")));
    };
    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      fn();
    };

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${String(chunk)}`.slice(-16_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-16_000);
    });
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          reject(
            new Error(
              [
                `rembg matting process failed with exit code ${code}.`,
                stderr.trim() || stdout.trim(),
              ]
                .filter(Boolean)
                .join(" ")
            )
          );
          return;
        }
        resolve();
      });
    });
  });
}

function assertSupportedRembgOptions(input: ImageMattingRunInput) {
  if (input.aspectRatio || input.width || input.height) {
    throw new Error(
      "unsupported_image_matting_dimensions: rembg CLI preserves source dimensions; omit aspectRatio, width, and height."
    );
  }
}

function getRembgBackgroundColor(background: ImageMattingBackground) {
  if (background === "transparent") {
    return null;
  }
  return background === "white" ? [255, 255, 255, 255] : [242, 242, 239, 255];
}

function readBoolean(value: string | undefined, defaultValue: boolean) {
  if (value === undefined || !value.trim()) {
    return defaultValue;
  }
  if (/^(1|true|yes|on)$/i.test(value)) {
    return true;
  }
  if (/^(0|false|no|off)$/i.test(value)) {
    return false;
  }
  return defaultValue;
}

function readOptionalInteger(value: string | undefined) {
  if (value === undefined || !value.trim()) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
