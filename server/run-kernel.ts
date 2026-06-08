import { type UIMessage, type UIMessageStreamWriter } from "ai";
import { z } from "zod";

import {
  generateSeedreamImage,
  isSeedreamConfigured,
  inferSeedreamResultCount,
  readSeedreamMaxOutputImagesFromEnv,
  type SeedreamGenerateInput,
  type SeedreamGeneratedImage,
  type SeedreamUpstreamContext,
} from "../seedream.ts";
import {
  IMAGE_GENERATE_CAPABILITY_ID,
  PROMPT_EXPAND_CAPABILITY_ID,
  CapabilityRuntimeError,
  assertCapabilityMayExecute,
  buildCapabilityRegistry,
  getCapability,
  getCapabilitySummary,
  requireCapability,
  toTypedCapabilityError,
  type RegisteredCapability,
} from "./capabilities.ts";
import { kernelStepsFromPlan, planAgentRun } from "./agent-router.ts";
import {
  generateTextWithProvider,
  readArkMaxReferenceImagesFromEnv,
  streamTextWithProvider,
  type ModelProviderId,
} from "./model-providers.ts";
import {
  AGENT_RUN_TEXT_SYSTEM_PROMPT,
  PROMPT_EXPAND_SYSTEM_PROMPT,
  REFERENCE_IMAGE_ANALYSIS_SYSTEM_PROMPT,
  buildAgentRunTextPromptAssembly,
  buildReferenceImageAnalysisPromptAssembly,
  buildSkillPromptAssembly,
  selectReferenceImages,
  type PromptAssemblyTrace,
  type PromptCanvasContext,
  type ReferenceImageInput,
} from "./prompts.ts";
import {
  createArtifact,
  listLatestPublicSkills,
  recordRunEvent,
  recordRunStepEvent,
  type AgentSkill,
} from "./supabase.ts";

export const runStatusSchema = z.enum(["queued", "running", "success", "error"]);
export const runStepStatusSchema = z.enum(["queued", "running", "success", "error"]);
export const runStepEventTypeSchema = z.enum([
  "run.created",
  "step.started",
  "tool.input",
  "tool.output",
  "tool.error",
  "artifact.created",
  "graph.patch.proposed",
  "graph.patch.applied",
  "run.completed",
  "run.failed",
]);
export const artifactTypeSchema = z.enum([
  "image",
  "file",
  "doc",
  "code",
  "webpage",
  "dataset",
  "decision",
  "tool_result",
  "memory",
]);
export const graphPatchTypeSchema = z.enum([
  "createNode",
  "updateNode",
  "createEdge",
  "setNodeStatus",
  "attachArtifact",
]);

export const toolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  errorText: z.string().optional(),
});

