import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  ArtifactRef,
  UpstreamContextItem,
} from "./canvas";

export type AgentRunStatus =
  | "queued"
  | "routing"
  | "building_context"
  | "planning"
  | "running"
  | "waiting_approval"
  | "evaluating"
  | "completed"
  | "failed"
  | "cancelled";

export type LegacyAgentRunStatus = "queued" | "running" | "success" | "error";

export type InputAttachment = {
  id: string;
  kind: "image" | "file" | "doc" | "code" | "webpage" | "dataset";
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  uri?: string;
  contentRef?: string;
  artifact?: ArtifactRef;
  preview?: string;
};

export type InputCanvasContext = {
  promptNodeId?: string | null;
  runNodeId: string;
  selectedNodeId?: string | null;
  upstreamContext: UpstreamContextItem[];
  contextTrace?: {
    selectedNodeId?: string | null;
    budget?: number;
    omittedContextReason?: string;
    omittedNodeIds?: string[];
  };
};

export type ConversationMessageRef = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  summary: string;
  createdAt?: string;
};

export type ApprovalResponseRef = {
  id: string;
  approved: boolean;
  reason?: string;
};

export type ProjectContextRef = {
  id: string;
  kind: "project" | "canvas" | "artifact" | "skill" | "memory";
  title?: string;
  summary?: string;
  contentRef?: string;
};

export type AgentInput = {
  userMessage: string;
  attachments: InputAttachment[];
  approvalResponses: ApprovalResponseRef[];
  canvasContext: InputCanvasContext;
  conversationHistory: ConversationMessageRef[];
  projectRefs: ProjectContextRef[];
  metadata: {
    userId: string;
    sessionId?: string;
    projectId: string;
    runNodeId: string;
    promptNodeId?: string;
    modelProvider: string;
  };
};

export type TaskTarget = {
  id?: string;
  kind: "canvas_node" | "artifact" | "file" | "webpage" | "project" | "unknown";
  ref?: string;
  summary?: string;
};

export type TaskConstraint = {
  kind: "style" | "format" | "policy" | "budget" | "quality" | "other";
  text: string;
};

export type TaskDeliverable = {
  kind:
    | "image"
    | "document"
    | "code"
    | "webpage"
    | "canvas_node"
    | "analysis"
    | "decision";
  description: string;
  count?: number;
};

export type TaskOperation = {
  kind:
    | "generate"
    | "edit"
    | "analyze"
    | "write"
    | "search"
    | "create_canvas_node"
    | "attach_artifact"
    | "evaluate";
  target?: string;
  toolHint?: string;
};

export type StructuredTask = {
  kind:
    | "image_generation"
    | "image_editing"
    | "page_generation"
    | "page_editing"
    | "document_writing"
    | "web_research"
    | "file_analysis"
    | "code_modification"
    | "canvas_operation"
    | "multi_step";
  goals: string[];
  targets: TaskTarget[];
  constraints: TaskConstraint[];
  deliverables: TaskDeliverable[];
  operations: TaskOperation[];
};

export type IntentAmbiguity = {
  id: string;
  question: string;
  options?: string[];
  severity: "low" | "medium" | "high";
};

export type IntentResult = {
  primaryIntent: string;
  confidence: number;
  task: StructuredTask;
  requiredCapabilities: string[];
  requiredTools: string[];
  needsPlanning: boolean;
  ambiguity: IntentAmbiguity[];
  routingReason: string;
};

export type ContextItem = UpstreamContextItem & {
  source: "selected_node" | "upstream_graph" | "attachment" | "history" | "project";
  relevanceScore: number;
  tokenEstimate: number;
  inclusionReason: string;
};

export type OmittedContextItem = UpstreamContextItem & {
  source: ContextItem["source"];
  relevanceScore: number;
  tokenEstimate: number;
  omissionReason: string;
};

export type ToolRiskLevel = "low" | "medium" | "high";

export type ToolPolicy = {
  canUseNetwork: boolean;
  canWriteFiles: boolean;
  canModifyProject: boolean;
  requiresApproval: boolean;
  mayExternalCost: boolean;
};

export type RetryPolicy = {
  maxRetries: number;
  backoffMs: number;
  retryableErrorCodes: string[];
};

export type ToolRenderHint = {
  kind: "text" | "image" | "artifact" | "canvas_operation" | "approval";
  label: string;
};

export type ToolSummary = {
  id: string;
  version: string;
  capabilityId: string;
  name: string;
  description: string;
  inputSchemaDigest: string;
  outputSchemaDigest: string;
  risk: ToolRiskLevel;
  policy: ToolPolicy;
  renderHint: ToolRenderHint;
};

export type SkillInstruction = {
  id: string;
  name: string;
  slug: string;
  summary: string;
};

export type ContextBudget = {
  maxTokens: number;
  usedTokens: number;
  omittedTokens: number;
};

export type ContextBuildTrace = {
  selectedCount: number;
  omittedCount: number;
  selectedNodeId?: string | null;
  toolExposureReason: string;
  skillInjectionReason: string;
};

export type BuiltContext = {
  runId: string;
  taskContext: string;
  selectedItems: ContextItem[];
  omittedItems: OmittedContextItem[];
  availableTools: ToolSummary[];
  injectedSkills: SkillInstruction[];
  promptParts: Array<{
    id: string;
    category: string;
    content: string;
    tokenEstimate: number;
  }>;
  tokenEstimate: number;
  budget: ContextBudget;
  trace: ContextBuildTrace;
};

