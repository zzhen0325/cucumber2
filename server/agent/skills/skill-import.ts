import { createHash } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";

import {
  normalizeScriptPath,
  parseAgentSkillMarkdown,
  type AgentSkillScriptRuntime,
  type AgentSkillScriptManifest,
  type ParsedAgentSkill,
} from "./skill-parser.ts";

export type ImportedAgentSkill = ParsedAgentSkill & {
  packageBytes: Uint8Array;
  packageSha256: string;
  packageSizeBytes: number;
  sourceManifest: Record<string, unknown>;
};

export const MAX_AGENT_SKILL_PACKAGE_BYTES = 100 * 1024 * 1024;

export async function importAgentSkillZip(
  bytes: Buffer | Uint8Array,
  fileName: string
): Promise<ImportedAgentSkill> {
  assertPackageSize(bytes.byteLength);
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  const visibleFiles = entries.filter(
    (entry) => !entry.dir && !isIgnoredZipPath(entry.name)
  );
  for (const entry of visibleFiles) {
    assertSafeZipPath(entry.name);
  }

  const skillFiles = visibleFiles.filter(
    (entry) => path.posix.basename(entry.name) === "SKILL.md"
  );
  if (skillFiles.length !== 1) {
    throw new Error(
      skillFiles.length
        ? "Skill zip must contain exactly one visible SKILL.md file."
        : "Skill zip does not contain a visible SKILL.md file."
    );
  }

  const skillEntry = skillFiles[0];
  const markdown = await skillEntry.async("string");
  const parsed = parseAgentSkillMarkdown(markdown);
  const rootPrefix = getRootPrefix(skillEntry.name);
  const declaredScripts = new Map(parsed.scripts.map((script) => [script.path, script]));

  const { discoveredScripts, resources } = validateVisibleFiles({
    declaredScripts,
    rootPrefix,
    skillPath: skillEntry.name,
    visibleFiles: visibleFiles.map((entry) => entry.name),
  });
  const scripts = mergeScripts(parsed.scripts, discoveredScripts);

  const packageBytes = toUint8Array(bytes);
  const packageSha256 = createHash("sha256").update(packageBytes).digest("hex");

  return {
    ...parsed,
    packageBytes,
    packageSha256,
    packageSizeBytes: packageBytes.byteLength,
    sourceManifest: {
      fileCount: visibleFiles.length,
      fileName,
      packageSha256,
      packageSizeBytes: packageBytes.byteLength,
      resources,
      scripts: summarizeScripts(scripts),
      skillPath: skillEntry.name,
      source: "zip",
    },
    scripts,
  };
}

function validateVisibleFiles({
  declaredScripts,
  rootPrefix,
  skillPath,
  visibleFiles,
}: {
  declaredScripts: Map<string, AgentSkillScriptManifest>;
  rootPrefix: string;
  skillPath: string;
  visibleFiles: string[];
}) {
  const normalizedVisible = new Set(visibleFiles.map((file) => normalizeZipPath(file)));
  const discoveredScripts: AgentSkillScriptManifest[] = [];
  const scriptPaths = new Set<string>();
  const resources = {
    additionalFiles: 0,
    assetFiles: 0,
    previewImages: 0,
    referenceFiles: 0,
    resourceFiles: 0,
    scriptFiles: 0,
    styleJsonFiles: 0,
    stylePreviewImages: 0,
  };

  for (const file of normalizedVisible) {
    if (file === skillPath) {
      continue;
    }

    if (!file.startsWith(rootPrefix)) {
      throw new Error("Skill zip files must stay under the SKILL.md package root.");
    }

    const relativePath = file.slice(rootPrefix.length);
    if (relativePath.startsWith("scripts/")) {
      const normalizedScriptPath = normalizeScriptPath(relativePath);
      scriptPaths.add(normalizedScriptPath);
      const declaredScript = declaredScripts.get(normalizedScriptPath);
      if (!declaredScript) {
        const discoveredScript = discoverScript(normalizedScriptPath, [
          ...declaredScripts.values(),
          ...discoveredScripts,
        ]);
        if (discoveredScript) {
          discoveredScripts.push(discoveredScript);
        }
      }
      summarizeResource(relativePath, resources);
      continue;
    }
    summarizeResource(relativePath, resources);
  }

  for (const script of declaredScripts.values()) {
    const packagePath = `${rootPrefix}${script.path}`;
    if (!normalizedVisible.has(packagePath) || !scriptPaths.has(script.path)) {
      throw new Error(`Declared script ${script.path} is missing from the zip.`);
    }
  }

  return { discoveredScripts, resources };
}

