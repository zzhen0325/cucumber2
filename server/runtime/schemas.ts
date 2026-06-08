import { z } from "zod";

import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  ArtifactRef,
  UpstreamContextItem,
} from "../../src/types/canvas.ts";
import type {
  AgentRun,
  ArtifactCreatedDataPart,
  BuiltContext,
  CanvasOperationDataPart,
  CanvasOperation,
  IntentResult,
  PlanStep,
  RuntimeEvent,
  RunStatusDataPart,
  TracePointerDataPart,
  ToolResult,
} from "../../src/types/runtime.ts";
import { runtimeEventTypes } from "../../src/types/runtime.ts";

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const runtimeEventTypeSchema = z.enum(runtimeEventTypes);

export const agentRunStatusSchema = z.enum([
  "queued",
  "routing",
  "building_context",
  "planning",
  "running",
  "waiting_approval",
  "evaluating",
  "completed",
  "failed",
  "cancelled",
]);

export const artifactRefSchema = z.custom<ArtifactRef>((value) =>
  Boolean(value && typeof value === "object" && "id" in value && "type" in value)
);

export const upstreamContextItemSchema = z.custom<UpstreamContextItem>((value) =>
  Boolean(value && typeof value === "object" && "nodeId" in value && "type" in value)
);

export const toolPolicySchema = z.object({
  canUseNetwork: z.boolean(),
  canWriteFiles: z.boolean(),
  canModifyProject: z.boolean(),
  requiresApproval: z.boolean(),
  mayExternalCost: z.boolean(),
});

export const retryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(5),
  backoffMs: z.number().int().min(0).max(60_000),
  retryableErrorCodes: z.array(z.string().min(1)),
});

export const toolRenderHintSchema = z.object({
  kind: z.enum(["text", "image", "artifact", "canvas_operation", "approval"]),
  label: z.string().min(1),
});

export const agentErrorSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  severity: z.enum(["info", "warning", "error", "fatal"]),
  stepId: z.string().optional(),
  toolId: z.string().optional(),
  details: jsonObjectSchema.optional(),
  createdAt: z.string().datetime(),
});

export const inputAttachmentSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["image", "file", "doc", "code", "webpage", "dataset"]),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  uri: z.string().optional(),
  contentRef: z.string().optional(),
  artifact: artifactRefSchema.optional(),
  preview: z.string().optional(),
});

export const agentInputSchema = z.object({
  userMessage: z.string(),
  attachments: z.array(inputAttachmentSchema),
  approvalResponses: z.array(
    z.object({
      id: z.string().min(1),
      approved: z.boolean(),
      reason: z.string().optional(),
    })
  ),
  canvasContext: z.object({
    promptNodeId: z.string().nullable().optional(),
    runNodeId: z.string().min(1),
    selectedNodeId: z.string().nullable().optional(),
    upstreamContext: z.array(upstreamContextItemSchema),
    contextTrace: z
      .object({
        selectedNodeId: z.string().nullable().optional(),
        budget: z.number().optional(),
        omittedContextReason: z.string().optional(),
        omittedNodeIds: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  conversationHistory: z.array(
    z.object({
      id: z.string().min(1),
      role: z.enum(["user", "assistant", "system", "tool"]),
      summary: z.string(),
      createdAt: z.string().optional(),
    })
  ),
  projectRefs: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(["project", "canvas", "artifact", "skill", "memory"]),
      title: z.string().optional(),
      summary: z.string().optional(),
      contentRef: z.string().optional(),
    })
  ),
  metadata: z.object({
    userId: z.string().min(1),
    sessionId: z.string().optional(),
    projectId: z.string().min(1),
    runNodeId: z.string().min(1),
    promptNodeId: z.string().optional(),
    modelProvider: z.string().min(1),
  }),
});

export const structuredTaskSchema = z.object({
  kind: z.enum([
    "image_generation",
    "image_editing",
    "page_generation",
    "page_editing",
    "document_writing",
    "web_research",
    "file_analysis",
    "code_modification",
    "canvas_operation",
    "multi_step",
  ]),
  goals: z.array(z.string().min(1)),
  targets: z.array(
    z.object({
      id: z.string().optional(),
      kind: z.enum([
        "canvas_node",
        "artifact",
        "file",
        "webpage",
        "project",
        "unknown",
      ]),
      ref: z.string().optional(),
      summary: z.string().optional(),
    })
  ),
  constraints: z.array(
    z.object({
      kind: z.enum(["style", "format", "policy", "budget", "quality", "other"]),
      text: z.string().min(1),
    })
  ),
  deliverables: z.array(
    z.object({
      kind: z.enum([
        "image",
        "document",
        "code",
        "webpage",
        "canvas_node",
        "analysis",
        "decision",
      ]),
      description: z.string().min(1),
      count: z.number().int().positive().optional(),
    })
  ),
  operations: z.array(
    z.object({
      kind: z.enum([
        "generate",
        "edit",
        "analyze",
        "write",
        "search",
        "create_canvas_node",
        "attach_artifact",
        "evaluate",
      ]),
      target: z.string().optional(),
      toolHint: z.string().optional(),
    })
  ),
});

export const intentResultSchema: z.ZodType<IntentResult> = z.object({
  primaryIntent: z.string().min(1),
  confidence: z.number().min(0).max(1),
  task: structuredTaskSchema,
  requiredCapabilities: z.array(z.string().min(1)),
  requiredTools: z.array(z.string().min(1)),
  needsPlanning: z.boolean(),
  ambiguity: z.array(
    z.object({
      id: z.string().min(1),
      question: z.string().min(1),
      options: z.array(z.string()).optional(),
      severity: z.enum(["low", "medium", "high"]),
    })
  ),
  routingReason: z.string().min(1),
});

export const toolSummarySchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  capabilityId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  inputSchemaDigest: z.string().min(1),
  outputSchemaDigest: z.string().min(1),
  risk: z.enum(["low", "medium", "high"]),
  policy: toolPolicySchema,
  renderHint: toolRenderHintSchema,
});

