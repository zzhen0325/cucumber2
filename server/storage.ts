import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import type {
  ArtifactPreviewKind,
  ArtifactRef,
  ArtifactType,
  UpstreamContextItem,
} from "../src/types/canvas.ts";
import {
  getAgentArtifactForUser,
  registerAgentArtifact,
  type AgentArtifactRecord,
} from "./supabase.ts";
import {
  createPresignedReadUrl,
  createPresignedUploadUrl,
  getObject,
  getR2AssetsBucket,
  getR2SignedReadTtlSeconds,
  getR2SignedUploadTtlSeconds,
  getR2SkillPackagesBucket,
  headObject,
  isR2Configured,
  putObject,
} from "./r2-storage.ts";
import { upsertTextArtifactContentForUser } from "./artifact-content-store.ts";
import {
  indexArtifactForKnowledge,
  isLikelyTextualAsset,
  readKnowledgeTextFromBytes,
} from "./agent/knowledge/knowledge-index.ts";

export const AGENT_ASSETS_BUCKET = "agent-assets";
export const AGENT_SKILL_PACKAGES_BUCKET = "agent-skill-packages";
export const MAX_AGENT_ASSET_BYTES = 50 * 1024 * 1024;
export const MAX_AGENT_SKILL_PACKAGE_BYTES = 100 * 1024 * 1024;
export const SIGNED_ASSET_READ_TTL_SECONDS = 10 * 60;

export type UploadAssetKind =
  | "image"
  | "markdown"
  | "code"
  | "document"
  | "webpage"
  | "dataset"
  | "file";

type CreateSignedAssetUploadInput = {
  projectId: string;
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
};

type CompleteSignedAssetUploadInput = {
  projectId: string;
  userId: string;
  uploadId: string;
  bucket: string;
  path: string;
  fileName: string;
  kind: UploadAssetKind;
  mimeType: string;
  preview?: string;
  sizeBytes: number;
  title?: string;
  width?: number;
  height?: number;
  summary?: string;
};

type StoreGeneratedImageInput = {
  projectId: string;
  userId: string;
  runNodeId?: string | null;
  artifactId: string;
  title?: string;
  sourceUrl: string;
  sourceNodeId?: string | null;
  sourceToolName?: string;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
};

type StoreGeneratedImageBytesInput = Omit<StoreGeneratedImageInput, "sourceUrl"> & {
  bytes: Uint8Array;
  mimeType: string;
};

type StoreTextArtifactInput = {
  content: string;
  metadata?: Record<string, unknown>;
  projectId: string;
  runNodeId: string;
  sourceToolName: string;
  title: string;
  type?: Extract<ArtifactType, "doc" | "code" | "webpage" | "decision" | "memory" | "tool_result">;
  userId: string;
};

type StoreAgentSkillPackageInput = {
  bytes: Uint8Array;
  packageSha256: string;
  skillName: string;
};

export function getStorageContentRef(bucket: string, path: string) {
  return `r2://${bucket}/${path}`;
}

export function parseStorageContentRef(contentRef: string) {
  const match = contentRef.match(/^r2:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    return null;
  }
  return {
    bucket: match[1],
    path: match[2],
  };
}

export function getArtifactStorageContentRef(artifact: ArtifactRef) {
  if (artifact.contentRef && parseStorageContentRef(artifact.contentRef)) {
    return artifact.contentRef;
  }

  const bucket = readString(artifact.metadata?.storageBucket);
  const path = readString(artifact.metadata?.storagePath);
  return bucket && path ? getStorageContentRef(bucket, path) : null;
}

