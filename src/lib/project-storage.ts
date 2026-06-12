import { getResponseError } from "@/lib/api-client";
import type { RunStepTraceEvent } from "@/lib/graph-projection";
import type { AgentCanvasEdge, AgentCanvasNode, CanvasPatch } from "@/types/canvas";

export type ProjectSummary = {
  id: string;
  title: string;
  nodeCount: number;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PersistedProject = {
  id: string;
  title: string;
  nodes: AgentCanvasNode[];
  edges: AgentCanvasEdge[];
  selectedNodeId: string | null;
  lastRunId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type UpdateProjectInput = {
  projectId: string;
  title?: string;
  nodes?: AgentCanvasNode[];
  edges?: AgentCanvasEdge[];
  canvasPatch?: CanvasPatch;
  selectedNodeId?: string | null;
  lastRunId?: string | null;
  expectedVersion?: number;
};

export class ProjectVersionConflictError extends Error {
  readonly project: PersistedProject;

  constructor(project: PersistedProject) {
    super("Project version conflict.");
    this.name = "ProjectVersionConflictError";
    this.project = project;
  }
}

export async function loadProjects() {
  const response = await fetch("/api/projects", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { projects: ProjectSummary[] };
}

export async function createProject(title = "Untitled") {
  const response = await fetch("/api/projects", {
    body: JSON.stringify({ title }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { project: PersistedProject };
}

export async function loadProject(projectId: string) {
  const response = await fetch(`/api/projects/${projectId}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { project: PersistedProject };
}

export async function updateProject(
  input: UpdateProjectInput,
  init?: Pick<RequestInit, "keepalive">
) {
  const { projectId, ...body } = input;
  const response = await fetch(`/api/projects/${projectId}`, {
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
    method: "PATCH",
  });

  if (response.status === 409) {
    const payload = (await response.json()) as {
      error: string;
      code?: string;
      project: PersistedProject;
    };
    throw new ProjectVersionConflictError(payload.project);
  }

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { project: PersistedProject };
}

export async function loadRunTrace(projectId: string, runNodeId: string) {
  const response = await fetch(
    `/api/projects/${projectId}/runs/${encodeURIComponent(runNodeId)}/trace`,
    {
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { events: RunStepTraceEvent[] };
}

export async function deleteProject(projectId: string) {
  const response = await fetch(`/api/projects/${projectId}`, {
    credentials: "include",
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }
}
