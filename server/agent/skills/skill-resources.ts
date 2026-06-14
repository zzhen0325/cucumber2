import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

import { downloadAgentSkillPackage } from "../../storage.ts";
import type { ActivatedAgentSkill } from "./types.ts";

const MAX_RESOURCE_TEXT_CHARS = 80_000;
const MAX_LISTED_RESOURCES = 2_000;
const readableTextExtensions = new Set([
  ".bash",
  ".cjs",
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".sh",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

export type SkillResourceSummary = {
  path: string;
  readable: boolean;
  sizeBytes?: number;
  type: "asset" | "metadata" | "reference" | "script" | "style" | "unknown";
};

export type SkillResourceContent = SkillResourceSummary & {
  content?: string;
  truncated?: boolean;
};

export type SkillResourceBytes = SkillResourceSummary & {
  bytes: Uint8Array;
  mimeType: string;
  sizeBytes: number;
};

export type AgentSkillResourceSource = Pick<
  ActivatedAgentSkill,
  | "name"
  | "packageBucket"
  | "packagePath"
  | "packageSha256"
  | "sourceManifest"
>;

export async function listActivatedSkillResources(
  skill: AgentSkillResourceSource
): Promise<SkillResourceSummary[]> {
  if (skill.packageBucket && skill.packagePath && skill.packageSha256) {
    const zip = await loadSkillZip(skill);
    return listZipResources(zip, getRootPrefixFromSkill(skill));
  }

  const assetRoot = readAssetRoot(skill);
  if (assetRoot) {
    return listDirectoryResources(assetRoot);
  }

  return [];
}

export async function readActivatedSkillResource({
  resourcePath,
  skill,
}: {
  resourcePath: string;
  skill: AgentSkillResourceSource;
}): Promise<SkillResourceContent> {
  const normalizedPath = normalizeResourcePath(resourcePath);
  if (!isAllowedResourcePath(normalizedPath)) {
    throw new Error("Resource path is unsafe or reserved.");
  }
  if (!isReadableTextResource(normalizedPath)) {
    return {
      path: normalizedPath,
      readable: false,
      type: classifyResource(normalizedPath),
    };
  }

  if (skill.packageBucket && skill.packagePath && skill.packageSha256) {
    const zip = await loadSkillZip(skill);
    return readZipResource({
      resourcePath: normalizedPath,
      rootPrefix: getRootPrefixFromSkill(skill),
      zip,
    });
  }

  const assetRoot = readAssetRoot(skill);
  if (!assetRoot) {
    throw new Error(`Skill ${skill.name} does not have uploaded or built-in resources.`);
  }
  return readDirectoryResource({ assetRoot, resourcePath: normalizedPath });
}

export async function readActivatedSkillResourceBytes({
  resourcePath,
  skill,
}: {
  resourcePath: string;
  skill: AgentSkillResourceSource;
}): Promise<SkillResourceBytes> {
  const normalizedPath = normalizeResourcePath(resourcePath);
  if (!isAllowedResourcePath(normalizedPath)) {
    throw new Error("Resource path is unsafe or reserved.");
  }

  if (skill.packageBucket && skill.packagePath && skill.packageSha256) {
    const zip = await loadSkillZip(skill);
    return readZipResourceBytes({
      resourcePath: normalizedPath,
      rootPrefix: getRootPrefixFromSkill(skill),
      zip,
    });
  }

  const assetRoot = readAssetRoot(skill);
  if (!assetRoot) {
    throw new Error(`Skill ${skill.name} does not have uploaded or built-in resources.`);
  }
  return readDirectoryResourceBytes({ assetRoot, resourcePath: normalizedPath });
}

async function loadSkillZip(skill: AgentSkillResourceSource) {
  const packageBytes = await downloadAgentSkillPackage({
    bucket: skill.packageBucket ?? "",
    path: skill.packagePath ?? "",
  });
  const actualSha256 = createHash("sha256").update(packageBytes).digest("hex");
  if (actualSha256 !== skill.packageSha256) {
    throw new Error(`Skill package hash mismatch for ${skill.name}.`);
  }
  return JSZip.loadAsync(packageBytes);
}

async function listZipResources(zip: JSZip, rootPrefix: string) {
  const resources: SkillResourceSummary[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || isIgnoredZipPath(entry.name)) {
      continue;
    }
    const resourcePath = toResourcePath(normalizeZipPath(entry.name), rootPrefix);
    if (!resourcePath || !isAllowedResourcePath(resourcePath)) {
      continue;
    }
    resources.push({
      path: resourcePath,
      readable: isReadableTextResource(resourcePath),
      type: classifyResource(resourcePath),
    });
    if (resources.length >= MAX_LISTED_RESOURCES) {
      break;
    }
  }
  return resources.sort((left, right) => left.path.localeCompare(right.path));
}

async function listDirectoryResources(assetRoot: string) {
  const resources: SkillResourceSummary[] = [];
  await walkDirectory(assetRoot, async (filePath) => {
    if (resources.length >= MAX_LISTED_RESOURCES) {
      return;
    }
    const resourcePath = normalizeResourcePath(path.relative(assetRoot, filePath));
    if (!isAllowedResourcePath(resourcePath)) {
      return;
    }
    const info = await stat(filePath);
    resources.push({
      path: resourcePath,
      readable: isReadableTextResource(resourcePath),
      sizeBytes: info.size,
      type: classifyResource(resourcePath),
    });
  });
  return resources.sort((left, right) => left.path.localeCompare(right.path));
}

async function readZipResource({
  resourcePath,
  rootPrefix,
  zip,
}: {
  resourcePath: string;
  rootPrefix: string;
  zip: JSZip;
}) {
  const entry = Object.values(zip.files).find((candidate) => {
    if (candidate.dir) {
      return false;
    }
    const candidatePath = toResourcePath(normalizeZipPath(candidate.name), rootPrefix);
    return candidatePath === resourcePath;
  });
  if (!entry) {
    throw new Error(`Skill resource not found: ${resourcePath}`);
  }
  const content = await entry.async("string");
  return toResourceContent(resourcePath, content);
}

async function readZipResourceBytes({
  resourcePath,
  rootPrefix,
  zip,
}: {
  resourcePath: string;
  rootPrefix: string;
  zip: JSZip;
}) {
  const entry = Object.values(zip.files).find((candidate) => {
    if (candidate.dir) {
      return false;
    }
    const candidatePath = toResourcePath(normalizeZipPath(candidate.name), rootPrefix);
    return candidatePath === resourcePath;
  });
  if (!entry) {
    throw new Error(`Skill resource not found: ${resourcePath}`);
  }
  const bytes = await entry.async("uint8array");
  return toResourceBytes(resourcePath, bytes);
}

async function readDirectoryResource({
  assetRoot,
  resourcePath,
}: {
  assetRoot: string;
  resourcePath: string;
}) {
  const filePath = path.join(assetRoot, resourcePath);
  const relative = path.relative(assetRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Resource path escapes the skill asset root.");
  }
  const content = await readFile(filePath, "utf8");
  const info = await stat(filePath);
  return {
    ...toResourceContent(resourcePath, content),
    sizeBytes: info.size,
  };
}

async function readDirectoryResourceBytes({
  assetRoot,
  resourcePath,
}: {
  assetRoot: string;
  resourcePath: string;
}) {
  const filePath = path.join(assetRoot, resourcePath);
  const relative = path.relative(assetRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Resource path escapes the skill asset root.");
  }
  const bytes = await readFile(filePath);
  const info = await stat(filePath);
  return {
    ...toResourceBytes(resourcePath, new Uint8Array(bytes)),
    sizeBytes: info.size,
  };
}

async function walkDirectory(
  root: string,
  visit: (filePath: string) => Promise<void>
) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(filePath, visit);
      continue;
    }
    if (entry.isFile()) {
      await visit(filePath);
    }
  }
}

