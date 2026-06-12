import { randomUUID } from "node:crypto";

import type {
  ArtifactRef,
  ArtifactType,
  UpstreamContextItem,
} from "../src/types/canvas.ts";
import {
  getSupabaseClient,
  registerAgentArtifact,
  type AgentArtifactRecord,
} from "./supabase.ts";

export const AGENT_ASSETS_BUCKET = "agent-assets";
export const MAX_AGENT_ASSET_BYTES = 50 * 1024 * 1024;
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
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
};

export function getStorageContentRef(bucket: string, path: string) {
  return `supabase://${bucket}/${path}`;
}

export function parseStorageContentRef(contentRef: string) {
  const match = contentRef.match(/^supabase:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    return null;
  }
  return {
    bucket: match[1],
    path: match[2],
  };
}

export function getArtifactContentUrl(projectId: string, artifactId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(
    artifactId
  )}/content`;
}

export async function createSignedAssetUpload({
  fileName,
  projectId,
  sizeBytes,
}: CreateSignedAssetUploadInput) {
  assertAllowedAssetSize(sizeBytes);

  const uploadId = randomUUID();
  const path = `projects/${projectId}/uploads/${uploadId}/${sanitizeFileName(
    fileName
  )}`;
  const { data, error } = await getSupabaseClient()
    .storage
    .from(AGENT_ASSETS_BUCKET)
    .createSignedUploadUrl(path);

  if (error) {
    throw error;
  }
  if (!data?.token) {
    throw new Error("Supabase did not return a signed upload token.");
  }

  return {
    bucket: AGENT_ASSETS_BUCKET,
    contentRef: getStorageContentRef(AGENT_ASSETS_BUCKET, path),
    expiresIn: 2 * 60 * 60,
    path,
    signedUrl: data.signedUrl,
    token: data.token,
    uploadId,
  };
}

export async function completeSignedAssetUpload(
  input: CompleteSignedAssetUploadInput
): Promise<ArtifactRef> {
  assertExpectedUploadPath(input);
  assertAllowedAssetSize(input.sizeBytes);

  const objectInfo = await getStoredObjectInfo(input.bucket, input.path);
  const artifactId = `upload-${input.uploadId}`;
  const artifactType = getArtifactTypeForUploadKind(input.kind);
  const mimeType = input.mimeType || objectInfo.mimeType || "application/octet-stream";
  const sizeBytes = objectInfo.sizeBytes ?? input.sizeBytes;
  const metadata = compactRecord({
    fileName: input.fileName,
    format: getUploadFormat(input.kind),
    height: input.height,
    mimeType,
    origin: "user_upload",
    size: sizeBytes,
    storageBucket: input.bucket,
    storagePath: input.path,
    summary: input.summary,
    uploadKind: input.kind,
    uploadedAt: new Date().toISOString(),
    width: input.width,
  });

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
    storagePath: input.path,
    title: input.title ?? input.fileName,
    type: artifactType,
    uri:
      artifactType === "image"
        ? getArtifactContentUrl(input.projectId, artifactId)
        : null,
    userId: input.userId,
  });

  if (!record) {
    throw new Error("Project not found.");
  }

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
  assertAllowedAssetSize(bytes.byteLength);

  const path = `${getGeneratedImageStoragePrefix(input)}/${sanitizePathSegment(
    input.artifactId
  )}.${getExtensionForMimeType(mimeType)}`;
  const { error } = await getSupabaseClient()
    .storage
    .from(AGENT_ASSETS_BUCKET)
    .upload(path, bytes, {
      cacheControl: "31536000",
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    throw error;
  }

  const metadata = compactRecord({
    ...input.metadata,
    mimeType,
    origin: "seedream_generated",
    size: bytes.byteLength,
    storageBucket: AGENT_ASSETS_BUCKET,
    storagePath: path,
  });
  const record = await registerAgentArtifact({
    bucketId: AGENT_ASSETS_BUCKET,
    contentRef: getStorageContentRef(AGENT_ASSETS_BUCKET, path),
    createdBy: input.userId,
    id: input.artifactId,
    metadata,
    mimeType,
    origin: "seedream_generated",
    projectId: input.projectId,
    runNodeId: input.runNodeId,
    sizeBytes: bytes.byteLength,
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

  return toArtifactRef(record);
}

function getGeneratedImageStoragePrefix(input: StoreGeneratedImageInput) {
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

export async function resolveStorageBackedImageContext(
  items: UpstreamContextItem[]
): Promise<UpstreamContextItem[]> {
  return Promise.all(
    items.map(async (item) => {
      if (item.type !== "image") {
        return item;
      }

      const contentRef = item.contentRef ?? item.artifact?.contentRef;
      const parsed = contentRef ? parseStorageContentRef(contentRef) : null;
      if (!parsed) {
        return item;
      }

      return {
        ...item,
        imageUrl: await createSignedStorageReadUrl(parsed.bucket, parsed.path),
      };
    })
  );
}

async function createSignedStorageReadUrl(bucket: string, path: string) {
  const { data, error } = await getSupabaseClient()
    .storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_ASSET_READ_TTL_SECONDS);

  if (error) {
    throw error;
  }
  if (!data?.signedUrl) {
    throw new Error("Supabase did not return a signed read URL.");
  }

  return data.signedUrl;
}

async function getStoredObjectInfo(bucket: string, path: string) {
  const { data, error } = await getSupabaseClient()
    .storage
    .from(bucket)
    .info(path);

  if (error) {
    throw error;
  }

  return {
    mimeType: readString(data?.metadata?.mimetype ?? data?.metadata?.mimeType),
    sizeBytes: readNumber(data?.metadata?.size),
  };
}

function toArtifactRef(record: AgentArtifactRecord): ArtifactRef {
  return {
    contentRef: record.contentRef ?? undefined,
    id: record.id,
    metadata: record.metadata,
    title: record.title ?? undefined,
    type: record.type,
    uri: record.uri ?? undefined,
  };
}

function assertExpectedUploadPath(input: CompleteSignedAssetUploadInput) {
  if (input.bucket !== AGENT_ASSETS_BUCKET) {
    throw new Error("Upload bucket does not match the project asset bucket.");
  }

  const expectedPrefix = `projects/${input.projectId}/uploads/${input.uploadId}/`;
  if (!input.path.startsWith(expectedPrefix)) {
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
