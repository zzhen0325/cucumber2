import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import JSZip from "jszip";
import { z } from "zod";

import type { CanvasOperation } from "../../../src/types/runtime.ts";
import { downloadAgentSkillPackage } from "../../storage.ts";
import type { ActivatedAgentSkill } from "./types.ts";

export const SKILL_SCRIPT_TIMEOUT_MS = 15_000;
export const SKILL_SCRIPT_OUTPUT_LIMIT_BYTES = 256 * 1024;
const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

const scriptOutputSchema = z.object({
  canvasOperations: z.array(z.unknown()).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  status: z.literal("ok"),
  summary: z.string().min(1).max(4000),
});

export type SkillScriptOutput = z.infer<typeof scriptOutputSchema> & {
  canvasOperations?: CanvasOperation[];
};

export async function runSkillScript({
  args,
  input,
  scriptName,
  skill,
  signal,
  stdin,
}: {
  args?: string[];
  input: unknown;
  scriptName: string;
  skill: ActivatedAgentSkill;
  signal?: AbortSignal;
  stdin?: string;
}): Promise<SkillScriptOutput> {
  await assertSandboxAvailable();
  const script = skill.scripts.find((candidate) => candidate.name === scriptName);
  if (!script) {
    throw new Error(`Skill ${skill.name} does not expose script ${scriptName}.`);
  }
  if (!skill.packageBucket || !skill.packagePath || !skill.packageSha256) {
    throw new Error(`Skill ${skill.name} does not have an executable package.`);
  }

  const packageBytes = await downloadAgentSkillPackage({
    bucket: skill.packageBucket,
    path: skill.packagePath,
  });
  const actualSha256 = createHash("sha256").update(packageBytes).digest("hex");
  if (actualSha256 !== skill.packageSha256) {
    throw new Error(`Skill package hash mismatch for ${skill.name}.`);
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "cucumber-skill-"));
  try {
    const entryPath = await extractSkillPackage({
      packageBytes,
      scriptPath: script.path,
      tempDir,
    });
    const result = await runScriptProcess({
      args: args ?? [],
      input,
      runtime: script.runtime,
      scriptPath: entryPath,
      signal,
      stdin,
      tempDir,
    });
    return parseScriptOutput(result.stdout, result.stderr);
  } finally {
    await rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

async function extractSkillPackage({
  packageBytes,
  scriptPath,
  tempDir,
}: {
  packageBytes: Uint8Array;
  scriptPath: string;
  tempDir: string;
}) {
  const zip = await JSZip.loadAsync(packageBytes);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  let targetScriptPath: string | null = null;

  for (const entry of entries) {
    const normalized = normalizeZipPath(entry.name);
    if (!normalized || isIgnoredZipPath(normalized)) {
      continue;
    }
    assertSafeRelativePath(normalized);

    const outputPath = path.join(tempDir, normalized);
    const relativeOutput = path.relative(tempDir, outputPath);
    if (relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
      throw new Error("Skill package contains an unsafe path.");
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, await entry.async("uint8array"), { mode: 0o500 });
    if (normalized.endsWith(`/${scriptPath}`) || normalized === scriptPath) {
      targetScriptPath = outputPath;
    }
  }

  if (!targetScriptPath) {
    throw new Error(`Skill package does not contain ${scriptPath}.`);
  }
  return targetScriptPath;
}

async function runScriptProcess({
  args,
  input,
  runtime,
  scriptPath,
  signal,
  stdin,
  tempDir,
}: {
  args: string[];
  input: unknown;
  runtime: "bash" | "node" | "python";
  scriptPath: string;
  signal?: AbortSignal;
  stdin?: string;
  tempDir: string;
}) {
  const runtimeBinary =
    runtime === "node"
      ? process.execPath
      : runtime === "python"
        ? "/usr/bin/python3"
        : "/bin/bash";
  const profile = buildSandboxProfile(tempDir);
  const child = spawn(
    SANDBOX_EXEC_PATH,
    [
      "-p",
      profile,
      "/usr/bin/env",
      "-i",
      "PATH=/usr/bin:/bin",
      runtimeBinary,
      scriptPath,
      ...args,
    ],
    {
      cwd: tempDir,
      env: {},
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
  }, SKILL_SCRIPT_TIMEOUT_MS);
  const abort = () => child.kill("SIGKILL");
  signal?.addEventListener("abort", abort, { once: true });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout = appendLimitedOutput(stdout, chunk);
    if (Buffer.byteLength(stdout) >= SKILL_SCRIPT_OUTPUT_LIMIT_BYTES) {
      child.kill("SIGKILL");
    }
  });
  child.stderr.on("data", (chunk: string) => {
    stderr = appendLimitedOutput(stderr, chunk);
    if (Buffer.byteLength(stderr) >= SKILL_SCRIPT_OUTPUT_LIMIT_BYTES) {
      child.kill("SIGKILL");
    }
  });

  child.stdin.end(stdin ?? JSON.stringify(input ?? {}));

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  }).finally(() => {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  });

  if (signal?.aborted) {
    throw new Error("Skill script was aborted.");
  }
  if (exitCode !== 0) {
    throw new Error(
      `Skill script exited with code ${exitCode ?? "unknown"}: ${stderr.trim() || "no stderr"}`
    );
  }

  return { stderr, stdout };
}

function parseScriptOutput(stdout: string, stderr: string): SkillScriptOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const summary = stdout.trim() || stderr.trim() || "Script completed.";
    return {
      data: { stderr, stdout },
      status: "ok",
      summary: summary.slice(0, 4000),
    };
  }

  const result = scriptOutputSchema.safeParse(parsed);
  if (!result.success) {
    return {
      data: { parsed, stderr, stdout },
      status: "ok",
      summary:
        typeof parsed === "string"
          ? parsed.slice(0, 4000)
          : "Script completed with JSON output.",
    };
  }

  return {
    ...result.data,
    canvasOperations: result.data.canvasOperations as CanvasOperation[] | undefined,
  };
}

async function assertSandboxAvailable() {
  try {
    await access(SANDBOX_EXEC_PATH);
  } catch {
    throw new Error("sandbox-exec is unavailable; refusing to run skill script without sandbox.");
  }
}

function buildSandboxProfile(tempDir: string) {
  const escapedTempDir = tempDir.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    "(deny file-write*)",
    `(allow file-write* (subpath "${escapedTempDir}"))`,
  ].join("\n");
}

function appendLimitedOutput(current: string, chunk: string) {
  const next = current + chunk;
  if (Buffer.byteLength(next) <= SKILL_SCRIPT_OUTPUT_LIMIT_BYTES) {
    return next;
  }
  return next.slice(0, SKILL_SCRIPT_OUTPUT_LIMIT_BYTES);
}

function normalizeZipPath(rawPath: string) {
  return rawPath.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}

function assertSafeRelativePath(relativePath: string) {
  const parts = relativePath.split("/").filter(Boolean);
  if (relativePath.startsWith("/") || parts.includes("..") || parts.includes(".")) {
    throw new Error("Skill package contains an unsafe path.");
  }
}

function isIgnoredZipPath(rawPath: string) {
  const parts = rawPath.split("/").filter(Boolean);
  return parts.some(
    (part) => part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._")
  );
}