export const artifactRefSchema = z.object({
  id: z.string().min(1),
  type: artifactTypeSchema,
  uri: z.string().optional(),
  title: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const graphPatchProposalSchema = z.object({
  id: z.string().min(1),
  type: graphPatchTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(["proposed", "applied", "rejected"]).default("proposed"),
});

export const runStepEventInputSchema = z.object({
  projectId: z.string().min(1),
  runNodeId: z.string().min(1),
  stepId: z.string().min(1),
  type: runStepEventTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  errorText: z.string().nullable().optional(),
  createdAt: z.string().datetime().optional(),
});

export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunStepStatus = z.infer<typeof runStepStatusSchema>;
export type RunStepEventType = z.infer<typeof runStepEventTypeSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ArtifactRef = z.infer<typeof artifactRefSchema>;
export type GraphPatchProposal = z.infer<typeof graphPatchProposalSchema>;
export type RunStepEventInput = z.infer<typeof runStepEventInputSchema>;

export type RunStep = {
  id: string;
  label: string;
  status: RunStepStatus;
  toolCall?: ToolCall;
  startedAt?: string;
  completedAt?: string;
  errorText?: string;
};

export type Run = {
  id: string;
  projectId: string;
  runNodeId: string;
  status: RunStatus;
  steps: RunStep[];
  artifacts: ArtifactRef[];
  graphPatchProposals: GraphPatchProposal[];
  createdAt: string;
  updatedAt: string;
};

export type GenerateImageToolInput = SeedreamGenerateInput & {
  originalPrompt: string;
  promptSkill: ReturnType<typeof getSkillToolSummary>;
  capabilityIds: string[];
  contextTrace?: PromptCanvasContext["contextTrace"];
  sourceContextCount?: number;
};

type RunStepDefinition = {
  id: string;
  label: string;
  toolName?: "analyze_reference_images" | "expand_prompt" | "generate_image";
};

type ImageAgentRunInput = {
  projectId: string;
  runNodeId: string;
  canvasContext: PromptCanvasContext;
  messages: UIMessage[];
  modelProvider: ModelProviderId;
  writer: UIMessageStreamWriter<UIMessage>;
};

type ActiveTool = {
  stepId: string;
  toolCallId: string;
  toolName: RunStepDefinition["toolName"];
  input: unknown;
  inputWritten: boolean;
  metadata?: Record<string, string>;
};

type PromptTraceByStage = {
  agentText?: PromptAssemblyTrace;
  referenceImageAnalysis?: PromptAssemblyTrace;
  promptExpand?: PromptAssemblyTrace;
};

export function createKernelRun(input: {
  id?: string;
  projectId: string;
  runNodeId: string;
  steps: RunStepDefinition[];
  createdAt?: string;
}): Run {
  const createdAt = input.createdAt ?? new Date().toISOString();

  return {
    id: input.id ?? `kernel-run-${crypto.randomUUID()}`,
    projectId: input.projectId,
    runNodeId: input.runNodeId,
    status: "queued",
    steps: input.steps.map((step) => ({
      id: step.id,
      label: step.label,
      status: "queued",
      toolCall: step.toolName
        ? {
            id: `${step.toolName}-${crypto.randomUUID()}`,
            name: step.toolName,
          }
        : undefined,
    })),
    artifacts: [],
    graphPatchProposals: [],
    createdAt,
    updatedAt: createdAt,
  };
}

export function startKernelStep(
  run: Run,
  stepId: string,
  now = new Date().toISOString()
) {
  const step = findRunStep(run, stepId);
  assertStepStatus(step, ["queued"], "start");

  step.status = "running";
  step.startedAt = now;
  run.status = "running";
  run.updatedAt = now;
  return step;
}

export function completeKernelStep(
  run: Run,
  stepId: string,
  now = new Date().toISOString()
) {
  const step = findRunStep(run, stepId);
  assertStepStatus(step, ["running"], "complete");

  step.status = "success";
  step.completedAt = now;
  run.updatedAt = now;
  return step;
}

export function failKernelStep(
  run: Run,
  stepId: string,
  errorText: string,
  now = new Date().toISOString()
) {
  const step = findRunStep(run, stepId);
  assertStepStatus(step, ["queued", "running"], "fail");

  step.status = "error";
  step.errorText = errorText;
  step.completedAt = now;
  run.status = "error";
  run.updatedAt = now;
  if (step.toolCall) {
    step.toolCall.errorText = errorText;
  }

  return step;
}

export function completeKernelRun(run: Run, now = new Date().toISOString()) {
  run.status = "success";
  run.updatedAt = now;
  return run;
}

export async function executeImageAgentRun({
  canvasContext,
  messages,
  modelProvider,
  projectId,
  runNodeId,
  writer,
}: ImageAgentRunInput) {
  const requestedResultCount = safeInferSeedreamResultCount(canvasContext.prompt);
  const referenceImages = selectReferenceImages(
    canvasContext,
    readArkMaxReferenceImagesFromEnv()
  );
  const promptTrace: PromptTraceByStage = {};
  const runTextAssembly = buildAgentRunTextPromptAssembly(
    canvasContext,
    requestedResultCount,
    modelProvider
  );
  promptTrace.agentText = runTextAssembly.trace;
  const publicSkills = await listLatestPublicSkills();
  const capabilityRegistry = buildCapabilityRegistry(publicSkills);
  const routePlan = planAgentRun({
    canvasContext,
    capabilities: capabilityRegistry,
    hasReferenceImages: Boolean(referenceImages.length),
  });
  const promptSkill = getPromptExpandSkill(capabilityRegistry);
  const imageCapability = requireCapability(
    capabilityRegistry,
    IMAGE_GENERATE_CAPABILITY_ID
  );
  const selectedCapabilityIds = routePlan.selectedCapabilityIds;
  const selectedCapabilitySummaries = selectedCapabilityIds.map((capabilityId) =>
    getCapabilitySummary(requireCapability(capabilityRegistry, capabilityId))
  );
  const run = createKernelRun({
    projectId,
    runNodeId,
    steps: kernelStepsFromPlan(routePlan),
  });
  const toolCallIds = getToolCallIds(run);
  const skillInput = {
    prompt: canvasContext.prompt,
    selectedNodeId: canvasContext.selectedNodeId ?? null,
    upstreamContext: canvasContext.upstreamContext,
    contextTrace: canvasContext.contextTrace,
    skillSlug: "prompt-expand",
    modelProvider,
    promptTrace,
    selectedCapabilityIds,
    selectedCapabilities: selectedCapabilitySummaries,
    routePlan,
  };
  let activeStepId = "agent_text";
  let activeTool: ActiveTool | null = null;
  let referenceImageAnalysis = "";
  let analysisInput: unknown = null;
  let analysisOutput: unknown = null;
  let skillOutput: unknown = null;
  let toolInput: GenerateImageToolInput | null = null;

  await writeStepEvent({
    projectId,
    runNodeId,
    stepId: "run",
    type: "run.created",
    payload: {
      prompt: canvasContext.prompt,
      promptNodeId: canvasContext.promptNodeId ?? null,
      selectedNodeId: canvasContext.selectedNodeId ?? null,
      upstreamContext: canvasContext.upstreamContext,
      contextTrace: canvasContext.contextTrace,
      promptTrace,
      selectedCapabilityIds,
      selectedCapabilities: selectedCapabilitySummaries,
      routePlan,
    },
  });
  await writeStepEvent({
    projectId,
    runNodeId,
    stepId: "router",
    type: "step.started",
    payload: {
      label: "Route capabilities",
      selectedCapabilityIds,
      selectedCapabilities: selectedCapabilitySummaries,
      router: routePlan.router,
      stepGraph: routePlan.stepGraph,
    },
  });

  await recordRunEvent({
    projectId,
    runNodeId,
    prompt: canvasContext.prompt,
    selectedNodeId: canvasContext.selectedNodeId ?? null,
    upstreamContext: canvasContext.upstreamContext,
    status: "running",
    skillInput,
  });

  try {
    activeStepId = "agent_text";
    startKernelStep(run, activeStepId);
    await writeStepEvent({
      projectId,
      runNodeId,
      stepId: activeStepId,
      type: "step.started",
      payload: {
        label: "Run explanation",
        promptTrace: runTextAssembly.trace,
      },
    });

    for await (const chunk of streamTextWithProvider(modelProvider, {
      system: AGENT_RUN_TEXT_SYSTEM_PROMPT,
      prompt: runTextAssembly.prompt,
      maxOutputTokens: 240,
    })) {
      writer.write(chunk);
    }

    completeKernelStep(run, activeStepId);

    if (referenceImages.length) {
      activeStepId = "analyze_reference_images";
      startKernelStep(run, activeStepId);
      await writeStepEvent({
        projectId,
        runNodeId,
        stepId: activeStepId,
        type: "step.started",
        payload: { label: "Analyze reference images" },
      });

      const analysisAssembly = buildReferenceImageAnalysisPromptAssembly(
        canvasContext,
        referenceImages
      );
      promptTrace.referenceImageAnalysis = analysisAssembly.trace;
      analysisInput = {
        prompt: canvasContext.prompt,
        selectedNodeId: canvasContext.selectedNodeId ?? null,
        imageCount: referenceImages.length,
        referenceImages: referenceImages.map((image) => ({
          nodeId: image.nodeId,
          imageUrl: image.imageUrl,
          prompt: image.prompt,
          summary: image.summary,
        })),
        modelProvider: "ark",
        promptTrace: analysisAssembly.trace,
      };
      activeTool = {
        stepId: activeStepId,
        toolCallId: toolCallIds.analyze_reference_images,
        toolName: "analyze_reference_images",
        input: analysisInput,
        inputWritten: false,
        metadata: getToolMetadata({
          projectId,
          runNodeId,
          stepId: activeStepId,
          capabilityId: IMAGE_GENERATE_CAPABILITY_ID,
        }),
      };
      await writeToolInput(writer, activeTool);
      await writeStepEvent({
        projectId,
        runNodeId,
        stepId: activeStepId,
        type: "tool.input",
        payload: {
          toolCallId: activeTool.toolCallId,
          toolName: activeTool.toolName,
          input: analysisInput,
        },
      });

      referenceImageAnalysis = await analyzeReferenceImages(
        referenceImages,
        analysisAssembly.prompt
      );
      analysisOutput = {
        imageCount: referenceImages.length,
        analysis: referenceImageAnalysis,
        modelProvider: "ark",
      };
      writer.write({
        type: "tool-output-available",
        toolCallId: activeTool.toolCallId,
        output: analysisOutput,
      });
      await writeStepEvent({
        projectId,
        runNodeId,
        stepId: activeStepId,
        type: "tool.output",
        payload: {
          toolCallId: activeTool.toolCallId,
          toolName: activeTool.toolName,
          output: analysisOutput,
        },
      });
      completeKernelStep(run, activeStepId);
      activeTool = null;
    }

    activeStepId = "expand_prompt";
    const promptExpandCapability = requireCapability(
      capabilityRegistry,
      PROMPT_EXPAND_CAPABILITY_ID
    );
    startKernelStep(run, activeStepId);
    await writeStepEvent({
      projectId,
      runNodeId,
      stepId: activeStepId,
      type: "step.started",
      payload: { label: "Expand prompt" },
    });
    const expandedSkillInput = {
      ...skillInput,
      capabilityId: promptExpandCapability.manifest.capabilityId,
      referenceImageAnalysis: referenceImageAnalysis || undefined,
    };
    activeTool = {
      stepId: activeStepId,
      toolCallId: toolCallIds.expand_prompt,
      toolName: "expand_prompt",
      input: expandedSkillInput,
      inputWritten: false,
      metadata: getToolMetadata({
        projectId,
        runNodeId,
        stepId: activeStepId,
        capabilityId: promptExpandCapability.manifest.capabilityId,
      }),
    };
    await writeToolInput(writer, activeTool);
    await writeStepEvent({
      projectId,
      runNodeId,
      stepId: activeStepId,
      type: "tool.input",
      payload: {
        toolCallId: activeTool.toolCallId,
        toolName: activeTool.toolName,
        input: expandedSkillInput,
      },
    });
    await assertToolCanExecute({
      capability: promptExpandCapability,
      projectId,
      messages,
      runNodeId,
      tool: activeTool,
      writer,
    });

    const skillAssembly = buildSkillPromptAssembly({
      canvasContext,
      referenceImageAnalysis,
      skill: promptSkill,
    });
    promptTrace.promptExpand = skillAssembly.trace;
    const expandedPrompt = await expandPromptWithSkill({
      modelProvider,
      prompt: skillAssembly.prompt,
    });
    skillOutput = {
      originalPrompt: canvasContext.prompt,
      expandedPrompt,
      referenceImageAnalysis: referenceImageAnalysis || undefined,
      capabilityId: promptExpandCapability.manifest.capabilityId,
      skill: getSkillToolSummary(promptSkill),
      promptTrace: skillAssembly.trace,
    };

    writer.write({
      type: "tool-output-available",
      toolCallId: activeTool.toolCallId,
      output: skillOutput,
    });
    await writeStepEvent({
      projectId,
      runNodeId,
      stepId: activeStepId,
      type: "tool.output",
      payload: {
        toolCallId: activeTool.toolCallId,
        toolName: activeTool.toolName,
        output: skillOutput,
      },
    });
    completeKernelStep(run, activeStepId);
    activeTool = null;

    activeStepId = "generate_image";
    startKernelStep(run, activeStepId);
    await writeStepEvent({
      projectId,
      runNodeId,
      stepId: activeStepId,
      type: "step.started",
      payload: { label: "Generate image" },
    });
    const imageToolInput: GenerateImageToolInput = {
      prompt: expandedPrompt,
      originalPrompt: canvasContext.prompt,
      selectedNodeId: canvasContext.selectedNodeId ?? null,
      upstreamContext: toSeedreamUpstreamContext(canvasContext.upstreamContext),
      resultCount: inferSeedreamResultCount(
        canvasContext.prompt,
        readSeedreamMaxOutputImagesFromEnv()
      ),
      promptSkill: getSkillToolSummary(promptSkill),
      capabilityIds: selectedCapabilityIds,
      contextTrace: canvasContext.contextTrace,
      sourceContextCount: canvasContext.upstreamContext.length,
    };
    toolInput = imageToolInput;
    activeTool = {
      stepId: activeStepId,
      toolCallId: toolCallIds.generate_image,
      toolName: "generate_image",
      input: imageToolInput,
      inputWritten: false,
      metadata: getToolMetadata({
        projectId,
        runNodeId,
        stepId: activeStepId,
        capabilityId: imageCapability.manifest.capabilityId,
      }),
    };
    await writeToolInput(writer, activeTool);
    await writeStepEvent({
      projectId,
      runNodeId,
      stepId: activeStepId,
      type: "tool.input",
      payload: {
        toolCallId: activeTool.toolCallId,
        toolName: activeTool.toolName,
        input: imageToolInput,
      },
    });
    await assertToolCanExecute({
      capability: imageCapability,
      projectId,
      messages,
      runNodeId,
      tool: activeTool,
      writer,
    });
    assertImageCapabilityEnvironment(imageCapability);

    const output = await generateSeedreamImage(imageToolInput);
    const outputWithArtifacts = await createImageArtifacts({
      images: output.images,
      projectId,
      runNodeId,
      selectedNodeId: canvasContext.selectedNodeId ?? null,
      toolCallId: activeTool.toolCallId,
    });

    await recordRunEvent({
      projectId,
      runNodeId,
      prompt: canvasContext.prompt,
      selectedNodeId: canvasContext.selectedNodeId ?? null,
      upstreamContext: canvasContext.upstreamContext,
      status: "success",
      skillInput: {
        ...skillInput,
        analysisInput,
      },
      skillOutput,
      toolInput: {
        analysisOutput,
        imageInput: toolInput,
      },
      toolOutput: outputWithArtifacts,
    });

    writer.write({
      type: "tool-output-available",
      toolCallId: activeTool.toolCallId,
      output: outputWithArtifacts,
    });
    await writeStepEvent({
      projectId,
      runNodeId,
      stepId: activeStepId,
      type: "tool.output",
      payload: {
        toolCallId: activeTool.toolCallId,
        toolName: activeTool.toolName,
          output: outputWithArtifacts,
        },
      });
    for (const artifact of outputWithArtifacts.artifacts) {
      run.artifacts.push(artifact);
      const canvasNodeId = `image-${artifact.id}`;
      await writeStepEvent({
        projectId,
        runNodeId,
        stepId: activeStepId,
        type: "artifact.created",
        payload: {
          artifact,
          canvasNodeId,
          toolCallId: activeTool.toolCallId,
          toolName: activeTool.toolName,
        },
      });
      const patch = {
        id: `patch-${runNodeId}-${artifact.id}`,
        projectId,
        type: "attachArtifact",
        payload: {
          nodeId: canvasNodeId,
          artifact,
        },
      };
      await writeStepEvent({
        projectId,
        runNodeId,
        stepId: activeStepId,
        type: "graph.patch.proposed",
        payload: { patch },
      });
      await writeStepEvent({
        projectId,
        runNodeId,
        stepId: activeStepId,
        type: "graph.patch.applied",
        payload: { patch },
      });
    }

    completeKernelStep(run, activeStepId);
    completeKernelRun(run);
    await writeStepEvent({
      projectId,
      runNodeId,
      stepId: "run",
      type: "run.completed",
      payload: {
        status: run.status,
        promptTrace,
        artifactIds: run.artifacts.map((artifact) => artifact.id),
      },
    });
  } catch (error) {
    if (error instanceof ApprovalPendingSignal) {
      return;
    }

    const approvalDenied = error instanceof ApprovalDeniedSignal;
    const typedError = toTypedCapabilityError(error);
    const errorText = typedError.message;
    console.error("[agent-run]", error);

    failKernelStep(run, activeStepId, errorText);
    if (!approvalDenied) {
      await writeStepEvent({
        projectId,
        runNodeId,
        stepId: activeStepId,
        type: "tool.error",
        payload: {
          errorText,
          errorCode: typedError.code,
          errorDetails: typedError.details,
          failedStepId: activeStepId,
          toolCallId: activeTool?.toolCallId,
          toolName: activeTool?.toolName,
        },
        errorText,
      });
    }

    await recordRunEvent({
      projectId,
      runNodeId,
      prompt: canvasContext.prompt,
      selectedNodeId: canvasContext.selectedNodeId ?? null,
      upstreamContext: canvasContext.upstreamContext,
      status: "error",
      skillInput: {
        ...skillInput,
        analysisInput,
      },
      skillOutput,
      toolInput,
      errorText,
    });

    if (typedError.code !== "approval.required" && !approvalDenied) {
      writeToolError(writer, activeTool ?? getFallbackActiveTool({
        canvasContext,
        referenceImages,
        toolCallIds,
      }), errorText);
    }
    await writeStepEvent({
      projectId,
      runNodeId,
      stepId: "run",
      type: "run.failed",
      payload: {
        errorText,
        errorCode: typedError.code,
        errorDetails: typedError.details,
        failedStepId: activeStepId,
        promptTrace,
        selectedCapabilityIds,
      },
      errorText,
    });
  }
}

async function createImageArtifacts({
  images,
  projectId,
  runNodeId,
  selectedNodeId,
  toolCallId,
}: {
  images: SeedreamGeneratedImage[];
  projectId: string;
  runNodeId: string;
  selectedNodeId: string | null;
  toolCallId: string;
}) {
  const artifacts: ArtifactRef[] = [];
  const imagesWithArtifacts: Array<SeedreamGeneratedImage & { artifact: ArtifactRef }> =
    [];

  for (const image of images) {
    const artifact = artifactRefSchema.parse({
      id: image.id,
      type: "image",
      uri: image.url,
      title: image.title,
      metadata: image.metadata ?? {},
    });

    await createArtifact({
      id: artifact.id,
      projectId,
      runNodeId,
      type: artifact.type,
      uri: artifact.uri,
      title: artifact.title,
      metadata: artifact.metadata,
      toolCallId,
      sourceNodeId: selectedNodeId,
    });

    artifacts.push(artifact);
    imagesWithArtifacts.push({
      ...image,
      artifact,
    });
  }

  return {
    images: imagesWithArtifacts,
    artifacts,
  };
}

function toSeedreamUpstreamContext(
  upstreamContext: PromptCanvasContext["upstreamContext"]
): SeedreamUpstreamContext[] {
  return upstreamContext.flatMap((item) => {
    if (item.type === "prompt") {
      return {
        nodeId: item.nodeId,
        type: "prompt" as const,
        prompt: item.prompt,
        summary: item.summary,
      };
    }

    const imageUrl =
      item.imageUrl ??
      (item.artifact?.type === "image" ? item.artifact.uri : undefined);
    if (!imageUrl) {
      return [];
    }

    return {
      nodeId: item.nodeId,
      type: "image" as const,
      prompt: item.prompt,
      imageUrl,
      summary: item.summary,
    };
  });
}

async function assertToolCanExecute({
  capability,
  messages,
  projectId,
  runNodeId,
  tool,
  writer,
}: {
  capability: RegisteredCapability;
  messages: UIMessage[];
  projectId: string;
  runNodeId: string;
  tool: ActiveTool;
  writer: UIMessageStreamWriter<UIMessage>;
}) {
  try {
    assertCapabilityMayExecute(capability);
  } catch (error) {
    const typedError = toTypedCapabilityError(error);
    if (typedError.code !== "approval.required") {
      throw typedError;
    }

    const approvalId = getApprovalId(runNodeId, tool.stepId);
    const approvalResponse = findToolApprovalResponse(messages, approvalId);
    if (approvalResponse?.approved === true) {
      await writeStepEvent({
        projectId,
        runNodeId,
        stepId: tool.stepId,
        type: "tool.input",
        payload: {
          toolCallId: tool.toolCallId,
          toolName: tool.toolName,
          approvalId,
          capabilityId: capability.manifest.capabilityId,
          state: "approval-responded",
          approved: true,
          reason: approvalResponse.reason,
          policy: capability.manifest.policy,
        },
      });
      return;
    }

    if (approvalResponse?.approved === false) {
      writer.write({
        type: "tool-output-denied",
        toolCallId: tool.toolCallId,
      });
      await writeStepEvent({
        projectId,
        runNodeId,
        stepId: tool.stepId,
        type: "tool.error",
        payload: {
          toolCallId: tool.toolCallId,
          toolName: tool.toolName,
          approvalId,
          capabilityId: capability.manifest.capabilityId,
          state: "output-denied",
          approved: false,
          reason: approvalResponse.reason,
          errorCode: typedError.code,
          errorText: approvalResponse.reason ?? typedError.message,
        },
        errorText: approvalResponse.reason ?? typedError.message,
      });
      throw new ApprovalDeniedSignal(approvalResponse.reason ?? typedError.message);
    }

    writer.write({
      type: "tool-approval-request",
      approvalId,
      toolCallId: tool.toolCallId,
    });
    await writeStepEvent({
      projectId,
      runNodeId,
      stepId: tool.stepId,
      type: "tool.input",
      payload: {
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        approvalId,
        capabilityId: capability.manifest.capabilityId,
        state: "approval-requested",
        policy: capability.manifest.policy,
      },
    });

    throw new ApprovalPendingSignal(typedError.message);
  }
}

class ApprovalPendingSignal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalPendingSignal";
  }
}

