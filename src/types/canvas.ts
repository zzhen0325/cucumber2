import type { Edge, Node } from "@xyflow/react";

export type AgentRunStatus = "queued" | "running" | "success" | "error";

export type UpstreamContextItem = {
  nodeId: string;
  type: "prompt" | "image";
  prompt?: string;
  imageUrl?: string;
  summary?: string;
};

export type GeneratedImage = {
  id: string;
  url: string;
  title?: string;
  metadata?: Record<string, unknown>;
};

export type CanvasToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | "approval-requested"
  | "approval-responded"
  | "output-denied";

export type CanvasToolPart = {
  type: "tool-generate_image";
  state: CanvasToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export type PromptNodeData = {
  kind: "prompt";
  prompt: string;
  contextLabel: string;
  createdAt: string;
};

export type RunNodeData = {
  kind: "run";
  prompt: string;
  status: AgentRunStatus;
  agentText?: string;
  toolPart?: CanvasToolPart;
  error?: string;
};

export type ImageResultNodeData = {
  kind: "imageResult";
  image: GeneratedImage;
  prompt: string;
  runId: string;
};

export type AgentCanvasNodeData =
  | PromptNodeData
  | RunNodeData
  | ImageResultNodeData;

export type AgentCanvasNode = Node<AgentCanvasNodeData>;
export type AgentCanvasEdge = Edge<{ active?: boolean }>;

export type RunDraft = {
  promptNode: AgentCanvasNode;
  runNode: AgentCanvasNode;
  edges: AgentCanvasEdge[];
  upstreamContext: UpstreamContextItem[];
};
