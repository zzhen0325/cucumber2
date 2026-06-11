import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createInMemorySupabaseClient, isInMemoryDbEnabled } from "./dev/in-memory-supabase.ts";
import { canEditSkill } from "./skill-access.ts";
import { canAccessProject } from "./project-access.ts";
import { getProjectSummaryStats } from "../src/lib/project-summary.ts";
import type { RunStepEventInput, RunStepEventType } from "./run-kernel.ts";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  AgentRunStatus,
} from "../src/types/canvas.ts";
import type { AgentRun, AgentStep } from "../src/types/runtime.ts";

export type AppUser = {
  id: string;
  username: string;
  createdAt: string;
};

export type ProjectSummary = {
  id: string;
  title: string;
  nodeCount: number;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentProject = {
  id: string;
  title: string;
  nodes: AgentCanvasNode[];
  edges: AgentCanvasEdge[];
  selectedNodeId: string | null;
  lastRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentRunStepEvent = {
  id: string;
  projectId: string;
  runNodeId: string;
  stepId: string;
  type: RunStepEventType;
  payload: Record<string, unknown>;
  errorText: string | null;
  createdAt: string;
};

export type AgentSkill = {
  id: string;
  ownerUserId: string | null;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  config: Record<string, unknown>;
  sourceManifest: Record<string, unknown>;
  isPublic: boolean;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
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

type UpdateProjectInput = {
  projectId: string;
  userId: string;
  title?: string;
  nodes?: AgentCanvasNode[];
  edges?: AgentCanvasEdge[];
  selectedNodeId?: string | null;
  lastRunId?: string | null;
};

type RunEventInput = {
  projectId: string;
  runNodeId: string;
  prompt: string;
  selectedNodeId?: string | null;
  upstreamContext: unknown[];
  status: AgentRunStatus;
  skillInput?: unknown;
  skillOutput?: unknown;
  toolInput?: unknown;
  toolOutput?: unknown;
  errorText?: string | null;
};

type CreateSkillInput = {
  ownerUserId: string;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  config: Record<string, unknown>;
  sourceManifest: Record<string, unknown>;
};

type CreateArtifactInput = {
  id: string;
  projectId: string;
  runNodeId: string;
  type: string;
  uri?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
  contentRef?: string | null;
  toolCallId?: string | null;
  sourceNodeId?: string | null;
};

type UpsertAgentRunSnapshotInput = {
  run: AgentRun;
};

type UpsertAgentRunStepsInput = {
  projectId: string;
  runNodeId: string;
  steps: AgentStep[];
};

type UpdateSkillInput = {
  skillId: string;
  userId: string;
  name?: string;
  description?: string;
  instructions?: string;
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

type ProjectRow = {
  id: string;
  user_id: string | null;
  title: string;
  nodes: unknown[];
  edges: unknown[];
  selected_node_id: string | null;
  last_run_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type SkillRow = {
  id: string;
  owner_user_id: string | null;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  config: Record<string, unknown> | null;
  source_manifest: Record<string, unknown> | null;
  is_public: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type ArtifactRow = {
  id: string;
  project_id: string;
  run_node_id: string;
  type: string;
  uri: string | null;
  title: string | null;
  metadata: Record<string, unknown> | null;
  content_ref: string | null;
  tool_call_id: string | null;
  source_node_id: string | null;
  created_at: string;
};

type RunStepEventRow = {
  id: string;
  project_id: string;
  run_node_id: string;
  step_id: string;
  type: RunStepEventType;
  payload: Record<string, unknown> | null;
  error_text: string | null;
  created_at: string;
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
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .returns<ProjectRow[]>();

  if (error) {
    throw error;
  }

  return data.map(mapProjectSummaryRow);
}

export async function createProject(userId: string, title: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_projects")
    .insert({ user_id: userId, title })
    .select()
    .single<ProjectRow>();

  if (error) {
    throw error;
  }

  return mapProjectRow(data);
}

export async function getProjectForUser(projectId: string, userId: string) {
  const row = await getProjectRow(projectId);
  if (!canAccessProject(userId, mapProjectAccess(row))) {
    return null;
  }

  return mapProjectRow(row);
}

export async function updateProjectForUser(input: UpdateProjectInput) {
  const existing = await getProjectRow(input.projectId);
  if (!canAccessProject(input.userId, mapProjectAccess(existing))) {
    return null;
  }

  const payload: Record<string, unknown> = {};
  if (input.title !== undefined) {
    payload.title = input.title;
  }
  if (input.nodes !== undefined) {
    payload.nodes = input.nodes;
  }
  if (input.edges !== undefined) {
    payload.edges = input.edges;
  }
  if (input.selectedNodeId !== undefined) {
    payload.selected_node_id = input.selectedNodeId;
  }
  if (input.lastRunId !== undefined) {
    payload.last_run_id = input.lastRunId;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_projects")
    .update(payload)
    .eq("id", input.projectId)
    .eq("user_id", input.userId)
    .is("deleted_at", null)
    .select()
    .maybeSingle<ProjectRow>();

  if (error) {
    throw error;
  }

  return data ? mapProjectRow(data) : null;
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

export async function recordRunEvent(input: RunEventInput) {
  const client = getSupabaseClient();
  const { error } = await client.from("agent_run_events").insert({
    project_id: input.projectId,
    run_node_id: input.runNodeId,
    prompt: input.prompt,
    selected_node_id: input.selectedNodeId ?? null,
    upstream_context: input.upstreamContext,
    status: input.status,
    tool_input: input.skillInput
      ? { skillInput: input.skillInput, toolInput: input.toolInput ?? null }
      : input.toolInput ?? null,
    tool_output: input.skillOutput
      ? { skillOutput: input.skillOutput, toolOutput: input.toolOutput ?? null }
      : input.toolOutput ?? null,
    error_text: input.errorText ?? null,
  });

  if (error) {
    throw error;
  }
}

export async function recordRunStepEvent(input: RunStepEventInput) {
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

  const { error } = await client.from("agent_run_step_events").insert(payload);

  if (error) {
    throw error;
  }
}

export async function upsertAgentRunSnapshot({
  run,
}: UpsertAgentRunSnapshotInput) {
  const client = getSupabaseClient();
  const { error } = await client.from("agent_runs").upsert({
    id: run.id,
    user_id: run.userId,
    project_id: run.projectId,
    run_node_id: run.input.metadata.runNodeId,
    status: run.status,
    input: run.input,
    intent: run.intent ?? null,
    built_context: run.context ?? null,
    plan: run.plan ?? null,
    artifacts: run.artifacts,
    canvas_operations: run.canvasOperations,
    errors: run.errors,
    evaluation: run.evaluation ?? null,
    trace: run.trace,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  });

  if (error) {
    throw error;
  }
}

export async function upsertAgentRunSteps({
  projectId,
  runNodeId,
  steps,
}: UpsertAgentRunStepsInput) {
  if (!steps.length) {
    return;
  }

  const client = getSupabaseClient();
  const { error } = await client.from("agent_run_steps").upsert(
    steps.map((step) => ({
      id: step.id,
      project_id: projectId,
      run_node_id: runNodeId,
      plan_step_id: step.planStepId,
      status: step.status,
      input: summarizeJson(step.input),
      output: summarizeJson(step.output),
      error: step.error ?? null,
      started_at: step.startedAt ?? null,
      completed_at: step.completedAt ?? null,
    }))
  );

  if (error) {
    throw error;
  }
}

export async function listRunStepEventsForUser({
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
    .from("agent_run_step_events")
    .select("*")
    .eq("project_id", projectId)
    .eq("run_node_id", runNodeId)
    .order("created_at", { ascending: true })
    .returns<RunStepEventRow[]>();

  if (error) {
    throw error;
  }

  return data.map(mapRunStepEventRow);
}

export async function createArtifact(input: CreateArtifactInput) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_artifacts")
    .insert({
      id: input.id,
      project_id: input.projectId,
      run_node_id: input.runNodeId,
      type: input.type,
      uri: input.uri ?? null,
      title: input.title ?? null,
      metadata: input.metadata ?? {},
      content_ref: input.contentRef ?? null,
      tool_call_id: input.toolCallId ?? null,
      source_node_id: input.sourceNodeId ?? null,
    })
    .select()
    .single<ArtifactRow>();

  if (error) {
    throw error;
  }

  return mapArtifactRow(data);
}

export async function listPublicSkillsForUser(userId: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_skills")
    .select("*")
    .eq("is_public", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .returns<SkillRow[]>();

  if (error) {
    throw error;
  }

  return data.map((row) => mapSkillRow(row, userId));
}

export async function listLatestPublicSkills() {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_skills")
    .select("*")
    .eq("is_public", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .returns<SkillRow[]>();

  if (error) {
    throw error;
  }

  return data.map((row) => mapSkillRow(row, row.owner_user_id ?? ""));
}

export async function createSkill(input: CreateSkillInput) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_skills")
    .insert({
      owner_user_id: input.ownerUserId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      instructions: input.instructions,
      config: input.config,
      source_manifest: input.sourceManifest,
      is_public: true,
    })
    .select()
    .single<SkillRow>();

  if (error) {
    throw error;
  }

  return mapSkillRow(data, input.ownerUserId);
}

export async function updateSkillForUser(input: UpdateSkillInput) {
  const existing = await getSkillRow(input.skillId);
  if (!canEditSkill(input.userId, mapSkillAccess(existing))) {
    return null;
  }

  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) {
    payload.name = input.name;
  }
  if (input.description !== undefined) {
    payload.description = input.description;
  }
  if (input.instructions !== undefined) {
    payload.instructions = input.instructions;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_skills")
    .update(payload)
    .eq("id", input.skillId)
    .eq("owner_user_id", input.userId)
    .is("deleted_at", null)
    .select()
    .maybeSingle<SkillRow>();

  if (error) {
    throw error;
  }

  return data ? mapSkillRow(data, input.userId) : null;
}

export async function softDeleteSkillForUser(skillId: string, userId: string) {
  const existing = await getSkillRow(skillId);
  if (!canEditSkill(userId, mapSkillAccess(existing))) {
    return false;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_skills")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", skillId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

export async function getLatestPublicSkillBySlug(slug: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_skills")
    .select("*")
    .eq("slug", slug)
    .eq("is_public", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<SkillRow>();

  if (error) {
    throw error;
  }

  return data ? mapSkillRow(data, data.owner_user_id ?? "") : null;
}

async function getProjectRow(projectId: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle<ProjectRow>();

  if (error) {
    throw error;
  }

  return data;
}

async function getSkillRow(skillId: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_skills")
    .select("*")
    .eq("id", skillId)
    .maybeSingle<SkillRow>();

  if (error) {
    throw error;
  }

  return data;
}

function getSupabaseClient() {
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

function summarizeJson(value: unknown) {
  if (value === undefined) {
    return null;
  }

  const json = JSON.stringify(value);
  if (json.length <= 16_000) {
    return value;
  }

  return {
    truncated: true,
    originalBytes: Buffer.byteLength(json),
    preview: json.slice(0, 16_000),
  };
}

function mapUserRow(row: UserRow): AppUser {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
  };
}

function mapProjectAccess(row: ProjectRow | null) {
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    deletedAt: row.deleted_at,
  };
}

function mapSkillAccess(row: SkillRow | null) {
  if (!row) {
    return null;
  }

  return {
    ownerUserId: row.owner_user_id,
    deletedAt: row.deleted_at,
  };
}

function mapProjectSummaryRow(row: ProjectRow): ProjectSummary {
  const nodes = normalizeNodes(row.nodes);
  const stats = getProjectSummaryStats(nodes);

  return {
    id: row.id,
    title: row.title,
    nodeCount: stats.nodeCount,
    imageCount: stats.imageCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProjectRow(row: ProjectRow | null): AgentProject {
  if (!row) {
    throw new Error("Project not found.");
  }

  return {
    id: row.id,
    title: row.title,
    nodes: normalizeNodes(row.nodes),
    edges: normalizeEdges(row.edges),
    selectedNodeId: row.selected_node_id,
    lastRunId: row.last_run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeNodes(nodes: unknown[]) {
  return Array.isArray(nodes) ? (nodes as AgentCanvasNode[]) : [];
}

function normalizeEdges(edges: unknown[]) {
  return Array.isArray(edges) ? (edges as AgentCanvasEdge[]) : [];
}

function mapSkillRow(row: SkillRow, userId: string): AgentSkill {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    instructions: row.instructions,
    config: row.config ?? {},
    sourceManifest: row.source_manifest ?? {},
    isPublic: row.is_public,
    canEdit: canEditSkill(userId, mapSkillAccess(row)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapArtifactRow(row: ArtifactRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    runNodeId: row.run_node_id,
    type: row.type,
    uri: row.uri ?? undefined,
    title: row.title ?? undefined,
    metadata: row.metadata ?? {},
    contentRef: row.content_ref ?? undefined,
    toolCallId: row.tool_call_id ?? undefined,
    sourceNodeId: row.source_node_id ?? undefined,
    createdAt: row.created_at,
  };
}

function mapRunStepEventRow(row: RunStepEventRow): AgentRunStepEvent {
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