class ApprovalDeniedSignal extends CapabilityRuntimeError {
  constructor(message: string) {
    super("approval.required", message);
    this.name = "ApprovalDeniedSignal";
  }
}

function getApprovalId(runNodeId: string, stepId: string) {
  return `approval-${runNodeId}-${stepId}`;
}

function findToolApprovalResponse(messages: UIMessage[], approvalId: string) {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") {
      continue;
    }

    for (const part of [...message.parts].reverse()) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const approval = (part as { approval?: unknown }).approval;
      if (!approval || typeof approval !== "object") {
        continue;
      }

      const candidate = approval as {
        id?: unknown;
        approved?: unknown;
        reason?: unknown;
      };
      if (candidate.id !== approvalId || typeof candidate.approved !== "boolean") {
        continue;
      }

      return {
        approved: candidate.approved,
        reason: typeof candidate.reason === "string" ? candidate.reason : undefined,
      };
    }
  }

  return null;
}

function assertImageCapabilityEnvironment(capability: RegisteredCapability) {
  if (!isSeedreamConfigured()) {
    throw toTypedCapabilityError(
      new Error(
        "SEEDREAM_ACCESS_KEY_ID or VOLCENGINE_ACCESS_KEY_ID is not configured."
      )
    );
  }

  if (
    capability.manifest.policy.mayExternalCost &&
    !capability.manifest.policy.canUseNetwork
  ) {
    throw new Error(
      `Capability ${capability.manifest.capabilityId} may create external cost but network access is disabled.`
    );
  }
}