function toResourceContent(
  resourcePath: string,
  content: string
): SkillResourceContent {
  const truncated = content.length > MAX_RESOURCE_TEXT_CHARS;
  return {
    content: truncated ? content.slice(0, MAX_RESOURCE_TEXT_CHARS) : content,
    path: resourcePath,
    readable: true,
    truncated,
    type: classifyResource(resourcePath),
  };
}

function toResourceBytes(
  resourcePath: string,
  bytes: Uint8Array
): SkillResourceBytes {
  return {
    bytes,
    mimeType: getResourceMimeType(resourcePath),
    path: resourcePath,
    readable: isReadableTextResource(resourcePath),
    sizeBytes: bytes.byteLength,
    type: classifyResource(resourcePath),
  };
}

function getRootPrefixFromSkill(skill: AgentSkillResourceSource) {
  const skillPath = skill.sourceManifest.skillPath;
  if (typeof skillPath !== "string" || !skillPath.trim()) {
    return "";
  }
  const normalized = normalizeZipPath(skillPath);
  const dirname = path.posix.dirname(normalized);
  return dirname === "." ? "" : `${dirname}/`;
}

function toResourcePath(filePath: string, rootPrefix: string) {
  const relativePath =
    rootPrefix && filePath.startsWith(rootPrefix)
      ? filePath.slice(rootPrefix.length)
      : filePath;
  return isAllowedResourcePath(relativePath) ? relativePath : "";
}

