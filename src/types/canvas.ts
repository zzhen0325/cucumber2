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

export type ArtifactPreviewKind =
  | "image"
  | "markdown"
  | "code"
  | "document"
  | "webpage"
  | "dataset"
  | "file"
  | "decision"
  | "memory"
  | "toolResult";

export type ArtifactMetadata = Record<string, unknown> & {
  byteSize?: number;
  createdBy?: string;
  digest?: string;
  mimeType?: string;
  previewKind?: ArtifactPreviewKind;
  sourceRunNodeId?: string;
  sourceToolName?: string;
};

export type ArtifactRef = {
  id: string;
  type: ArtifactType;
  uri?: string;
  title?: string;
  summary?: string;
  preview?: string;
  previewKind?: ArtifactPreviewKind;
  mimeType?: string;
  sizeBytes?: number;
  version?: number;
  metadata?: ArtifactMetadata;
  contentRef?: string;
};

export type ArtifactRefLite = Omit<ArtifactRef, "metadata"> & {
  metadata?: ArtifactMetadata;
};

export type LocalUploadState = {
  status: "uploading" | "error";
  error?: string;
  localPreviewUrl?: string;
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
  content?: string;
  contentFormat?: string;
  mimeType?: string;
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

export type GeneratedHtmlPage = {
  id: string;
  title: string;
  html: string;
  previewUrl: string;
  summary?: string;
  artifact?: ArtifactRef;
};

export type ImageResultStatus = "loading" | "ready" | "error";

export type ImageRequestPreview = {
  index?: number;
  count?: number;
  width?: number;
  height?: number;
  size?: number;
  aspectRatio?: string;
};

export type CanvasToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

export type CanvasToolPart = {
  type: `tool-${string}`;
  state: CanvasToolState;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
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

export type RunSummaryItem = {
  kind: "agent" | "handoff" | "skill" | "artifact" | "canvas";
  label: string;
  detail?: string;
};

export type CanvasAgentMessage = {
  id: string;
  role: "assistant";
  content: string;
  agentName?: string;
  kind?: "assistant" | "progress";
  status?: "streaming" | "completed";
};

export type RunPlanItem = {
  id: string;
  label: string;
  phase?: "prepare" | "route" | "execute" | "materialize";
  status: AgentRunStatus;
};

export type PromptNodeData = {
  kind: "prompt";
  prompt: string;
  contextLabel: string;
  createdAt: string;
  manual?: boolean;
};

export type RunNodeData = {
  kind: "run";
  prompt: string;
  status: AgentRunStatus;
  agentText?: string;
  agentMessages?: CanvasAgentMessage[];
  outputKind?: "simple" | "artifact";
  toolParts?: CanvasToolPart[];
  toolPart?: CanvasToolPart;
  error?: string;
  plan?: RunPlanItem[];
  currentStep?: RunStepTimelineItem;
  stepTimeline?: RunStepTimelineItem[];
  decision?: string;
  summaryItems?: RunSummaryItem[];
  traceAvailable?: boolean;
};

export type ImageResultNodeData = {
  kind: "imageResult";
  image: GeneratedImage;
  artifact?: ArtifactRef;
  prompt: string;
  runId?: string;
  sourceNodeId?: string;
  operation?: "matting" | "upscale";
  request?: ImageRequestPreview;
  status?: ImageResultStatus;
  upload?: LocalUploadState;
};

export type StickyNoteNodeData = {
  kind: "stickyNote";
  text: string;
  color: "yellow" | "green" | "blue" | "pink";
  createdAt: string;
};

export type ShapeVariant =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "triangle"
  | "pill"
  | "frame";

export type ShapeNodeData = {
  kind: "shape";
  shape: ShapeVariant;
  label: string;
  createdAt: string;
};

export type ArtifactBackedNodeData = {
  artifact: ArtifactRef;
  title: string;
  summary?: string;
  prompt?: string;
  runId?: string;
  createdAt?: string;
  upload?: LocalUploadState;
};

export type ArtifactNodeData = ArtifactBackedNodeData & {
  kind: "artifact";
};

export type MarkdownNodeData = ArtifactBackedNodeData & {
  kind: "markdown";
  content: string;
  blockNoteBlocks?: unknown[];
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
  code?: string;
  language?: string;
};

export type WebpageNodeData = ArtifactBackedNodeData & {
  kind: "webpage";
  html?: string;
  previewUrl?: string;
};

export type AgentCanvasNodeData =
  | PromptNodeData
  | RunNodeData
  | ImageResultNodeData
  | StickyNoteNodeData
  | ShapeNodeData
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

export type CanvasPatch = {
  nodeUpserts?: AgentCanvasNode[];
  nodeDeletes?: string[];
  edgeUpserts?: AgentCanvasEdge[];
  edgeDeletes?: string[];
};

export type RunDraft = {
  promptNode: AgentCanvasNode;
  runNode: AgentCanvasNode;
  edges: AgentCanvasEdge[];
  upstreamContext: UpstreamContextItem[];
  omittedContext: UpstreamContextItem[];
  contextTrace?: {
    selectedNodeId: string | null;
    selectedNodeIds: string[];
    budget?: number;
    omittedContextReason?: string;
    omittedNodeIds: string[];
  };
};