async function analyzeReferenceImages(
  referenceImages: ReferenceImageInput[],
  prompt: string
) {
  const analysis = (
    await generateTextWithProvider("ark", {
      system: REFERENCE_IMAGE_ANALYSIS_SYSTEM_PROMPT,
      prompt,
      imageUrls: referenceImages.map((image) => image.imageUrl),
      maxOutputTokens: 900,
    })
  ).trim();

  if (!analysis) {
    throw new Error("Ark reference image analysis returned empty text.");
  }

  return analysis;
}

async function expandPromptWithSkill({
  modelProvider,
  prompt,
}: {
  modelProvider: ModelProviderId;
  prompt: string;
}) {
  const expandedPrompt = (
    await generateTextWithProvider(modelProvider, {
      system: PROMPT_EXPAND_SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 1_200,
    })
  ).trim();
  if (!expandedPrompt) {
    throw new Error("prompt-expand skill returned an empty prompt.");
  }
  if (Array.from(expandedPrompt).length > 800) {
    throw new Error("prompt-expand skill returned more than 800 characters.");
  }

  return expandedPrompt;
}

function getSkillToolSummary(skill: AgentSkill) {
  return {
    id: skill.id,
    name: skill.name,
    slug: skill.slug,
  };
}

function getPromptExpandSkill(registry: RegisteredCapability[]) {
  const capability = getCapability(registry, PROMPT_EXPAND_CAPABILITY_ID);
  const latestSkill = capability?.skill as AgentSkill | undefined;
  if (!latestSkill) {
    throw new Error("请先在 Skill 面板上传 prompt-expand skill。");
  }

  return latestSkill;
}