function isAllowedResourcePath(resourcePath: string) {
  const normalized = normalizeResourcePath(resourcePath);
  const parts = normalized.split("/").filter(Boolean);
  return Boolean(
    normalized &&
      normalized !== "SKILL.md" &&
      !normalized.startsWith("/") &&
      !parts.includes(".") &&
      !parts.includes("..") &&
      !parts.some(
        (part) =>
          part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._")
      )
  );
}

function isReadableTextResource(resourcePath: string) {
  return readableTextExtensions.has(path.posix.extname(resourcePath).toLowerCase());
}

function getResourceMimeType(resourcePath: string) {
  const extension = path.posix.extname(resourcePath).toLowerCase();
  switch (extension) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".csv":
      return "text/csv; charset=utf-8";
    case ".gif":
      return "image/gif";
    case ".html":
      return "text/html; charset=utf-8";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".webp":
      return "image/webp";
    case ".yaml":
    case ".yml":
      return "application/yaml; charset=utf-8";
    default:
      return isReadableTextResource(resourcePath)
        ? "text/plain; charset=utf-8"
        : "application/octet-stream";
  }
}

function classifyResource(resourcePath: string): SkillResourceSummary["type"] {
  if (resourcePath.startsWith("references/")) {
    return "reference";
  }
  if (resourcePath.startsWith("styles/") || /\/styles\//.test(resourcePath)) {
    return "style";
  }
  if (resourcePath.startsWith("assets/")) {
    return "asset";
  }
  if (resourcePath.startsWith("scripts/")) {
    return "script";
  }
  if (resourcePath.startsWith("agents/") || resourcePath.startsWith("LICENSE")) {
    return "metadata";
  }
  return "unknown";
}

function readAssetRoot(skill: AgentSkillResourceSource) {
  const raw = skill.sourceManifest.assetRoot;
  return typeof raw === "string" && raw.trim() ? path.resolve(raw.trim()) : null;
}

function normalizeResourcePath(resourcePath: string) {
  const normalized = resourcePath.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
  const parts = normalized.split("/");
  if (normalized.startsWith("/") || parts.includes("..") || parts.includes(".")) {
    throw new Error("Resource path is unsafe.");
  }
  return normalized;
}

function normalizeZipPath(rawPath: string) {
  return rawPath.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}

function isIgnoredZipPath(rawPath: string) {
  const parts = rawPath.split("/").filter(Boolean);
  return parts.some(
    (part) => part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._")
  );
}