export const builtContextSchema: z.ZodType<BuiltContext> = z.object({
  runId: z.string().min(1),
  taskContext: z.string(),
  selectedItems: z.array(
    upstreamContextItemSchema.and(
      z.object({
        source: z.enum([
          "selected_node",
          "upstream_graph",
          "attachment",
          "history",
          "project",
        ]),
        relevanceScore: z.number(),
        tokenEstimate: z.number().int().nonnegative(),
        inclusionReason: z.string(),
      })
    )
  ),
  omittedItems: z.array(
    upstreamContextItemSchema.and(
      z.object({
        source: z.enum([
          "selected_node",
          "upstream_graph",
          "attachment",
          "history",
          "project",
        ]),
        relevanceScore: z.number(),
        tokenEstimate: z.number().int().nonnegative(),
        omissionReason: z.string(),
      })
    )
  ),
  availableTools: z.array(toolSummarySchema),
  injectedSkills: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      slug: z.string().min(1),
      summary: z.string(),
    })
  ),
  promptParts: z.array(
    z.object({
      id: z.string().min(1),
      category: z.string().min(1),
      content: z.string(),
      tokenEstimate: z.number().int().nonnegative(),
    })
  ),
  tokenEstimate: z.number().int().nonnegative(),
  budget: z.object({
    maxTokens: z.number().int().positive(),
    usedTokens: z.number().int().nonnegative(),
    omittedTokens: z.number().int().nonnegative(),
  }),
  trace: z.object({
    selectedCount: z.number().int().nonnegative(),
    omittedCount: z.number().int().nonnegative(),
    selectedNodeId: z.string().nullable().optional(),
    toolExposureReason: z.string(),
    skillInjectionReason: z.string(),
  }),
});

export const planStepSchema: z.ZodType<PlanStep> = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().min(1),
  kind: z.enum(["reasoning", "tool", "canvas", "approval", "evaluation"]),
  toolId: z.string().optional(),
  capabilityId: z.string().optional(),
  input: z.unknown().optional(),
  dependsOn: z.array(z.string().min(1)),
  expectedArtifacts: z.array(
    z.object({
      type: z.enum([
        "image",
        "file",
        "doc",
        "code",
        "webpage",
        "dataset",
        "decision",
        "tool_result",
        "memory",
      ]),
      count: z.number().int().positive().optional(),
      description: z.string().optional(),
    })
  ),
  expectedCanvasOperations: z.array(
    z.object({
      type: z.enum([
        "createNode",
        "updateNode",
        "createEdge",
        "setNodeStatus",
        "attachArtifact",
      ]),
      targetNodeId: z.string().optional(),
      description: z.string().optional(),
    })
  ),
  risk: z.enum(["low", "medium", "high"]),
  approvalRequired: z.boolean(),
  retryPolicy: retryPolicySchema.optional(),
});

export const planSchema = z.array(planStepSchema).min(1);

export const canvasOperationSchema = z.custom<CanvasOperation>((value) =>
  Boolean(value && typeof value === "object" && "id" in value && "type" in value)
);

export const toolResultSchema: z.ZodType<ToolResult> = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  artifacts: z.array(artifactRefSchema),
  canvasOperations: z.array(canvasOperationSchema),
  logs: z.array(
    z.object({
      level: z.enum(["info", "warning", "error"]),
      message: z.string(),
      createdAt: z.string().datetime(),
    })
  ),
  error: agentErrorSchema.optional(),
});