function getToolCallIds(run: Run) {
  return {
    analyze_reference_images:
      getRunStep(run, "analyze_reference_images")?.toolCall?.id ??
      `analyze_reference_images-${crypto.randomUUID()}`,
    expand_prompt: findRunStep(run, "expand_prompt").toolCall?.id ?? "",
    generate_image: findRunStep(run, "generate_image").toolCall?.id ?? "",
  };
}

async function writeToolInput(
  writer: UIMessageStreamWriter<UIMessage>,
  tool: ActiveTool
) {
  if (!tool.toolName) {
    return;
  }

  writer.write({
    type: "tool-input-available",
    toolCallId: tool.toolCallId,
    toolName: tool.toolName,
    input: tool.input,
    toolMetadata: tool.metadata,
  });
  tool.inputWritten = true;
}

function writeToolError(
  writer: UIMessageStreamWriter<UIMessage>,
  tool: ActiveTool,
  errorText: string
) {
  if (!tool.toolName) {
    writer.write({ type: "error", errorText });
    return;
  }

  if (tool.inputWritten) {
    writer.write({
      type: "tool-output-error",
      toolCallId: tool.toolCallId,
      errorText,
    });
    return;
  }

  writer.write({
    type: "tool-input-error",
    toolCallId: tool.toolCallId,
    toolName: tool.toolName,
    input: tool.input,
    errorText,
  });
}