export type ArtifactExpectation = {
  type: ArtifactRef["type"];
  count?: number;
  description?: string;
};

export type CanvasOperationExpectation = {
  type: CanvasOperation["type"];
  targetNodeId?: string;
  description?: string;
};

export type PlanStep = {
  id: string;
  title: string;
  goal: string;
  kind: "reasoning" | "tool" | "canvas" | "approval" | "evaluation";
  toolId?: string;
  capabilityId?: string;
  input?: unknown;
  dependsOn: string[];
  expectedArtifacts: ArtifactExpectation[];
  expectedCanvasOperations: CanvasOperationExpectation[];
  risk: ToolRiskLevel;
  approvalRequired: boolean;
  retryPolicy?: RetryPolicy;
};

export type AgentStep = {
  id: string;
  planStepId: string;
  status: "queued" | "running" | "success" | "failed" | "skipped" | "waiting_approval";
  input?: unknown;
  output?: ToolResult;
  error?: AgentError;
  startedAt?: string;
  completedAt?: string;
};

export type CanvasOperation =
  | { id: string; projectId?: string; type: "createNode"; payload: { node: AgentCanvasNode } }
  | {
      id: string;
      projectId?: string;
      type: "updateNode";
      payload: {
        nodeId: string;
        position?: AgentCanvasNode["position"];
        data?: Partial<AgentCanvasNode["data"]>;
      };
    }
  | { id: string; projectId?: string; type: "createEdge"; payload: { edge: AgentCanvasEdge } }
  | {
      id: string;
      projectId?: string;
      type: "setNodeStatus";
      payload: { nodeId: string; status: string; error?: string };
    }
  | {
      id: string;
      projectId?: string;
      type: "attachArtifact";
      payload: { nodeId: string; artifactId: string; artifact?: ArtifactRef };
    };

export type ToolLog = {
  level: "info" | "warning" | "error";
  message: string;
  createdAt: string;
};

export type AgentError = {
  id: string;
  code: string;
  message: string;
  retryable: boolean;
  severity: "info" | "warning" | "error" | "fatal";
  stepId?: string;
  toolId?: string;
  details?: Record<string, unknown>;
  createdAt: string;
};

export type ToolResult<T = unknown> = {
  ok: boolean;
  data?: T;
  artifacts: ArtifactRef[];
  canvasOperations: CanvasOperation[];
  logs: ToolLog[];
  error?: AgentError;
};

export type ToolExecutionContext = {
  run: AgentRun;
  step: PlanStep;
  context: BuiltContext;
  previousSteps: AgentStep[];
};

export type ToolDefinition<TInput = unknown, TOutput = unknown> = {
  id: string;
  version: string;
  capabilityId: string;
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  policy: ToolPolicy;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  risk: ToolRiskLevel;
  renderHint: ToolRenderHint;
  execute: (
    input: TInput,
    context: ToolExecutionContext
  ) => Promise<ToolResult<TOutput>>;
};

export type EvaluationResult = {
  passed: boolean;
  issues: Array<{
    code: string;
    message: string;
    severity: "info" | "warning" | "error";
  }>;
  recommendedActions: string[];
  needsRegeneration: boolean;
};

export type AgentRunTrace = {
  events: RuntimeEvent[];
  promptTrace?: Record<string, unknown>;
  validation?: Record<string, unknown>;
};

export type AgentRun = {
  id: string;
  userId: string;
  projectId: string;
  status: AgentRunStatus;
  input: AgentInput;
  intent?: IntentResult;
  context?: BuiltContext;
  plan?: PlanStep[];
  steps: AgentStep[];
  artifacts: ArtifactRef[];
  canvasOperations: CanvasOperation[];
  errors: AgentError[];
  evaluation?: EvaluationResult;
  trace: AgentRunTrace;
  createdAt: string;
  updatedAt: string;
};

export const runtimeEventTypes = [
  "run.created",
  "input.normalized",
  "intent.routed",
  "context.built",
  "plan.created",
  "step.started",
  "step.finished",
  "tool.execution.started",
  "tool.execution.finished",
  "tool.input",
  "tool.output",
  "tool.error",
  "retry.attempt",
  "approval.requested",
  "approval.responded",
  "artifact.created",
  "canvas.operation.proposed",
  "canvas.operation.applied",
  "canvas.operation.rejected",
  "graph.patch.proposed",
  "graph.patch.applied",
  "evaluation.completed",
  "run.completed",
  "run.failed",
] as const;

export type RuntimeEventType = (typeof runtimeEventTypes)[number];

export type RuntimeEvent = {
  id?: string;
  projectId: string;
  runNodeId: string;
  stepId: string;
  type: RuntimeEventType;
  payload: Record<string, unknown>;
  errorText?: string | null;
  createdAt: string;
};

export function toLegacyRunStatus(status: AgentRunStatus): LegacyAgentRunStatus {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed" || status === "cancelled") {
    return "error";
  }
  if (status === "queued") {
    return "queued";
  }
  return "running";
}

export function fromLegacyRunStatus(status: LegacyAgentRunStatus): AgentRunStatus {
  if (status === "success") {
    return "completed";
  }
  if (status === "error") {
    return "failed";
  }
  return status;
}
