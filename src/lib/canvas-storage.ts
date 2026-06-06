import type { AgentCanvasEdge, AgentCanvasNode } from "@/types/canvas";

export type PersistedCanvas = {
  id: string;
  title: string;
  nodes: AgentCanvasNode[];
  edges: AgentCanvasEdge[];
  selectedNodeId: string | null;
  lastRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SaveCanvasInput = {
  canvasId: string;
  title: string;
  nodes: AgentCanvasNode[];
  edges: AgentCanvasEdge[];
  selectedNodeId: string | null;
  lastRunId: string | null;
};

export async function loadCanvas() {
  const response = await fetch("/api/canvas");
  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as PersistedCanvas;
}

export async function saveCanvas(input: SaveCanvasInput) {
  const response = await fetch("/api/canvas", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as PersistedCanvas;
}

async function getResponseError(response: Response) {
  const text = await response.text();
  return text || `Request failed with status ${response.status}`;
}
