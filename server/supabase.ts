import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createInMemorySupabaseClient, isInMemoryDbEnabled } from "./dev/in-memory-supabase.ts";
import { canAccessProject } from "./project-access.ts";
import { assertLeanArtifactMetadata } from "../src/lib/canvas-persistence.ts";
import type {
  ArtifactPreviewKind,
  ArtifactType,
} from "../src/types/canvas.ts";
import type { AgentEvent, AgentEventType } from "../src/types/runtime.ts";
import { parseCapabilities } from "./agent/skills/skill-parser.ts";
import type {
  AgentSkillBindings,
  AgentSkillCapability,
  AgentSkillPurpose,
  AgentSkillScope,
  AgentSkillScriptManifest,
  AgentSkillSourceType,
  AgentSkillTriggers,
} from "./agent/skills/skill-parser.ts";

export type AppUser = {
  id: string;
  username: string;
  createdAt: string;
};

export type ProjectSummary = {
  id: string;
  title: string;
  nodeCount: number;
  edgeCount: number;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentEventRecord = {
  id: string;
  projectId: string;
  runNodeId: string;
  stepId: string;
  type: AgentEventType;
  payload: Record<string, unknown>;
  errorText: string | null;
  createdAt: string;
};

export type AgentArtifactOrigin =
  | "user_upload"
  | "seedream_generated"
  | "coze_generated";

export type AgentArtifactRecord = {
  id: string;
  projectId: string;
  runNodeId: string | null;
  type: ArtifactType;
  uri: string | null;
  title: string | null;
  metadata: Record<string, unknown>;
  contentRef: string | null;
  toolCallId: string | null;
  sourceNodeId: string | null;
  bucketId: string | null;
  storagePath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  summary: string | null;
  previewText: string | null;
  previewKind: ArtifactPreviewKind | null;
  version: number | null;
  updatedAt: string | null;
  origin: AgentArtifactOrigin;
  createdBy: string | null;
  createdAt: string;
};

export type AgentKnowledgeChunkRecord = {
  id: string;
  projectId: string;
  sourceArtifactId: string;
  sourceNodeId: string | null;
  textExcerpt: string;
  textExcerptDigest: string;
  keywordIndex: string[];
  embedding: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AgentSkillDefinitionSummary = {
  id: string;
  name: string;
  description: string;
  agentScope: AgentSkillScope;
  purpose: AgentSkillPurpose;
  capabilities: AgentSkillCapability[];
  produces: string[];
  uses: string[];
  notFor: string[];
  tags: string[];
  triggers: AgentSkillTriggers;
  bindings: AgentSkillBindings;
  scripts: AgentSkillScriptManifest[];
  packageBucket: string | null;
  packagePath: string | null;
  packageSha256: string | null;
  packageSizeBytes: number | null;
  enabled: boolean;
  sourceType: AgentSkillSourceType;
  sourceManifest: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentSkillDefinition = AgentSkillDefinitionSummary & {
  body: string;
  frontmatter: Record<string, unknown>;
  skillMd: string;
};

type CreateUserInput = {
  username: string;
  passwordHash: string;
};

type CreateSessionInput = {
  userId: string;
  tokenHash: string;
  expiresAt: string;
};

type SaveAgentSkillDefinitionInput = {
  agentScope?: AgentSkillScope;
  body: string;
  bindings?: AgentSkillBindings;
  createdBy?: string | null;
  description: string;
  enabled?: boolean;
  frontmatter: Record<string, unknown>;
  name: string;
  packageBucket?: string | null;
  packagePath?: string | null;
  packageSha256?: string | null;
  packageSizeBytes?: number | null;
  purpose?: AgentSkillPurpose;
  scripts?: AgentSkillScriptManifest[];
  skillMd: string;
  sourceManifest?: Record<string, unknown>;
  sourceType?: AgentSkillSourceType;
  tags?: string[];
  triggers?: AgentSkillTriggers;
};

type UpdateAgentSkillDefinitionInput = Partial<SaveAgentSkillDefinitionInput> & {
  id: string;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
};

type ProjectAccessRow = {
  id: string;
  user_id: string | null;
  deleted_at: string | null;
};

type ProjectSummaryRow = {
  id: string;
  title: string;
  node_count: number | null;
  edge_count: number | null;
  image_count: number | null;
  created_at: string;
  updated_at: string;
};

type AgentEventRow = {
  id: string;
  project_id: string;
  run_node_id: string;
  step_id: string;
  type: AgentEventType;
  payload: Record<string, unknown> | null;
  error_text: string | null;
  created_at: string;
};

type AgentArtifactRow = {
  id: string;
  project_id: string;
  run_node_id: string | null;
  type: ArtifactType;
  uri: string | null;
  title: string | null;
  metadata: Record<string, unknown> | null;
  content_ref: string | null;
  tool_call_id: string | null;
  source_node_id: string | null;
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
  origin: AgentArtifactOrigin | null;
  created_by: string | null;
  created_at: string;
};

type AgentKnowledgeChunkRow = {
  id: string;
  project_id: string;
  source_artifact_id: string;
  source_node_id: string | null;
  text_excerpt: string;
  text_excerpt_digest: string;
  keyword_index: string[] | null;
  embedding: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type AgentSkillDefinitionRow = {
  id: string;
  name: string;
  description: string;
  skill_md: string;
  body: string;
  frontmatter: Record<string, unknown> | null;
  agent_scope: AgentSkillScope;
  purpose: AgentSkillPurpose;
  tags: string[] | null;
  triggers: AgentSkillTriggers | null;
  bindings: AgentSkillBindings | null;
  scripts: AgentSkillScriptManifest[] | null;
  package_bucket: string | null;
  package_path: string | null;
  package_sha256: string | null;
  package_size_bytes: number | null;
  enabled: boolean;
  is_default: boolean;
  source_type: AgentSkillSourceType;
  source_manifest: Record<string, unknown> | null;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RegisterAgentArtifactInput = {
  id: string;
  projectId: string;
  userId?: string;
  runNodeId?: string | null;
  type: ArtifactType;
  uri?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown>;
  contentRef?: string | null;
  toolCallId?: string | null;
  sourceNodeId?: string | null;
  bucketId?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  origin: AgentArtifactOrigin;
  createdBy?: string | null;
};

export type UpsertAgentKnowledgeChunkInput = {
  id: string;
  projectId: string;
  sourceArtifactId: string;
  sourceNodeId?: string | null;
  textExcerpt: string;
  textExcerptDigest: string;
  keywordIndex: string[];
  embedding?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

let cachedClient: SupabaseClient | null = null;

export function isSupabaseConfigured() {
  return isInMemoryDbEnabled() || Boolean(getSupabaseUrl() && getSupabaseSecretKey());
}

export async function getUserCount() {
  const client = getSupabaseClient();
  const { count, error } = await client
    .from("app_users")
    .select("id", { count: "exact", head: true });

  if (error) {
    throw error;
  }

  return count ?? 0;
}

export async function getUserByUsername(username: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("app_users")
    .select("*")
    .eq("username", username)
    .maybeSingle<UserRow>();

  if (error) {
    throw error;
  }

  return data;
}

export async function createUser(input: CreateUserInput) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("app_users")
    .insert({
      username: input.username,
      password_hash: input.passwordHash,
    })
    .select()
    .single<UserRow>();

  if (error) {
    throw error;
  }

  return mapUserRow(data);
}

export async function claimUnownedProjects(userId: string) {
  const client = getSupabaseClient();
  const { error } = await client
    .from("agent_projects")
    .update({ user_id: userId })
    .is("user_id", null)
    .is("deleted_at", null);

  if (error) {
    throw error;
  }
}

export async function createSession(input: CreateSessionInput) {
  const client = getSupabaseClient();
  const { error } = await client.from("app_sessions").insert({
    user_id: input.userId,
    token_hash: input.tokenHash,
    expires_at: input.expiresAt,
  });

  if (error) {
    throw error;
  }
}

export async function getSessionUser(tokenHash: string) {
  const client = getSupabaseClient();
  const { data: session, error: sessionError } = await client
    .from("app_sessions")
    .select("*")
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<SessionRow>();

  if (sessionError) {
    throw sessionError;
  }
  if (!session) {
    return null;
  }

  const { data: user, error: userError } = await client
    .from("app_users")
    .select("*")
    .eq("id", session.user_id)
    .maybeSingle<UserRow>();

  if (userError) {
    throw userError;
  }
  if (!user) {
    return null;
  }

  const { error: touchError } = await client
    .from("app_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", session.id);

  if (touchError) {
    throw touchError;
  }

  return mapUserRow(user);
}

export async function deleteSession(tokenHash: string) {
  const client = getSupabaseClient();
  const { error } = await client
    .from("app_sessions")
    .delete()
    .eq("token_hash", tokenHash);

  if (error) {
    throw error;
  }
}

export async function listProjects(userId: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_projects")
    .select("id,title,node_count,edge_count,image_count,created_at,updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .returns<ProjectSummaryRow[]>();

  if (error) {
    throw error;
  }

  return data.map(mapProjectSummaryRow);
}

export async function softDeleteProject(projectId: string, userId: string) {
  const existing = await getProjectRow(projectId);
  if (!canAccessProject(userId, mapProjectAccess(existing))) {
    return false;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

export async function listAgentSkillDefinitions() {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_skill_definitions")
    .select("*")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .returns<AgentSkillDefinitionRow[]>();

  if (error) {
    throw error;
  }

  return data.map(mapAgentSkillDefinitionSummaryRow);
}

export async function getAgentSkillDefinition(id: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_skill_definitions")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle<AgentSkillDefinitionRow>();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  return mapAgentSkillDefinitionRow(data);
}

export async function createAgentSkillDefinition(
  input: SaveAgentSkillDefinitionInput
) {
  const agentScope = input.agentScope ?? "general";
  const purpose = input.purpose ?? "general";
  const enabled = input.enabled ?? true;

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_skill_definitions")
    .insert({
      agent_scope: agentScope,
      body: input.body,
      bindings: input.bindings ?? { agents: [], scopes: [], tools: [] },
      created_by: input.createdBy ?? null,
      description: input.description,
      enabled,
      frontmatter: input.frontmatter,
      is_default: false,
      name: input.name,
      package_bucket: input.packageBucket ?? null,
      package_path: input.packagePath ?? null,
      package_sha256: input.packageSha256 ?? null,
      package_size_bytes: input.packageSizeBytes ?? null,
      purpose,
      scripts: input.scripts ?? [],
      skill_md: input.skillMd,
      source_manifest: input.sourceManifest ?? {},
      source_type: input.sourceType ?? "manual",
      tags: input.tags ?? [],
      triggers: input.triggers ?? { canvasKinds: [], keywords: [] },
    })
    .select()
    .single<AgentSkillDefinitionRow>();

  if (error) {
    throw error;
  }

  return mapAgentSkillDefinitionRow(data);
}

export async function updateAgentSkillDefinition(
  input: UpdateAgentSkillDefinitionInput
) {
  const existing = await getAgentSkillDefinitionRow(input.id);
  if (!existing) {
    return null;
  }

  const agentScope = input.agentScope ?? existing.agent_scope;
  const purpose = input.purpose ?? existing.purpose;
  const payload: Record<string, unknown> = {
    agent_scope: agentScope,
    purpose,
  };

  if (input.body !== undefined) payload.body = input.body;
  if (input.bindings !== undefined) payload.bindings = input.bindings;
  if (input.description !== undefined) payload.description = input.description;
  if (input.enabled !== undefined) payload.enabled = input.enabled;
  if (input.frontmatter !== undefined) payload.frontmatter = input.frontmatter;
  if (input.name !== undefined) payload.name = input.name;
  if (input.packageBucket !== undefined) payload.package_bucket = input.packageBucket;
  if (input.packagePath !== undefined) payload.package_path = input.packagePath;
  if (input.packageSha256 !== undefined) payload.package_sha256 = input.packageSha256;
  if (input.packageSizeBytes !== undefined) {
    payload.package_size_bytes = input.packageSizeBytes;
  }
  if (input.scripts !== undefined) payload.scripts = input.scripts;
  if (input.skillMd !== undefined) payload.skill_md = input.skillMd;
  if (input.sourceManifest !== undefined) {
    payload.source_manifest = input.sourceManifest;
  }
  if (input.sourceType !== undefined) payload.source_type = input.sourceType;
  if (input.tags !== undefined) payload.tags = input.tags;
  if (input.triggers !== undefined) payload.triggers = input.triggers;
  payload.is_default = false;

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_skill_definitions")
    .update(payload)
    .eq("id", input.id)
    .is("deleted_at", null)
    .select()
    .maybeSingle<AgentSkillDefinitionRow>();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  return mapAgentSkillDefinitionRow(data);
}

export async function upsertAgentSkillDefinitionByName(
  input: SaveAgentSkillDefinitionInput
) {
  const existing = await getAgentSkillDefinitionRowByName(input.name);
  if (!existing) {
    return createAgentSkillDefinition(input);
  }

  return updateAgentSkillDefinition({
    ...input,
    id: existing.id,
  });
}

export async function softDeleteAgentSkillDefinition(id: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_skill_definitions")
    .update({
      deleted_at: new Date().toISOString(),
      enabled: false,
      is_default: false,
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

export async function recordAgentEvent(input: AgentEvent) {
  const client = getSupabaseClient();
  const payload: Record<string, unknown> = {
    project_id: input.projectId,
    run_node_id: input.runNodeId,
    step_id: input.stepId,
    type: input.type,
    payload: input.payload,
    error_text: input.errorText ?? null,
  };

  if (input.createdAt) {
    payload.created_at = input.createdAt;
  }

  const { error } = await client.from("agent_run_events").insert(payload);

  if (error) {
    throw error;
  }
}

export async function listAgentEventsForUser({
  projectId,
  runNodeId,
  userId,
}: {
  projectId: string;
  runNodeId: string;
  userId: string;
}) {
  const existing = await getProjectRow(projectId);
  if (!canAccessProject(userId, mapProjectAccess(existing))) {
    return null;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_run_events")
    .select("*")
    .eq("project_id", projectId)
    .eq("run_node_id", runNodeId)
    .order("created_at", { ascending: true })
    .returns<AgentEventRow[]>();

  if (error) {
    throw error;
  }

  return data.map(mapAgentEventRow);
}

export async function registerAgentArtifact(input: RegisterAgentArtifactInput) {
  if (input.userId) {
    const existing = await getProjectRow(input.projectId);
    if (!canAccessProject(input.userId, mapProjectAccess(existing))) {
      return null;
    }
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_artifacts")
    .upsert(
      {
        id: input.id,
        project_id: input.projectId,
        run_node_id: input.runNodeId ?? null,
        type: input.type,
        uri: input.uri ?? null,
        title: input.title ?? null,
        metadata: assertLeanArtifactMetadata(input.metadata) ?? {},
        content_ref: input.contentRef ?? null,
        tool_call_id: input.toolCallId ?? null,
        source_node_id: input.sourceNodeId ?? null,
        bucket_id: input.bucketId ?? null,
        storage_path: input.storagePath ?? null,
        mime_type: input.mimeType ?? null,
        size_bytes: input.sizeBytes ?? null,
        origin: input.origin,
        created_by: input.createdBy ?? input.userId ?? null,
      },
      { onConflict: "id" }
    )
    .select()
    .single<AgentArtifactRow>();

  if (error) {
    throw error;
  }

  return mapAgentArtifactRow(data);
}

export async function getAgentArtifactForUser({
  artifactId,
  projectId,
  userId,
}: {
  artifactId: string;
  projectId: string;
  userId: string;
}) {
  const existing = await getProjectRow(projectId);
  if (!canAccessProject(userId, mapProjectAccess(existing))) {
    return null;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_artifacts")
    .select("*")
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .maybeSingle<AgentArtifactRow>();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  return mapAgentArtifactRow(data);
}

export async function replaceAgentKnowledgeChunksForArtifact({
  chunks,
  projectId,
  sourceArtifactId,
}: {
  chunks: UpsertAgentKnowledgeChunkInput[];
  projectId: string;
  sourceArtifactId: string;
}) {
  const client = getSupabaseClient();
  const { error: deleteError } = await client
    .from("agent_knowledge_chunks")
    .delete()
    .eq("project_id", projectId)
    .eq("source_artifact_id", sourceArtifactId);

  if (deleteError) {
    throw deleteError;
  }

  if (!chunks.length) {
    return [];
  }

  const { data, error } = await client
    .from("agent_knowledge_chunks")
    .upsert(
      chunks.map((chunk) => ({
        id: chunk.id,
        project_id: chunk.projectId,
        source_artifact_id: chunk.sourceArtifactId,
        source_node_id: chunk.sourceNodeId ?? null,
        text_excerpt: chunk.textExcerpt,
        text_excerpt_digest: chunk.textExcerptDigest,
        keyword_index: chunk.keywordIndex,
        embedding: chunk.embedding ?? null,
        metadata: chunk.metadata ?? {},
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "id" }
    )
    .select()
    .returns<AgentKnowledgeChunkRow[]>();

  if (error) {
    throw error;
  }

  return data.map(mapAgentKnowledgeChunkRow);
}

export async function listAgentKnowledgeChunksForProject({
  projectId,
  userId,
}: {
  projectId: string;
  userId: string;
}) {
  const existing = await getProjectRow(projectId);
  if (!canAccessProject(userId, mapProjectAccess(existing))) {
    return null;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_knowledge_chunks")
    .select("*")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .returns<AgentKnowledgeChunkRow[]>();

  if (error) {
    throw error;
  }

  return data.map(mapAgentKnowledgeChunkRow);
}

async function getProjectRow(projectId: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_projects")
    .select(projectAccessSelect)
    .eq("id", projectId)
    .maybeSingle<ProjectAccessRow>();

  if (error) {
    throw error;
  }

  return data;
}

async function getAgentSkillDefinitionRow(id: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_skill_definitions")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle<AgentSkillDefinitionRow>();

  if (error) {
    throw error;
  }

  return data;
}

async function getAgentSkillDefinitionRowByName(name: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_skill_definitions")
    .select("*")
    .eq("name", name)
    .is("deleted_at", null)
    .maybeSingle<AgentSkillDefinitionRow>();

  if (error) {
    throw error;
  }

  return data;
}

export function getSupabaseClient() {
  if (cachedClient) {
    return cachedClient;
  }

  if (isInMemoryDbEnabled()) {
    cachedClient = createInMemorySupabaseClient() as unknown as SupabaseClient;
    return cachedClient;
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseSecretKey = getSupabaseSecretKey();

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error(
      "Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY."
    );
  }

  cachedClient = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedClient;
}

function getSupabaseUrl() {
  return process.env.SUPABASE_URL?.trim();
}

function getSupabaseSecretKey() {
  return (
    process.env.SUPABASE_SECRET_KEY?.trim() ??
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

function mapUserRow(row: UserRow): AppUser {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
  };
}

const projectAccessSelect = "id,user_id,deleted_at";

function mapProjectAccess(row: ProjectAccessRow | null) {
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    deletedAt: row.deleted_at,
  };
}

function mapProjectSummaryRow(row: ProjectSummaryRow): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    nodeCount: row.node_count ?? 0,
    edgeCount: row.edge_count ?? 0,
    imageCount: row.image_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentEventRow(row: AgentEventRow): AgentEventRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    runNodeId: row.run_node_id,
    stepId: row.step_id,
    type: row.type,
    payload: row.payload ?? {},
    errorText: row.error_text,
    createdAt: row.created_at,
  };
}

function mapAgentArtifactRow(row: AgentArtifactRow): AgentArtifactRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    runNodeId: row.run_node_id,
    type: row.type,
    uri: row.uri,
    title: row.title,
    metadata: row.metadata ?? {},
    contentRef: row.content_ref,
    toolCallId: row.tool_call_id,
    sourceNodeId: row.source_node_id,
    bucketId: row.bucket_id,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    summary: row.summary,
    previewText: row.preview_text,
    previewKind: row.preview_kind,
    version: row.version,
    updatedAt: row.updated_at,
    origin: row.origin ?? "user_upload",
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapAgentKnowledgeChunkRow(
  row: AgentKnowledgeChunkRow
): AgentKnowledgeChunkRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceArtifactId: row.source_artifact_id,
    sourceNodeId: row.source_node_id,
    textExcerpt: row.text_excerpt,
    textExcerptDigest: row.text_excerpt_digest,
    keywordIndex: row.keyword_index ?? [],
    embedding: row.embedding,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentSkillDefinitionSummaryRow(
  row: AgentSkillDefinitionRow
): AgentSkillDefinitionSummary {
  const frontmatter = row.frontmatter ?? {};
  return {
    id: row.id,
    agentScope: row.agent_scope,
    bindings: normalizeSkillBindings(row.bindings),
    capabilities: normalizeSkillCapabilities(frontmatter),
    createdAt: row.created_at,
    createdBy: row.created_by,
    description: row.description,
    enabled: row.enabled,
    name: row.name,
    notFor: normalizeFrontmatterStringArray(frontmatter.notFor ?? frontmatter.not_for),
    packageBucket: null,
    packagePath: null,
    packageSha256: row.package_sha256 ?? null,
    packageSizeBytes: row.package_size_bytes ?? null,
    produces: normalizeFrontmatterStringArray(frontmatter.produces),
    purpose: row.purpose,
    scripts: row.scripts ?? [],
    sourceManifest: row.source_manifest ?? {},
    sourceType: row.source_type,
    tags: row.tags ?? [],
    triggers: row.triggers ?? { canvasKinds: [], keywords: [] },
    updatedAt: row.updated_at,
    uses: normalizeFrontmatterStringArray(frontmatter.uses),
  };
}

function normalizeSkillBindings(
  bindings: AgentSkillDefinitionRow["bindings"]
): AgentSkillBindings {
  return {
    agents: bindings?.agents ?? [],
    scopes: bindings?.scopes ?? [],
    tools: bindings?.tools ?? [],
  };
}

function normalizeSkillCapabilities(
  frontmatter: Record<string, unknown>
): AgentSkillCapability[] {
  try {
    return parseCapabilities(frontmatter.capabilities);
  } catch {
    return [];
  }
}

function normalizeFrontmatterStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

function mapAgentSkillDefinitionRow(
  row: AgentSkillDefinitionRow
): AgentSkillDefinition {
  return {
    ...mapAgentSkillDefinitionSummaryRow(row),
    body: row.body,
    frontmatter: row.frontmatter ?? {},
    packageBucket: row.package_bucket ?? null,
    packagePath: row.package_path ?? null,
    skillMd: row.skill_md,
  };
}
