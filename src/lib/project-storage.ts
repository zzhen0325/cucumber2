import { getResponseError } from "@/lib/api-client";
import type { RunStepTraceEvent } from "@/lib/graph-projection";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  ArtifactPreviewKind,
  ArtifactRef,
  ArtifactType,
  CanvasPatch,
} from "@/types/canvas";

export type ProjectSummary = {
  id: string;
  title: string;
  nodeCount: number;
  edgeCount: number;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
};

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

export type LoadProjectResult = {
  project: ProjectMeta;
  nodes: AgentCanvasNode[];
  edges: AgentCanvasEdge[];
};

export type UpdateProjectInput = {
  projectId: string;
  title?: string;
  selectedNodeId?: string | null;
  lastRunId?: string | null;
};

export type SaveProjectCanvasPatchInput = {
  projectId: string;
  expectedVersion?: number;
  nodeUpserts?: AgentCanvasNode[];
  nodeDeletes?: string[];
  edgeUpserts?: AgentCanvasEdge[];
  edgeDeletes?: string[];
  selectedNodeId?: string | null;
  lastRunId?: string | null;
};

export type UpscaleProjectImageInput = {
  expectedVersion?: number;
  projectId: string;
  resolution?: "4k" | "8k";
  scale?: number;
  sourceNodeId: string;
};

export type UpscaleProjectImageResult = {
  canvasPatch: CanvasPatch;
  edge: AgentCanvasEdge;
  node: AgentCanvasNode;
  project: ProjectMeta;
};

export type TextArtifactContentFormat =
  | "markdown-json"
  | "markdown"
  | "code"
  | "html"
  | "text"
  | "tool-result-json";

export type TextArtifactInput = {
  projectId: string;
  type: Extract<
    ArtifactType,
    "doc" | "code" | "webpage" | "tool_result" | "decision" | "memory"
  >;
  title: string;
  contentFormat: TextArtifactContentFormat;
  mimeType: string;
  contentText?: string;
  contentJson?: unknown;
  plainText?: string;
  summary?: string;
  previewText?: string;
  previewKind?: ArtifactPreviewKind;
  metadata?: Record<string, unknown>;
};

export type UpdateTextArtifactContentInput = Partial<
  Omit<TextArtifactInput, "contentFormat" | "mimeType" | "projectId" | "type">
> & {
  artifactId: string;
  contentFormat: TextArtifactContentFormat;
  expectedVersion?: number;
  mimeType: string;
  projectId: string;
  type?: TextArtifactInput["type"];
};

export type ArtifactContentResponse = {
  artifact: ArtifactRef & {
    updatedAt: string;
    version: number;
  };
  content: {
    contentFormat: string;
    mimeType: string;
    contentText?: string;
    contentJson?: unknown;
    plainText?: string;
    sizeBytes: number;
    digest?: string;
  };
};

export class ProjectVersionConflictError extends Error {
  readonly project: ProjectMeta;

  constructor(project: ProjectMeta) {
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

  return (await response.json()) as { project: ProjectMeta };
}

export async function loadProject(projectId: string) {
  const response = await fetch(`/api/projects/${projectId}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as LoadProjectResult;
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
      project: ProjectMeta;
    };
    throw new ProjectVersionConflictError(payload.project);
  }

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { project: ProjectMeta };
}

export async function saveProjectCanvasPatch(
  input: SaveProjectCanvasPatchInput,
  init?: Pick<RequestInit, "keepalive">
) {
  const { projectId, ...body } = input;
  const response = await fetch(`/api/projects/${projectId}/canvas`, {
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
      project: ProjectMeta;
    };
    throw new ProjectVersionConflictError(payload.project);
  }

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { project: ProjectMeta };
}

export async function upscaleProjectImage(input: UpscaleProjectImageInput) {
  const { projectId, ...body } = input;
  const response = await fetch(`/api/projects/${projectId}/images/upscale`, {
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (response.status === 409) {
    const payload = (await response.json()) as {
      error: string;
      code?: string;
      project: ProjectMeta;
    };
    throw new ProjectVersionConflictError(payload.project);
  }

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as UpscaleProjectImageResult;
}

export async function createTextArtifact(input: TextArtifactInput) {
  const { projectId, ...body } = input;
  const response = await fetch(`/api/projects/${projectId}/artifacts/text`, {
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as {
    artifact: ArtifactRef & { updatedAt: string; version: number };
  };
}

export async function updateTextArtifactContent(
  input: UpdateTextArtifactContentInput
) {
  const { artifactId, projectId, ...body } = input;
  const response = await fetch(
    `/api/projects/${projectId}/artifacts/${encodeURIComponent(
      artifactId
    )}/content`,
    {
      body: JSON.stringify(body),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "PUT",
    }
  );

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as {
    artifact: ArtifactRef & { updatedAt: string; version: number };
  };
}

export async function fetchArtifactContent(
  projectId: string,
  artifactId: string
) {
  const response = await fetch(
    `/api/projects/${projectId}/artifacts/${encodeURIComponent(
      artifactId
    )}/content`,
    {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as ArtifactContentResponse;
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
