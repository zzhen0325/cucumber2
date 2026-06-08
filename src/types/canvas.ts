import type { Edge, Node } from "@xyflow/react";

export type AgentRunStatus = "queued" | "running" | "success" | "error";

export type ArtifactType =
  | "image"
  | "file"
  | "doc"
  | "code"
  | "webpage"
  | "dataset"
  | "decision"
  | "tool_result"
  | "memory";

export type ArtifactRef = {
  id: string;
  type: ArtifactType;
  uri?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  contentRef?: string;
};

export type UpstreamContextType =
  | "prompt"
  | "image"
  | "artifact"
  | "decision"
  | "memory"
  | "tool_result"
  | "doc"
  | "code"
  | "webpage"
  | "dataset";

export type UpstreamContextItem = {
  nodeId: string;
  type: UpstreamContextType;
  prompt?: string;
  imageUrl?: string;
  summary?: string;
  artifact?: ArtifactRef;
  title?: string;
  contentRef?: string;
  priority?: number;
  omittedReason?: string;
};

export type GeneratedImage = {
  id: string;
  url: string;
  title?: string;
  metadata?: Record<string, unknown>;
  artifact?: ArtifactRef;
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
  type:
    | "tool-analyze_reference_images"
    | "tool-expand_prompt"
    | "tool-generate_image";
  state: CanvasToolState;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: {
    id: string;
    approved?: boolean;
    reason?: string;
  };
};

export type RunStepTimelineItem = {
  id: string;
  label: string;
  status: AgentRunStatus;
  toolName?: string;
  startedAt?: string;
  completedAt?: string;
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
  toolParts?: CanvasToolPart[];
  toolPart?: CanvasToolPart;
  error?: string;
  stepTimeline?: RunStepTimelineItem[];
  decision?: string;
  traceAvailable?: boolean;
};

export type ImageResultNodeData = {
  kind: "imageResult";
  image: GeneratedImage;
  artifact?: ArtifactRef;
  prompt: string;
  runId: string;
};

export type ArtifactBackedNodeData = {
  artifact: ArtifactRef;
  title: string;
  summary?: string;
  prompt?: string;
  runId?: string;
  createdAt?: string;
};

export type ArtifactNodeData = ArtifactBackedNodeData & {
  kind: "artifact";
};

export type MarkdownNodeData = ArtifactBackedNodeData & {
  kind: "markdown";
  content: string;
};

export type DecisionNodeData = ArtifactBackedNodeData & {
  kind: "decision";
  decision: string;
};

export type MemoryNodeData = ArtifactBackedNodeData & {
  kind: "memory";
  memory: string;
};

export type ToolResultNodeData = ArtifactBackedNodeData & {
  kind: "toolResult";
  toolName?: string;
};

export type DocumentNodeData = ArtifactBackedNodeData & {
  kind: "document";
};

export type CodeNodeData = ArtifactBackedNodeData & {
  kind: "code";
  language?: string;
};

export type WebpageNodeData = ArtifactBackedNodeData & {
  kind: "webpage";
};

export type AgentCanvasNodeData =
  | PromptNodeData
  | RunNodeData
  | ImageResultNodeData
  | ArtifactNodeData
  | MarkdownNodeData
  | DecisionNodeData
  | MemoryNodeData
  | ToolResultNodeData
  | DocumentNodeData
  | CodeNodeData
  | WebpageNodeData;

export type AgentCanvasNode = Node<AgentCanvasNodeData>;
export type AgentCanvasEdge = Edge<{ active?: boolean }>;

export type RunDraft = {
  promptNode: AgentCanvasNode;
  runNode: AgentCanvasNode;
  edges: AgentCanvasEdge[];
  upstreamContext: UpstreamContextItem[];
  omittedContext: UpstreamContextItem[];
  contextTrace?: {
    selectedNodeId: string | null;
    budget?: number;
    omittedContextReason?: string;
    omittedNodeIds: string[];
  };
};
