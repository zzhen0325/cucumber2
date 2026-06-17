import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  CanvasPatch,
} from "../types/canvas";

export type CanvasMutationReason =
  | "reactflow-node-change"
  | "reactflow-edge-change"
  | "manual-create"
  | "paste"
  | "text-edit"
  | "markdown-edit"
  | "shape-edit"
  | "upload-complete"
  | "upscale-pending"
  | "upscale-complete"
  | "agent-stream-projection"
  | "trace-hydrate"
  | "trace-replay"
  | "auto-layout"
  | "selection"
  | "server-sync";

export type CanvasLocalMutation = {
  reason: CanvasMutationReason;
  patch: CanvasPatch;
  persist?: boolean;
  selectedNodeIds?: string[];
  selectedNodeId?: string | null;
  lastRunId?: string | null;
};

export type CanvasMutationSnapshot = {
  nodes: AgentCanvasNode[];
  edges: AgentCanvasEdge[];
};
