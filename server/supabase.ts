import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { AgentRunStatus } from "../src/types/canvas.ts";

type CanvasSnapshotInput = {
  canvasId?: string;
  title: string;
  nodes: unknown[];
  edges: unknown[];
  selectedNodeId?: string | null;
  lastRunId?: string | null;
};

export type CanvasSnapshot = {
  id: string;
  title: string;
  nodes: unknown[];
  edges: unknown[];
  selectedNodeId: string | null;
  lastRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

type RunEventInput = {
  canvasId: string;
  runNodeId: string;
  prompt: string;
  selectedNodeId?: string | null;
  upstreamContext: unknown[];
  status: AgentRunStatus;
  toolInput?: unknown;
  toolOutput?: unknown;
  errorText?: string | null;
};

type CanvasRow = {
  id: string;
  title: string;
  nodes: unknown[];
  edges: unknown[];
  selected_node_id: string | null;
  last_run_id: string | null;
  created_at: string;
  updated_at: string;
};

let cachedClient: SupabaseClient | null = null;

export function isSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseSecretKey());
}

export async function getDefaultCanvas() {
  const client = getSupabaseClient();
  const configuredCanvasId = process.env.SUPABASE_DEFAULT_CANVAS_ID?.trim();

  if (configuredCanvasId) {
    const { data, error } = await client
      .from("agent_canvases")
      .select("*")
      .eq("id", configuredCanvasId)
      .maybeSingle<CanvasRow>();

    if (error) {
      throw error;
    }

    if (data) {
      return mapCanvasRow(data);
    }
  }

  const { data: existing, error: selectError } = await client
    .from("agent_canvases")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<CanvasRow>();

  if (selectError) {
    throw selectError;
  }

  if (existing) {
    return mapCanvasRow(existing);
  }

  const { data: created, error: insertError } = await client
    .from("agent_canvases")
    .insert({ title: "Untitled" })
    .select()
    .single<CanvasRow>();

  if (insertError) {
    throw insertError;
  }

  return mapCanvasRow(created);
}

export async function saveCanvasSnapshot(input: CanvasSnapshotInput) {
  const client = getSupabaseClient();
  const payload = {
    title: input.title,
    nodes: input.nodes,
    edges: input.edges,
    selected_node_id: input.selectedNodeId ?? null,
    last_run_id: input.lastRunId ?? null,
  };

  if (!input.canvasId) {
    const { data, error } = await client
      .from("agent_canvases")
      .insert(payload)
      .select()
      .single<CanvasRow>();

    if (error) {
      throw error;
    }

    return mapCanvasRow(data);
  }

  const { data, error } = await client
    .from("agent_canvases")
    .update(payload)
    .eq("id", input.canvasId)
    .select()
    .single<CanvasRow>();

  if (error) {
    throw error;
  }

  return mapCanvasRow(data);
}

export async function recordRunEvent(input: RunEventInput) {
  const client = getSupabaseClient();
  const { error } = await client.from("agent_run_events").insert({
    canvas_id: input.canvasId,
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

function mapCanvasRow(row: CanvasRow): CanvasSnapshot {
  return {
    id: row.id,
    title: row.title,
    nodes: row.nodes,
    edges: row.edges,
    selectedNodeId: row.selected_node_id,
    lastRunId: row.last_run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