export const agentStepSchema = z.object({
  id: z.string().min(1),
  planStepId: z.string().min(1),
  status: z.enum([
    "queued",
    "running",
    "success",
    "failed",
    "skipped",
    "waiting_approval",
  ]),
  input: z.unknown().optional(),
  output: toolResultSchema.optional(),
  error: agentErrorSchema.optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export const runtimeEventSchema: z.ZodType<RuntimeEvent> = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  runNodeId: z.string().min(1),
  stepId: z.string().min(1),
  type: runtimeEventTypeSchema,
  payload: jsonObjectSchema,
  errorText: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});

export const canvasOperationDataPartSchema: z.ZodType<CanvasOperationDataPart> =
  z.object({
    projectId: z.string().min(1),
    runNodeId: z.string().min(1),
    stepId: z.string().min(1),
    eventId: z.string().optional(),
    eventType: z.enum([
      "canvas.operation.proposed",
      "canvas.operation.applied",
      "canvas.operation.rejected",
    ]),
    status: z.enum(["proposed", "applied", "rejected"]),
    operation: canvasOperationSchema,
    reason: z.string().optional(),
    errorCode: z.string().optional(),
    errorText: z.string().nullable().optional(),
    createdAt: z.string().datetime(),
  });

export const artifactCreatedDataPartSchema: z.ZodType<ArtifactCreatedDataPart> =
  z.object({
    projectId: z.string().min(1),
    runNodeId: z.string().min(1),
    stepId: z.string().min(1),
    eventId: z.string().optional(),
    artifact: artifactRefSchema,
    canvasNodeId: z.string().optional(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
    createdAt: z.string().datetime(),
  });

export const evaluationResultSchema = z.object({
  passed: z.boolean(),
  issues: z.array(
    z.object({
      code: z.string().min(1),
      message: z.string().min(1),
      severity: z.enum(["info", "warning", "error"]),
    })
  ),
  recommendedActions: z.array(z.string()),
  needsRegeneration: z.boolean(),
});

export const runStatusDataPartSchema: z.ZodType<RunStatusDataPart> = z.object({
  projectId: z.string().min(1),
  runNodeId: z.string().min(1),
  stepId: z.string().min(1),
  eventId: z.string().optional(),
  eventType: z.enum(["run.created", "run.completed", "run.failed"]),
  status: z.enum([
    "queued",
    "routing",
    "building_context",
    "planning",
    "running",
    "waiting_approval",
    "evaluating",
    "completed",
    "failed",
    "cancelled",
    "success",
    "error",
  ]),
  prompt: z.string().optional(),
  promptNodeId: z.string().nullable().optional(),
  selectedNodeId: z.string().nullable().optional(),
  upstreamContext: z.array(upstreamContextItemSchema).optional(),
  contextTrace: agentInputSchema.shape.canvasContext.shape.contextTrace,
  artifactIds: z.array(z.string()).optional(),
  evaluation: evaluationResultSchema.optional(),
  runtime: z.string().optional(),
  errorCode: z.string().optional(),
  errorText: z.string().nullable().optional(),
  failedStepId: z.string().optional(),
  createdAt: z.string().datetime(),
});

export const tracePointerDataPartSchema: z.ZodType<TracePointerDataPart> =
  z.object({
    projectId: z.string().min(1),
    runNodeId: z.string().min(1),
    stepId: z.string().min(1),
    eventId: z.string().optional(),
    eventType: runtimeEventTypeSchema,
    createdAt: z.string().datetime(),
  });

export const runtimeMetadataSchema = z
  .record(z.string(), z.unknown())
  .optional();

export const runtimeDataSchemas = {
  "artifact-created": artifactCreatedDataPartSchema,
  "canvas-operation": canvasOperationDataPartSchema,
  "run-status": runStatusDataPartSchema,
  "runtime-event": runtimeEventSchema,
  "trace-pointer": tracePointerDataPartSchema,
};

export const agentRunSchema: z.ZodType<AgentRun> = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  projectId: z.string().min(1),
  status: agentRunStatusSchema,
  input: agentInputSchema,
  intent: intentResultSchema.optional(),
  context: builtContextSchema.optional(),
  plan: planSchema.optional(),
  steps: z.array(agentStepSchema),
  artifacts: z.array(artifactRefSchema),
  canvasOperations: z.array(canvasOperationSchema),
  errors: z.array(agentErrorSchema),
  evaluation: evaluationResultSchema.optional(),
  trace: z.object({
    events: z.array(runtimeEventSchema),
    promptTrace: jsonObjectSchema.optional(),
    validation: jsonObjectSchema.optional(),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const canvasNodeSchema = z.custom<AgentCanvasNode>((value) =>
  Boolean(value && typeof value === "object" && "id" in value && "data" in value)
);

export const canvasEdgeSchema = z.custom<AgentCanvasEdge>((value) =>
  Boolean(value && typeof value === "object" && "id" in value)
);
