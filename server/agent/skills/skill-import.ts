import { createHash } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";

import {
  normalizeScriptPath,
  parseAgentSkillMarkdown,
  type AgentSkillScriptManifest,
  type ParsedAgentSkill,
} from "./skill-parser.ts";

export type ImportedAgentSkill = ParsedAgentSkill & {
  packageBytes: Uint8Array;
  packageSha256: string;
  packageSizeBytes: number;
  sourceManifest: Record<string, unknown>;
};

export const MAX_AGENT_SKILL_PACKAGE_BYTES = 5 * 1024 * 1024;

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
  const packageFiles = visibleFiles.map((entry) => entry.name);

  validateVisibleFiles({
    declaredScripts,
    rootPrefix,
    skillPath: skillEntry.name,
    visibleFiles: packageFiles,
  });

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
      packageFiles: summarizePackageFiles({
        rootPrefix,
        skillPath: skillEntry.name,
        visibleFiles: packageFiles,
      }),
      scripts: summarizeScripts(parsed.scripts),
      skillPath: skillEntry.name,
      source: "zip",
    },
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
  const scriptPaths = new Set<string>();

  for (const file of normalizedVisible) {
    if (file === skillPath) {
      continue;
    }

    if (!file.startsWith(rootPrefix)) {
      throw new Error("Skill zip files must stay under the SKILL.md package root.");
    }

    const relativePath = file.slice(rootPrefix.length);
    if (isReferenceOrAssetPath(relativePath)) {
      continue;
    }

    if (!relativePath.startsWith("scripts/")) {
      throw new Error(
        `Skill package file ${relativePath} must be under scripts/, references/, or assets/.`
      );
    }

    const normalizedScriptPath = normalizeScriptPath(relativePath);
    if (!declaredScripts.has(normalizedScriptPath)) {
      throw new Error(`Skill script ${relativePath} is not declared in SKILL.md.`);
    }
    scriptPaths.add(normalizedScriptPath);
  }

  for (const script of declaredScripts.values()) {
    const packagePath = `${rootPrefix}${script.path}`;
    if (!normalizedVisible.has(packagePath) || !scriptPaths.has(script.path)) {
      throw new Error(`Declared script ${script.path} is missing from the zip.`);
    }
  }
}

function isReferenceOrAssetPath(relativePath: string) {
  return relativePath.startsWith("references/") || relativePath.startsWith("assets/");
}

function assertPackageSize(sizeBytes: number) {
  if (sizeBytes > MAX_AGENT_SKILL_PACKAGE_BYTES) {
    throw new Error("Skill package exceeds the 5MB package limit.");
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
  return scripts.map(({ description, input, name, output, runtime }) => ({
    description,
    input,
    name,
    output,
    runtime,
  }));
}

function summarizePackageFiles({
  rootPrefix,
  skillPath,
  visibleFiles,
}: {
  rootPrefix: string;
  skillPath: string;
  visibleFiles: string[];
}) {
  return visibleFiles
    .map((file) => normalizeZipPath(file))
    .filter((file) => file !== normalizeZipPath(skillPath))
    .map((file) => file.slice(rootPrefix.length))
    .sort();
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
