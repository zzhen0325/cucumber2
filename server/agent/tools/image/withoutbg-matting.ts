import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type WithoutBgMattingInput = {
  background?: "transparent" | "white" | "neutral";
  height?: number;
  sourceUrl: string;
  signal?: AbortSignal;
  width?: number;
};

type WithoutBgMattingResult = {
  bytes: Uint8Array;
  engine: "withoutbg";
  metadata: Record<string, unknown>;
  mimeType: "image/png";
};

const defaultTimeoutMs = 90_000;
const apiEndpoint = "https://api.withoutbg.com/v1.0/image-without-background";

export async function runWithoutBgMatting({
  background = "transparent",
  height,
  signal,
  sourceUrl,
  width,
}: WithoutBgMattingInput): Promise<WithoutBgMattingResult> {
  const source = await downloadSourceImage(sourceUrl, signal);
  if (process.env.WITHOUTBG_API_KEY && background === "transparent" && !width && !height) {
    const bytes = await runWithoutBgApi(source, signal);
    return {
      bytes,
      engine: "withoutbg",
      metadata: {
        engine: "withoutbg",
        provider: "withoutbg-api",
      },
      mimeType: "image/png",
    };
  }
  return runWithoutBgLocal({
    background,
    height,
    signal,
    source,
    width,
  });
}

async function downloadSourceImage(sourceUrl: string, signal?: AbortSignal) {
  const response = await fetch(sourceUrl, { signal });
  if (!response.ok) {
    throw new Error(
      `Failed to download source image for matting (${response.status} ${response.statusText}).`
    );
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (mimeType && !mimeType.startsWith("image/")) {
    throw new Error(`Source asset is not an image (${mimeType}).`);
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: mimeType || "image/png",
  };
}

async function runWithoutBgApi(
  source: { bytes: Uint8Array; mimeType: string },
  signal?: AbortSignal
) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([source.bytes], { type: source.mimeType }),
    "source-image"
  );
  const response = await fetch(apiEndpoint, {
    body: form,
    headers: {
      "X-API-Key": process.env.WITHOUTBG_API_KEY ?? "",
    },
    method: "POST",
    signal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `withoutBG API matting failed (${response.status} ${response.statusText}). ${body}`.trim()
    );
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (mimeType && !mimeType.startsWith("image/")) {
    throw new Error(`withoutBG API returned a non-image response (${mimeType}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function runWithoutBgLocal({
  background,
  height,
  signal,
  source,
  width,
}: {
  background: "transparent" | "white" | "neutral";
  height?: number;
  signal?: AbortSignal;
  source: { bytes: Uint8Array; mimeType: string };
  width?: number;
}): Promise<WithoutBgMattingResult> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "cucumber-withoutbg-"));
  const inputPath = path.join(tempDir, "input.image");
  const outputPath = path.join(tempDir, "foreground.png");
  try {
    await writeFile(inputPath, source.bytes);
    const metadata = await runWithoutBgProcess({
      background,
      height,
      inputPath,
      outputPath,
      signal,
      width,
    });
    const bytes = await readFile(outputPath);
    return {
      bytes: new Uint8Array(bytes),
      engine: "withoutbg",
      metadata,
      mimeType: "image/png",
    };
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function runWithoutBgProcess({
  background,
  height,
  inputPath,
  outputPath,
  signal,
  width,
}: {
  background: "transparent" | "white" | "neutral";
  height?: number;
  inputPath: string;
  outputPath: string;
  signal?: AbortSignal;
  width?: number;
}) {
  const scriptPath = fileURLToPath(new URL("./withoutbg_matting.py", import.meta.url));
  const python = process.env.WITHOUTBG_PYTHON ?? process.env.PYTHON ?? "python3";
  const args = [
    scriptPath,
    "--input",
    inputPath,
    "--output",
    outputPath,
    "--background",
    background,
  ];
  if (width && height) {
    args.push("--width", String(width), "--height", String(height));
  }

  const timeoutMs = Number.parseInt(
    process.env.WITHOUTBG_TIMEOUT_MS ?? String(defaultTimeoutMs),
    10
  );
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(python, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      fn();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() =>
        reject(new Error(`withoutBG matting timed out after ${timeoutMs}ms.`))
      );
    }, timeoutMs);
    const abort = () => {
      child.kill("SIGTERM");
      finish(() => reject(new Error("withoutBG matting was aborted.")));
    };
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
                `withoutBG matting process failed with exit code ${code}.`,
                stderr.trim() || stdout.trim(),
              ]
                .filter(Boolean)
                .join(" ")
            )
          );
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
          resolve(parsed);
        } catch {
          resolve({ rawOutput: stdout.trim() });
        }
      });
    });
  });
}

export function createWithoutBgArtifactId() {
  return `withoutbg-matting-${randomUUID().slice(0, 12)}`;
}