export function getArtifactContentUrl(projectId: string, artifactId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(
    artifactId
  )}/content`;
}

export function isObjectStorageConfigured() {
  return isR2Configured();
}

export async function createSignedAssetUpload({
  fileName,
  mimeType,
  projectId,
  sizeBytes,
}: CreateSignedAssetUploadInput) {
  assertAllowedAssetSize(sizeBytes);

  const uploadId = randomUUID();
  const bucket = getR2AssetsBucket();
  const contentType = normalizeMimeType(mimeType ?? null);
  const path = `projects/${projectId}/uploads/${uploadId}/${sanitizeFileName(
    fileName
  )}`;
  const signed = await createPresignedUploadUrl({
    bucket,
    contentType,
    expiresIn: getR2SignedUploadTtlSeconds(),
    path,
  });

  return {
    bucket,
    contentRef: getStorageContentRef(bucket, path),
    expiresIn: signed.expiresIn,
    headers: signed.headers,
    method: signed.method,
    path,
    signedUrl: signed.signedUrl,
    uploadId,
  };
}

export async function completeSignedAssetUpload(
  input: CompleteSignedAssetUploadInput
): Promise<ArtifactRef> {
  const totalStartedAt = performance.now();
  assertExpectedUploadPath(input);
  assertAllowedAssetSize(input.sizeBytes);

  const artifactId = `upload-${input.uploadId}`;
  const artifactType = getArtifactTypeForUploadKind(input.kind);
  const inputMimeType = normalizeMimeType(input.mimeType);
  const infoStartedAt = performance.now();
  const objectInfo = await getStoredObjectInfo(input.bucket, input.path);
  const infoMs = elapsedStorageMs(infoStartedAt);
  if (
    objectInfo.sizeBytes !== null &&
    objectInfo.sizeBytes !== input.sizeBytes
  ) {
    throw new Error("Uploaded asset size does not match the signed upload.");
  }
  const mimeType =
    objectInfo?.mimeType || inputMimeType || "application/octet-stream";
  const shouldReadObjectBytes = isLikelyTextualAsset(mimeType, input.path);
  const downloadStartedAt = performance.now();
  const objectBytes = shouldReadObjectBytes
    ? await readStoredObjectBytes(input.bucket, input.path)
    : null;
  const downloadMs = objectBytes ? elapsedStorageMs(downloadStartedAt) : 0;
  const sizeBytes = objectInfo.sizeBytes ?? objectBytes?.byteLength ?? input.sizeBytes;
  const previewKind = getPreviewKindForUploadKind(input.kind);
  const metadata = compactRecord({
    byteSize: sizeBytes,
    createdBy: input.userId,
    digest: objectBytes ? createSha256Digest(objectBytes) : undefined,
    fileName: input.fileName,
    format: getUploadFormat(input.kind),
    height: input.height,
    mimeType,
    origin: "user_upload",
    preview: input.preview,
    previewKind,
    projectId: input.projectId,
    size: sizeBytes,
    sourceToolName: "upload",
    storageBucket: input.bucket,
    storagePath: input.path,
    summary: input.summary,
    uploadKind: input.kind,
    uploadedAt: new Date().toISOString(),
    width: input.width,
  });

  const registerStartedAt = performance.now();
  const record = await registerAgentArtifact({
    bucketId: input.bucket,
    contentRef: getStorageContentRef(input.bucket, input.path),
    createdBy: input.userId,
    id: artifactId,
    metadata,
    mimeType,
    origin: "user_upload",
    projectId: input.projectId,
    sizeBytes,
    skipProjectAccessCheck: true,
    storagePath: input.path,
    title: input.title ?? input.fileName,
    type: artifactType,
    uri:
      artifactType === "image"
        ? getArtifactContentUrl(input.projectId, artifactId)
        : null,
    userId: input.userId,
  });
  const registerMs = elapsedStorageMs(registerStartedAt);

  if (!record) {
    throw new Error("Project not found.");
  }

  const indexStartedAt = performance.now();
  await indexArtifactForKnowledge({
    artifact: record,
    contentText: objectBytes
      ? readKnowledgeTextFromBytes({
          bytes: objectBytes,
          mimeType,
          path: input.path,
        })
      : undefined,
  });
  const indexMs = elapsedStorageMs(indexStartedAt);

  console.info("[upload:complete]", {
    artifactId,
    downloadMs,
    fileName: input.fileName,
    infoMs,
    kind: input.kind,
    mimeType,
    readObjectInfo: Boolean(objectInfo),
    readObjectBytes: Boolean(objectBytes),
    registerMs,
    sizeBytes,
    indexMs,
    totalMs: elapsedStorageMs(totalStartedAt),
    uploadId: input.uploadId,
  });

  return toArtifactRef(record);
}

export async function storeGeneratedImageFromUrl(
  input: StoreGeneratedImageInput
): Promise<ArtifactRef> {
  const response = await fetch(input.sourceUrl, { signal: input.signal });
  if (!response.ok) {
    throw new Error(
      `Failed to download generated image (${response.status} ${response.statusText}).`
    );
  }

  const mimeType = normalizeMimeType(response.headers.get("content-type"));
  if (!mimeType.startsWith("image/")) {
    throw new Error(`Generated asset is not an image (${mimeType}).`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return storeGeneratedImageFromBytes({
    ...input,
    bytes,
    mimeType,
  });
}

export async function storeGeneratedImageFromBytes(
  input: StoreGeneratedImageBytesInput
): Promise<ArtifactRef> {
  const mimeType = normalizeMimeType(input.mimeType);
  if (!mimeType.startsWith("image/")) {
    throw new Error(`Generated asset is not an image (${mimeType}).`);
  }
  assertAllowedAssetSize(input.bytes.byteLength);

  const path = `${getGeneratedImageStoragePrefix(input)}/${sanitizePathSegment(
    input.artifactId
  )}.${getExtensionForMimeType(mimeType)}`;
  const bucket = getR2AssetsBucket();
  await putObject({
    bucket,
    bytes: input.bytes,
    cacheControl: "31536000",
    contentType: mimeType,
    path,
  });

  const provider =
    typeof input.metadata?.provider === "string"
      ? input.metadata.provider
      : "seedream";
  const origin =
    provider === "coze"
      ? "coze_generated"
      : provider === "byteartist"
        ? "byteartist_generated"
        : "seedream_generated";
  const metadata = compactRecord({
    ...input.metadata,
    byteSize: input.bytes.byteLength,
    createdBy: input.userId,
    digest: createSha256Digest(input.bytes),
    mimeType,
    origin,
    previewKind: "image",
    projectId: input.projectId,
    size: input.bytes.byteLength,
    sourceRunNodeId: input.runNodeId,
    sourceToolName:
      input.sourceToolName ??
      (input.metadata?.operation === "upscale" ? "upscale_image" : "generate_image"),
    storageBucket: bucket,
    storagePath: path,
  });
  const record = await registerAgentArtifact({
    bucketId: bucket,
    contentRef: getStorageContentRef(bucket, path),
    createdBy: input.userId,
    id: input.artifactId,
    metadata,
    mimeType,
    origin,
    projectId: input.projectId,
    runNodeId: input.runNodeId,
    sizeBytes: input.bytes.byteLength,
    sourceNodeId: input.sourceNodeId,
    storagePath: path,
    title: input.title,
    type: "image",
    uri: getArtifactContentUrl(input.projectId, input.artifactId),
    userId: input.userId,
  });

  if (!record) {
    throw new Error("Project not found.");
  }

  await indexArtifactForKnowledge({ artifact: record });

  return toArtifactRef(record);
}

export async function storeTextArtifactContent(
  input: StoreTextArtifactInput
): Promise<ArtifactRef> {
  const bytes = new TextEncoder().encode(input.content);
  assertAllowedAssetSize(bytes.byteLength);

  const artifactId = `text-${input.runNodeId}-${randomUUID()}`;
  const artifactType = input.type ?? "doc";
  const mimeType = getMimeTypeForTextArtifact(artifactType);
  const format = getTextArtifactContentFormat(artifactType);

  const metadata = compactRecord({
    ...input.metadata,
    byteSize: bytes.byteLength,
    createdBy: input.userId,
    digest: createSha256Digest(bytes),
    format,
    mimeType,
    origin: "runtime_materialized",
    preview: summarizeTextPreview(input.content, 4_000),
    previewKind: getPreviewKindForArtifactType(artifactType),
    projectId: input.projectId,
    size: bytes.byteLength,
    sourceRunNodeId: input.runNodeId,
    sourceToolName: input.sourceToolName,
    summary: summarizeTextPreview(input.content, 240),
  });

  const artifact = await upsertTextArtifactContentForUser({
    artifactId,
    contentFormat: format,
    contentText: input.content,
    metadata,
    mimeType,
    plainText: input.content,
    previewKind: getPreviewKindForArtifactType(artifactType),
    previewText: summarizeTextPreview(input.content, 4_000),
    projectId: input.projectId,
    summary: summarizeTextPreview(input.content, 240),
    title: input.title,
    type: artifactType,
    userId: input.userId,
  });

  if (!artifact) {
    throw new Error("Project not found.");
  }

  const record = await getAgentArtifactForUser({
    artifactId,
    projectId: input.projectId,
    userId: input.userId,
  });
  if (record) {
    await indexArtifactForKnowledge({
      artifact: record,
      contentText: input.content,
    });
  }

  return artifact;
}

export async function storeAgentSkillPackage(input: StoreAgentSkillPackageInput) {
  assertAllowedSkillPackageSize(input.bytes.byteLength);
  const path = `skills/${sanitizePathSegment(input.skillName)}/${input.packageSha256}.zip`;
  const bucket = getR2SkillPackagesBucket();
  await putObject({
    bucket,
    bytes: input.bytes,
    cacheControl: "31536000",
    contentType: "application/zip",
    path,
  });

  return {
    bucket,
    path,
  };
}

export async function downloadAgentSkillPackage({
  bucket,
  path,
}: {
  bucket: string;
  path: string;
}) {
  if (bucket !== getR2SkillPackagesBucket()) {
    throw new Error("Skill package bucket is not allowed.");
  }

  const { bytes } = await getObject(bucket, path);
  assertAllowedSkillPackageSize(bytes.byteLength);
  return bytes;
}

function getGeneratedImageStoragePrefix(
  input: Pick<
    StoreGeneratedImageInput,
    "projectId" | "runNodeId" | "sourceNodeId"
  >
) {
  if (input.runNodeId) {
    return `projects/${input.projectId}/runs/${sanitizePathSegment(
      input.runNodeId
    )}/artifacts`;
  }

  return `projects/${input.projectId}/operations/${sanitizePathSegment(
    input.sourceNodeId ?? "direct"
  )}/artifacts`;
}

export async function createSignedArtifactReadUrl(
  artifact: Pick<AgentArtifactRecord, "bucketId" | "storagePath">
) {
  if (!artifact.bucketId || !artifact.storagePath) {
    throw new Error("Artifact is not backed by object storage.");
  }

  return createSignedStorageReadUrl(artifact.bucketId, artifact.storagePath);
}

export async function readArtifactContent(
  artifact: Pick<
    AgentArtifactRecord,
    "bucketId" | "mimeType" | "sizeBytes" | "storagePath"
  >
) {
  if (!artifact.bucketId || !artifact.storagePath) {
    throw new Error("Artifact is not backed by object storage.");
  }

  const object = await getObject(artifact.bucketId, artifact.storagePath);
  return {
    bytes: object.bytes,
    mimeType:
      artifact.mimeType ?? object.mimeType ?? "application/octet-stream",
    sizeBytes: artifact.sizeBytes ?? object.sizeBytes,
  };
}

export async function resolveStorageBackedImageContext(
  items: UpstreamContextItem[]
): Promise<UpstreamContextItem[]> {
  return Promise.all(
    items.map(async (item) => {
      if (item.type !== "image") {
        return item;
      }

      const contentRef =
        item.contentRef ??
        (item.artifact ? getArtifactStorageContentRef(item.artifact) : null);
      const parsed = contentRef ? parseStorageContentRef(contentRef) : null;
      if (!contentRef || !parsed) {
        return item;
      }

      return {
        ...item,
        artifact: item.artifact
          ? {
              ...item.artifact,
              contentRef,
            }
          : item.artifact,
        contentRef,
        imageUrl: await createSignedStorageReadUrl(parsed.bucket, parsed.path),
      };
    })
  );
}

async function createSignedStorageReadUrl(bucket: string, path: string) {
  return createPresignedReadUrl({
    bucket,
    expiresIn: getR2SignedReadTtlSeconds(),
    path,
  });
}

async function getStoredObjectInfo(bucket: string, path: string) {
  const data = await headObject(bucket, path);

  return {
    mimeType: readString(data.mimeType),
    sizeBytes: readNumber(data.sizeBytes),
  };
}

async function readStoredObjectBytes(bucket: string, path: string) {
  const { bytes } = await getObject(bucket, path);
  return bytes;
}

function toArtifactRef(record: AgentArtifactRecord): ArtifactRef {
  return {
    contentRef: record.contentRef ?? undefined,
    id: record.id,
    metadata: compactRecord({
      ...record.metadata,
      byteSize: record.metadata.byteSize ?? record.sizeBytes,
      createdAt: record.createdAt,
      createdBy: record.metadata.createdBy ?? record.createdBy,
      mimeType: record.metadata.mimeType ?? record.mimeType,
      previewKind: record.metadata.previewKind ?? getPreviewKindForArtifactType(record.type),
      sourceRunNodeId: record.metadata.sourceRunNodeId ?? record.runNodeId,
    }),
    mimeType: record.mimeType ?? undefined,
    preview: record.previewText ?? undefined,
    previewKind: record.previewKind ?? undefined,
    sizeBytes: record.sizeBytes ?? undefined,
    summary: record.summary ?? undefined,
    title: record.title ?? undefined,
    type: record.type,
    uri: record.uri ?? undefined,
    version: record.version ?? undefined,
  };
}

function assertExpectedUploadPath(input: CompleteSignedAssetUploadInput) {
  if (input.bucket !== getR2AssetsBucket()) {
    throw new Error("Upload bucket does not match the project asset bucket.");
  }

  const expectedPath = `projects/${input.projectId}/uploads/${
    input.uploadId
  }/${sanitizeFileName(input.fileName)}`;
  if (input.path !== expectedPath) {
    throw new Error("Upload path does not match the signed upload.");
  }
}

function assertAllowedAssetSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw new Error("Asset size is invalid.");
  }
  if (sizeBytes > MAX_AGENT_ASSET_BYTES) {
    throw new Error("Asset exceeds the 50MB upload limit.");
  }
}

function assertAllowedSkillPackageSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw new Error("Skill package size is invalid.");
  }
  if (sizeBytes > MAX_AGENT_SKILL_PACKAGE_BYTES) {
    throw new Error("Skill package exceeds the 100MB package limit.");
  }
}

function getArtifactTypeForUploadKind(kind: UploadAssetKind): ArtifactType {
  const types = {
    code: "code",
    dataset: "dataset",
    document: "doc",
    file: "file",
    image: "image",
    markdown: "doc",
    webpage: "webpage",
  } satisfies Record<UploadAssetKind, ArtifactType>;

  return types[kind];
}

function getUploadFormat(kind: UploadAssetKind) {
  if (kind === "markdown") {
    return "markdown";
  }
  if (kind === "webpage") {
    return "html";
  }
  return undefined;
}

function getPreviewKindForUploadKind(kind: UploadAssetKind): ArtifactPreviewKind {
  if (kind === "markdown") {
    return "markdown";
  }
  return kind;
}

function getPreviewKindForArtifactType(type: ArtifactType): ArtifactPreviewKind {
  if (type === "doc") {
    return "document";
  }
  if (type === "tool_result") {
    return "toolResult";
  }
  return type;
}

function createSha256Digest(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function elapsedStorageMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function sanitizeFileName(fileName: string) {
  const normalized = fileName.trim() || "asset";
  const safe = normalized
    .replace(/[^\w.!$&'()+,;=@ -]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 160)
    .trim();

  return safe || "asset";
}

function sanitizePathSegment(value: string) {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || randomUUID()
  );
}

function normalizeMimeType(value: string | null) {
  return value?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}

function getExtensionForMimeType(mimeType: string) {
  const extensions: Record<string, string> = {
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  return extensions[mimeType] ?? "png";
}

function getMimeTypeForTextArtifact(type: ArtifactType) {
  if (type === "code" || type === "tool_result") {
    return "application/json";
  }
  if (type === "webpage") {
    return "text/html";
  }
  return "text/markdown";
}

function getTextArtifactContentFormat(type: ArtifactType) {
  if (type === "tool_result") {
    return "tool-result-json";
  }
  if (type === "code") {
    return "code";
  }
  if (type === "webpage") {
    return "html";
  }
  return "markdown";
}

function summarizeTextPreview(content: string, limit: number) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function compactRecord(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null)
  );
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
