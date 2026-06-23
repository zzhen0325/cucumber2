import type {
  AgentCanvasEdge,
  AgentCanvasNode,
} from "../src/types/canvas.ts";
import {
  toPersistableEdge,
  toPersistableNode,
} from "../src/lib/canvas-persistence.ts";
import { getSupabaseClient } from "./supabase.ts";

export type ProjectMeta = {
  id: string;
  title: string;
  selectedNodeId: string | null;
  lastRunId: string | null;
  version: number;
  nodeCount: number;
  edgeCount: number;
  imageCount: number;
  snapshotBytes: number;
  createdAt: string;
  updatedAt: string;
};

export type CanvasSnapshot = {
  nodes: AgentCanvasNode[];
  edges: AgentCanvasEdge[];
};

export type CanvasProject = ProjectMeta & CanvasSnapshot;

export class ProjectVersionConflictError extends Error {
  readonly project: ProjectMeta;

  constructor(project: ProjectMeta) {
    super("Project version conflict.");
    this.name = "ProjectVersionConflictError";
    this.project = project;
  }
}

type ProjectMetaRow = {
  id: string;
  user_id: string | null;
  title: string;
  selected_node_id: string | null;
  last_run_id: string | null;
  version: number | null;
  node_count: number | null;
  edge_count: number | null;
  image_count: number | null;
  snapshot_bytes: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type CanvasNodeRow = {
  project_id: string;
  node_id: string;
  type: string | null;
  kind: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  node_json: unknown;
  run_id: string | null;
  source_node_id: string | null;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type CanvasEdgeRow = {
  project_id: string;
  edge_id: string;
  source_node_id: string;
  target_node_id: string;
  type: string | null;
  edge_json: unknown;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type RpcProjectMeta = {
  id: string;
  title: string;
  selectedNodeId: string | null;
  lastRunId: string | null;
  version: number;
  nodeCount: number;
  edgeCount: number;
  imageCount: number;
  snapshotBytes: number;
  createdAt: string;
  updatedAt: string;
};

export async function createProjectForUser(userId: string, title: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_projects")
    .insert({ user_id: userId, title })
    .select(projectMetaSelect)
    .single<ProjectMetaRow>();

  if (error) {
    throw error;
  }

  return mapProjectMetaRow(data);
}

export async function getProjectMetaForUser(projectId: string, userId: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("agent_projects")
    .select(projectMetaSelect)
    .eq("id", projectId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle<ProjectMetaRow>();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  return mapProjectMetaRow(data);
}

export async function updateProjectMetaForUser(input: {
  projectId: string;
  userId: string;
  title?: string;
  selectedNodeId?: string | null;
  lastRunId?: string | null;
}) {
  const current = await getProjectMetaForUser(input.projectId, input.userId);
  if (!current) {
    return null;
  }

  const payload: Record<string, unknown> = {
    version: current.version + 1,
  };
  if (input.title !== undefined) {
    payload.title = input.title;
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
    .select(projectMetaSelect)
    .maybeSingle<ProjectMetaRow>();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  return mapProjectMetaRow(data);
}

export async function loadCanvasSnapshotForUser(
  projectId: string,
  userId: string
): Promise<CanvasProject | null> {
  const project = await getProjectMetaForUser(projectId, userId);
  if (!project) {
    return null;
  }

  const client = getSupabaseClient();
  const { data: nodeRows, error: nodeError } = await client
    .from("agent_canvas_nodes")
    .select("*")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .returns<CanvasNodeRow[]>();

  if (nodeError) {
    throw nodeError;
  }

  const { data: edgeRows, error: edgeError } = await client
    .from("agent_canvas_edges")
    .select("*")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .returns<CanvasEdgeRow[]>();

  if (edgeError) {
    throw edgeError;
  }

  return {
    ...project,
    nodes: nodeRows.map(rowToNode),
    edges: edgeRows.map(rowToEdge),
  };
}

export async function applyCanvasPatchForUser(input: {
  projectId: string;
  userId: string;
  expectedVersion?: number;
  nodeUpserts?: AgentCanvasNode[];
  nodeDeletes?: string[];
  edgeUpserts?: AgentCanvasEdge[];
  edgeDeletes?: string[];
  selectedNodeId?: string | null;
  lastRunId?: string | null;
}): Promise<ProjectMeta | null> {
  const nodeUpserts = await protectMaterializedRuntimeNodeUpsertsForUser({
    projectId: input.projectId,
    userId: input.userId,
    nodeUpserts: input.nodeUpserts,
  });
  const nodeRows = nodeUpserts.map((node) =>
    nodeToRow(input.projectId, node)
  );
  const edgeRows = (input.edgeUpserts ?? []).map((edge) =>
    edgeToRow(input.projectId, edge)
  );

  const client = getSupabaseClient();
  const { data, error } = await client.rpc("apply_canvas_patch", {
    p_edge_deletes: input.edgeDeletes ?? [],
    p_edge_upserts: edgeRows,
    p_expected_version: input.expectedVersion ?? null,
    p_last_run_id: input.lastRunId ?? null,
    p_node_deletes: input.nodeDeletes ?? [],
    p_node_upserts: nodeRows,
    p_project_id: input.projectId,
    p_selected_node_id: input.selectedNodeId ?? null,
    p_user_id: input.userId,
  });

  if (error) {
    if (isVersionConflictError(error)) {
      const current = await getProjectMetaForUser(input.projectId, input.userId);
      if (current) {
        throw new ProjectVersionConflictError(current);
      }
    }
    if (isProjectNotFoundError(error)) {
      return null;
    }
    throw error;
  }

  return mapRpcProjectMeta(data as RpcProjectMeta);
}

async function protectMaterializedRuntimeNodeUpsertsForUser({
  projectId,
  userId,
  nodeUpserts,
}: {
  projectId: string;
  userId: string;
  nodeUpserts?: AgentCanvasNode[];
}) {
  if (!nodeUpserts?.length) {
    return [];
  }

  const current = await loadCanvasSnapshotForUser(projectId, userId);
  if (!current) {
    return nodeUpserts;
  }

  return preserveMaterializedRuntimeNodeUpserts(current.nodes, nodeUpserts);
}

export function preserveMaterializedRuntimeNodeUpserts(
  currentNodes: AgentCanvasNode[],
  nodeUpserts: AgentCanvasNode[]
) {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  return nodeUpserts.map((incoming) => {
    const existing = currentById.get(incoming.id);
    if (!existing) {
      return incoming;
    }

    if (
      shouldPreserveMaterializedImageResult(existing, incoming) ||
      shouldPreserveMaterializedArtifactNode(existing, incoming)
    ) {
      return preserveExistingRuntimeNode(existing, incoming);
    }

    return incoming;
  });
}

function shouldPreserveMaterializedImageResult(
  existing: AgentCanvasNode,
  incoming: AgentCanvasNode
) {
  if (
    existing.data.kind !== "imageResult" ||
    incoming.data.kind !== "imageResult"
  ) {
    return false;
  }
  if (!sameRuntimeRun(existing, incoming)) {
    return false;
  }

  return isMaterializedImageResult(existing) && isPendingImageResult(incoming);
}

function shouldPreserveMaterializedArtifactNode(
  existing: AgentCanvasNode,
  incoming: AgentCanvasNode
) {
  if (
    existing.data.kind !== incoming.data.kind ||
    existing.data.kind === "imageResult" ||
    incoming.data.kind === "imageResult"
  ) {
    return false;
  }
  if (!sameRuntimeRun(existing, incoming)) {
    return false;
  }
  if (!("artifact" in existing.data) || !("artifact" in incoming.data)) {
    return false;
  }

  return (
    !isPendingArtifactId(existing.data.artifact.id) &&
    isPendingArtifactId(incoming.data.artifact.id)
  );
}

function preserveExistingRuntimeNode(
  existing: AgentCanvasNode,
  incoming: AgentCanvasNode
): AgentCanvasNode {
  return {
    ...existing,
    position: incoming.position,
  };
}

function sameRuntimeRun(existing: AgentCanvasNode, incoming: AgentCanvasNode) {
  const existingRunId = "runId" in existing.data ? existing.data.runId : undefined;
  const incomingRunId = "runId" in incoming.data ? incoming.data.runId : undefined;
  return Boolean(existingRunId && existingRunId === incomingRunId);
}

function isMaterializedImageResult(node: AgentCanvasNode) {
  if (node.data.kind !== "imageResult") {
    return false;
  }

  const artifactId = node.data.artifact?.id ?? node.data.image.artifact?.id;
  return Boolean(
    node.data.status === "ready" ||
      node.data.image.url ||
      (artifactId && !isPendingArtifactId(artifactId))
  );
}

function isPendingImageResult(node: AgentCanvasNode) {
  if (node.data.kind !== "imageResult") {
    return false;
  }

  const artifactId = node.data.artifact?.id ?? node.data.image.artifact?.id;
  return Boolean(
    node.data.status === "loading" ||
      !node.data.image.url ||
      isPendingArtifactId(node.data.image.id) ||
      (artifactId && isPendingArtifactId(artifactId))
  );
}

function isPendingArtifactId(id: string | undefined) {
  return Boolean(id?.startsWith("pending-"));
}

export function nodeToRow(projectId: string, node: AgentCanvasNode) {
  const cleanNode = toPersistableNode(node);
  return {
    project_id: projectId,
    node_id: cleanNode.id,
    type: cleanNode.type ?? null,
    kind: cleanNode.data.kind,
    x: cleanNode.position.x,
    y: cleanNode.position.y,
    width: readNodeWidth(cleanNode),
    height: readNodeHeight(cleanNode),
    node_json: cleanNode,
    run_id: "runId" in cleanNode.data ? cleanNode.data.runId ?? null : null,
    source_node_id:
      "sourceNodeId" in cleanNode.data
        ? cleanNode.data.sourceNodeId ?? null
        : null,
  };
}

export function rowToNode(row: CanvasNodeRow): AgentCanvasNode {
  const node = normalizeNodeJson(row.node_json);
  return {
    ...node,
    id: row.node_id,
    type: row.type ?? node.type,
    position: {
      x: row.x,
      y: row.y,
    },
    width: row.width ?? node.width,
    height: row.height ?? node.height,
  };
}

export function edgeToRow(projectId: string, edge: AgentCanvasEdge) {
  const cleanEdge = toPersistableEdge(edge);
  return {
    project_id: projectId,
    edge_id: cleanEdge.id,
    source_node_id: cleanEdge.source,
    target_node_id: cleanEdge.target,
    type: cleanEdge.type ?? null,
    edge_json: cleanEdge,
  };
}

export function rowToEdge(row: CanvasEdgeRow): AgentCanvasEdge {
  const edge = normalizeEdgeJson(row.edge_json);
  return {
    ...edge,
    id: row.edge_id,
    source: row.source_node_id,
    target: row.target_node_id,
    type: row.type ?? edge.type,
  };
}

const projectMetaSelect = [
  "id",
  "user_id",
  "title",
  "selected_node_id",
  "last_run_id",
  "version",
  "node_count",
  "edge_count",
  "image_count",
  "snapshot_bytes",
  "deleted_at",
  "created_at",
  "updated_at",
].join(",");

function mapProjectMetaRow(row: ProjectMetaRow): ProjectMeta {
  return {
    id: row.id,
    title: row.title,
    selectedNodeId: row.selected_node_id,
    lastRunId: row.last_run_id,
    version: row.version ?? 0,
    nodeCount: row.node_count ?? 0,
    edgeCount: row.edge_count ?? 0,
    imageCount: row.image_count ?? 0,
    snapshotBytes: row.snapshot_bytes ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRpcProjectMeta(meta: RpcProjectMeta): ProjectMeta {
  return {
    id: meta.id,
    title: meta.title,
    selectedNodeId: meta.selectedNodeId,
    lastRunId: meta.lastRunId,
    version: meta.version,
    nodeCount: meta.nodeCount,
    edgeCount: meta.edgeCount,
    imageCount: meta.imageCount,
    snapshotBytes: meta.snapshotBytes,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

function normalizeNodeJson(value: unknown): AgentCanvasNode {
  if (!value || typeof value !== "object") {
    throw new Error("Canvas node row has invalid node_json.");
  }

  const node = value as AgentCanvasNode;
  const data = node.data as Record<string, unknown>;
  if (node.data.kind === "markdown" && !("content" in data)) {
    return {
      ...node,
      data: {
        ...data,
        content:
          (typeof data.preview === "string" ? data.preview : data.summary) ?? "",
      },
    } as AgentCanvasNode;
  }

  return node;
}

function normalizeEdgeJson(value: unknown): AgentCanvasEdge {
  if (!value || typeof value !== "object") {
    throw new Error("Canvas edge row has invalid edge_json.");
  }

  return value as AgentCanvasEdge;
}

function readNodeWidth(node: AgentCanvasNode) {
  return readFiniteNumber(node.width) ?? readFiniteNumber(node.style?.width);
}

function readNodeHeight(node: AgentCanvasNode) {
  return readFiniteNumber(node.height) ?? readFiniteNumber(node.style?.height);
}

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isVersionConflictError(error: { message?: string; code?: string }) {
  return (
    error.message?.includes("version_conflict") ||
    error.code === "P0001"
  );
}

function isProjectNotFoundError(error: { message?: string; code?: string }) {
  return (
    error.message?.includes("project_not_found") ||
    error.code === "P0002"
  );
}