function assertPackageSize(sizeBytes: number) {
  if (sizeBytes > MAX_AGENT_SKILL_PACKAGE_BYTES) {
    throw new Error("Skill package exceeds the 100MB package limit.");
  }
}

function assertSafeZipPath(rawPath: string) {
  const normalized = normalizeZipPath(rawPath);
  const parts = normalized.split("/").filter(Boolean);
  if (
    rawPath.includes("\\") ||
    normalized.startsWith("/") ||
    parts.includes("..") ||
    parts.includes(".")
  ) {
    throw new Error("Skill zip contains an unsafe path.");
  }
}

function normalizeZipPath(rawPath: string) {
  return rawPath.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}

function getRootPrefix(skillPath: string) {
  const normalized = normalizeZipPath(skillPath);
  const dirname = path.posix.dirname(normalized);
  return dirname === "." ? "" : `${dirname}/`;
}

function summarizeScripts(scripts: AgentSkillScriptManifest[]) {
  return scripts.map(({ description, input, name, output, path, runtime }) => ({
    description,
    input,
    name,
    output,
    path,
    runtime,
  }));
}

function summarizeResource(
  relativePath: string,
  resources: {
    additionalFiles: number;
    assetFiles: number;
    previewImages: number;
    referenceFiles: number;
    resourceFiles: number;
    scriptFiles: number;
    styleJsonFiles: number;
    stylePreviewImages: number;
  }
) {
  resources.resourceFiles += 1;
  if (relativePath.startsWith("references/")) {
    resources.referenceFiles += 1;
  }
  if (relativePath.startsWith("assets/")) {
    resources.assetFiles += 1;
  }
  if (relativePath.startsWith("scripts/")) {
    resources.scriptFiles += 1;
  }
  if (
    !relativePath.startsWith("references/") &&
    !relativePath.startsWith("assets/") &&
    !relativePath.startsWith("scripts/") &&
    !relativePath.startsWith("styles/") &&
    relativePath !== "agents/openai.yaml" &&
    !/^LICENSE(?:\.[A-Za-z0-9]+)?$/.test(relativePath)
  ) {
    resources.additionalFiles += 1;
  }
  if (/\/style\.json$/.test(relativePath)) {
    resources.styleJsonFiles += 1;
  }
  if (/preview-[^/]+\.(?:jpe?g|png|webp)$/i.test(relativePath)) {
    resources.previewImages += 1;
  }
  if (
    /(?:^|\/)styles\/[^/]+\/preview-[^/]+\.(?:jpe?g|png|webp)$/i.test(relativePath)
  ) {
    resources.stylePreviewImages += 1;
  }
}

function discoverScript(
  scriptPath: string,
  existingScripts: AgentSkillScriptManifest[]
): AgentSkillScriptManifest | null {
  const runtime = inferScriptRuntime(scriptPath);
  if (!runtime) {
    return null;
  }
  const name = uniqueScriptName(scriptPath, existingScripts);
  return {
    description: `Discovered executable script at ${scriptPath}. Read the skill instructions or run with --help before using it.`,
    name,
    path: scriptPath,
    runtime,
  };
}

function inferScriptRuntime(scriptPath: string): AgentSkillScriptRuntime | null {
  const extension = path.posix.extname(scriptPath).toLowerCase();
  if (extension === ".js" || extension === ".mjs") {
    return "node";
  }
  if (extension === ".py") {
    return "python";
  }
  if (extension === ".bash" || extension === ".sh") {
    return "bash";
  }
  return null;
}

function uniqueScriptName(
  scriptPath: string,
  existingScripts: AgentSkillScriptManifest[]
) {
  const used = new Set(existingScripts.map((script) => script.name));
  const basename = scriptPath
    .replace(/^scripts\//, "")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const base = basename || "script";
  let name = base;
  let index = 2;
  while (used.has(name)) {
    name = `${base}-${index}`;
    index += 1;
  }
  return name;
}

function mergeScripts(
  declaredScripts: AgentSkillScriptManifest[],
  discoveredScripts: AgentSkillScriptManifest[]
) {
  const declaredPaths = new Set(declaredScripts.map((script) => script.path));
  return [
    ...declaredScripts,
    ...discoveredScripts.filter((script) => !declaredPaths.has(script.path)),
  ];
}

function isIgnoredZipPath(rawPath: string) {
  const parts = rawPath.split("/").filter(Boolean);
  return parts.some(
    (part) => part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._")
  );
}

function toUint8Array(bytes: Buffer | Uint8Array) {
  if (bytes instanceof Buffer) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return bytes;
}
