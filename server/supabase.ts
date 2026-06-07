import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { canAccessProject } from "./project-access.ts";
import { getProjectSummaryStats } from "../src/lib/project-summary.ts";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  AgentRunStatus,
} from "../src/types/canvas.ts";

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
  toolInput?: unknown;
  toolOutput?: unknown;
  errorText?: string | null;
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

let cachedClient: SupabaseClient | null = null;

export function isSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseSecretKey());
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
    tool_input: input.toolInput ?? null,
    tool_output: input.toolOutput ?? null,
    error_text: input.errorText ?? null,
  });

  if (error) {
    throw error;
  }
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

function getSupabaseClient() {
  if (cachedClient) {
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

function mapProjectAccess(row: ProjectRow | null) {
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
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