function getFallbackActiveTool({
  canvasContext,
  referenceImages,
  toolCallIds,
}: {
  canvasContext: PromptCanvasContext;
  referenceImages: ReferenceImageInput[];
  toolCallIds: ReturnType<typeof getToolCallIds>;
}): ActiveTool {
  if (referenceImages.length) {
    return {
      stepId: "analyze_reference_images",
      toolCallId: toolCallIds.analyze_reference_images,
      toolName: "analyze_reference_images",
      input: {
        prompt: canvasContext.prompt,
        selectedNodeId: canvasContext.selectedNodeId ?? null,
        imageCount: referenceImages.length,
      },
      inputWritten: false,
    };
  }

  return {
    stepId: "expand_prompt",
    toolCallId: toolCallIds.expand_prompt,
    toolName: "expand_prompt",
    input: {
      prompt: canvasContext.prompt,
      selectedNodeId: canvasContext.selectedNodeId ?? null,
      upstreamContext: canvasContext.upstreamContext,
      skillSlug: "prompt-expand",
    },
    inputWritten: false,
  };
}

function getToolMetadata({
  capabilityId,
  projectId,
  runNodeId,
  stepId,
}: {
  capabilityId: string;
  projectId: string;
  runNodeId: string;
  stepId: string;
}) {
  return {
    capabilityId,
    projectId,
    runNodeId,
    stepId,
  };
}

async function writeStepEvent(input: RunStepEventInput) {
  await recordRunStepEvent(runStepEventInputSchema.parse(input));
}

function findRunStep(run: Run, stepId: string) {
  const step = getRunStep(run, stepId);
  if (!step) {
    throw new Error(`Unknown run step: ${stepId}`);
  }

  return step;
}

function getRunStep(run: Run, stepId: string) {
  return run.steps.find((step) => step.id === stepId);
}

function assertStepStatus(
  step: RunStep,
  allowedStatuses: RunStepStatus[],
  action: string
) {
  if (!allowedStatuses.includes(step.status)) {
    throw new Error(
      `Cannot ${action} step ${step.id} from ${step.status}; expected ${allowedStatuses.join(
        " or "
      )}.`
    );
  }
}

function safeInferSeedreamResultCount(prompt: string) {
  try {
    return inferSeedreamResultCount(prompt, readSeedreamMaxOutputImagesFromEnv());
  } catch {
    return 1;
  }
}
