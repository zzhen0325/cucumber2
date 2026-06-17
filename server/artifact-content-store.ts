import { randomUUID } from "node:crypto";

import type {
  ArtifactPreviewKind,
  ArtifactRef,
  ArtifactType,
} from "../src/types/canvas.ts";
import { assertLeanArtifactMetadata } from "../src/lib/canvas-persistence.ts";
import { getSupabaseClient } from "./supabase.ts";
import { getProjectMetaForUser } from "./canvas-store.ts";

export type TextArtifactContentFormat =
  | "markdown-json"
  | "markdown"
  | "code"
  | "html"
  | "text"
  | "tool-result-json";

export type ArtifactContent = {
  contentFormat: string;
  mimeType: string;
  contentText?: string;
  contentJson?: unknown;
  plainText?: string;
  digest?: string;
  sizeBytes: number;
};

export type ArtifactContentResult = {
  artifact: ArtifactRef & {
    updatedAt: string;
    version: number;
  };
  content: ArtifactContent;
};

export class ArtifactVersionConflictError extends Error {
  readonly artifact: ArtifactRef & {
    updatedAt?: string;
    version?: number;
  };

  constructor(artifact: ArtifactRef & { updatedAt?: string; version?: number }) {
    super("Artifact version conflict.");
    this.name = "ArtifactVersionConflictError";
    this.artifact = artifact;
  }
}

type ArtifactRow = {
  id: string;
  project_id: string;
  run_node_id: string | null;
  type: ArtifactType;
  uri: string | null;
  title: string | null;
  metadata: Record<string, unknown> | null;
  content_ref: string | null;
  bucket_id: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  summary: string | null;
  preview_text: string | null;
  preview_kind: ArtifactPreviewKind | null;
  version: number | null;
  deleted_at: string | null;
  updated_at: string | null;
  created_at: string;
};

type ArtifactContentRow = {
  project_id: string;
  artifact_id: string;
  content_format: string;
  mime_type: string;
  content_text: string | null;
  content_json: unknown;
  plain_text: string | null;
  digest: string | null;
  size_bytes: number | null;
  version: number | null;
  deleted_at: string | null;
  updated_at: string;
  created_at: string;
};

type RpcArtifactRef = {
  id: string;
  type: ArtifactType;
  title?: string | null;
  summary?: string | null;
  preview?: string | null;
  previewKind?: ArtifactPreviewKind | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  version: number;
  updatedAt: string;
};

export async function createTextArtifactContentForUser(input: {
  projectId: string;
  userId: string;
  type: ArtifactType;
  title: string;
  contentFormat: TextArtifactContentFormat;
  mimeType: string;
  contentText?: string | null;
  contentJson?: unknown;
  plainText?: string | null;
  summary?: string | null;
  previewText?: string | null;
  previewKind?: ArtifactPreviewKind | null;
  metadata?: Record<string, unknown>;
}) {
  return upsertTextArtifactContentForUser({
    ...input,
    artifactId: `text-${randomUUID()}`,
  });
}

export async function upsertTextArtifactContentForUser(input: {
  projectId: string;
  userId: string;
  artifactId: string;
  expectedVersion?: number;
  type?: ArtifactType;
  title?: string | null;
  contentFormat: TextArtifactContentFormat;
  mimeType: string;
  contentText?: string | null;
  contentJson?: unknown;
  plainText?: string | null;
  summary?: string | null;
  previewText?: string | null;
  previewKind?: ArtifactPreviewKind | null;
  metadata?: Record<string, unknown>;
}) {
  const existing =
    input.title === undefined || input.type === undefined
      ? await getArtifactRefForUser({
          artifactId: input.artifactId,
          projectId: input.projectId,
          userId: input.userId,
        })
      : null;
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("upsert_text_artifact_content", {
    p_artifact_id: input.artifactId,
    p_content_format: input.contentFormat,
    p_content_json: input.contentJson ?? null,
    p_content_text: input.contentText ?? null,
    p_expected_version: input.expectedVersion ?? null,
    p_metadata: assertLeanArtifactMetadata(input.metadata) ?? {},
    p_mime_type: input.mimeType,
    p_plain_text: input.plainText ?? null,
    p_preview_kind: input.previewKind ?? null,
    p_preview_text: input.previewText ?? null,
    p_project_id: input.projectId,
    p_summary: input.summary ?? null,
    p_title: input.title ?? existing?.title ?? null,
    p_type: input.type ?? existing?.type ?? "doc",
    p_user_id: input.userId,
  });

  if (error) {
    if (isArtifactVersionConflictError(error)) {
      const current = await getArtifactRefForUser({
        artifactId: input.artifactId,
        projectId: input.projectId,
        userId: input.userId,
      });
      if (current) {
        throw new ArtifactVersionConflictError(current);
      }
    }
    if (isProjectNotFoundError(error)) {
      return null;
    }
    throw error;
  }

  return mapRpcArtifactRef(data as RpcArtifactRef);
}

export async function getTextArtifactContentForUser({
  artifactId,
  projectId,
  userId,
}: {
  artifactId: string;
  projectId: string;
  userId: string;
}): Promise<ArtifactContentResult | null> {
  const artifact = await getArtifactRowForUser({ artifactId, projectId, userId });
  if (!artifact) {
    return null;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_artifact_contents")
    .select("*")
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId)
    .is("deleted_at", null)
    .maybeSingle<ArtifactContentRow>();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  return {
    artifact: mapArtifactRow(artifact),
    content: {
      contentFormat: data.content_format,
      contentJson: data.content_json ?? undefined,
      contentText: data.content_text ?? undefined,
      digest: data.digest ?? undefined,
      mimeType: data.mime_type,
      plainText: data.plain_text ?? undefined,
      sizeBytes: data.size_bytes ?? 0,
    },
  };
}

async function getArtifactRefForUser(input: {
  artifactId: string;
  projectId: string;
  userId: string;
}) {
  const row = await getArtifactRowForUser(input);
  return row ? mapArtifactRow(row) : null;
}

async function getArtifactRowForUser({
  artifactId,
  projectId,
  userId,
}: {
  artifactId: string;
  projectId: string;
  userId: string;
}) {
  const project = await getProjectMetaForUser(projectId, userId);
  if (!project) {
    return null;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_artifacts")
    .select("*")
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .maybeSingle<ArtifactRow>();

  if (error) {
    throw error;
  }

  return data;
}

function mapRpcArtifactRef(ref: RpcArtifactRef) {
  return {
    id: ref.id,
    mimeType: ref.mimeType ?? undefined,
    preview: ref.preview ?? undefined,
    previewKind: ref.previewKind ?? undefined,
    sizeBytes: ref.sizeBytes ?? undefined,
    summary: ref.summary ?? undefined,
    title: ref.title ?? undefined,
    type: ref.type,
    updatedAt: ref.updatedAt,
    version: ref.version,
  };
}

function mapArtifactRow(row: ArtifactRow): ArtifactRef & {
  updatedAt: string;
  version: number;
} {
  return {
    contentRef: row.content_ref ?? undefined,
    id: row.id,
    metadata: assertLeanArtifactMetadata(row.metadata ?? undefined),
    mimeType: row.mime_type ?? undefined,
    preview: row.preview_text ?? undefined,
    previewKind: row.preview_kind ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    summary: row.summary ?? undefined,
    title: row.title ?? undefined,
    type: row.type,
    updatedAt: row.updated_at ?? row.created_at,
    uri: row.uri ?? undefined,
    version: row.version ?? 0,
  };
}

function isArtifactVersionConflictError(error: {
  message?: string;
  code?: string;
}) {
  return (
    error.message?.includes("artifact_version_conflict") ||
    error.code === "P0001"
  );
}

function isProjectNotFoundError(error: { message?: string; code?: string }) {
  return (
    error.message?.includes("project_not_found") ||
    error.code === "P0002"
  );
}
