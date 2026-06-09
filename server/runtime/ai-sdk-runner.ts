import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool as aiTool,
  validateUIMessages,
  type UIMessage,
  type UIMessageStreamWriter,
  type ToolSet,
} from "ai";
import { z } from "zod";

import { buildCapabilityRegistry } from "../capabilities.ts";
import {
  getLanguageModelForProvider,
  type ModelProviderId,
} from "../model-providers.ts";
import {
  AGENT_RUN_TEXT_SYSTEM_PROMPT,
  type PromptCanvasContext,
} from "../prompts.ts";
import {
  type AgentProject,
  listLatestPublicSkills,
  recordRunEvent,
} from "../supabase.ts";
import type {
  AgentError,
  AgentRun,
  AgentStep,
  BuiltContext,
  CanvasOperation,
  IntentResult,
  PlanStep,
  ToolResult,
} from "../../src/types/runtime.ts";
import { normalizeAgentInput } from "./input-normalizer.ts";
import { buildContext } from "./context-builder.ts";
import { createRuntimeEventWriter, type RuntimeEventWriter } from "./events.ts";
import { AgentRunStore } from "./run-store.ts";
import { evaluateAgentRun } from "./evaluator.ts";
import {
  buildToolRegistry,
  getToolTraceMetadata,
  type RuntimeToolDefinition,
  type ToolRegistry,
} from "./tool-registry.ts";
import {
  createAgentError,
  runtimeErrorCodes,
  throwAgentError,
  toAgentError,
} from "./errors.ts";
import {
  buildPlanFromIntentDeterministically,
  normalizePlan,
  validatePlanAgainstRegistry,
} from "./planner.ts";
import { validateIntentAgainstRegistry } from "./intent-router.ts";
import {
  intentResultSchema,
  planSchema,
  runtimeDataSchemas,
  runtimeMetadataSchema,
} from "./schemas.ts";
import { runWithRetry } from "./retry.ts";
import { validateCanvasOperations } from "./canvas-operation-policy.ts";
import { toolIds } from "./tool-registry.ts";

type ExecuteAiSdkAgentRunInput = {
  userId: string;
  projectId: string;
  runNodeId: string;
  canvasContext: PromptCanvasContext;
  messages: UIMessage[];
  modelProvider: ModelProviderId;
  writer: UIMessageStreamWriter<UIMessage>;
  attachments?: unknown[];
  projectSnapshot?: Pick<AgentProject, "id" | "nodes">;
};

type MutableAiRunState = {
  context?: BuiltContext;
  plan: PlanStep[];
  toolNamesById: Map<string, string>;
};

type RuntimeValidationTools = Parameters<
  typeof validateUIMessages<UIMessage>
>[0]["tools"];

const planAgentRunToolName = "plan_agent_run";
const planAgentRunInputSchema = z.object({
  intent: intentResultSchema,
  plan: planSchema,
  response: z
    .string()
    .optional()
    .describe("One or two concise sentences to stream after planning."),
});

export async function executeAiSdkAgentRun({
  attachments,
  canvasContext,
  messages,
  modelProvider,
  projectId,
  projectSnapshot,
  runNodeId,
  userId,
  writer: streamWriter,
}: ExecuteAiSdkAgentRunInput) {
  const eventWriter = createRuntimeEventWriter({
    projectId,
    runNodeId,
    writer: streamWriter,
  });
  const store = new AgentRunStore();
  const input = normalizeAgentInput({
    canvasContext,
    messages,
    modelProvider,
    projectId,
    attachments,
    projectSnapshot,
    runNodeId,
    userId,
  });
  const run = await store.createRun({ input });
  const state: MutableAiRunState = {
    plan: [],
    toolNamesById: new Map(),
  };

  try {
    const publicSkills = await listLatestPublicSkills();
    const capabilities = buildCapabilityRegistry(publicSkills);
    const toolRegistry = buildToolRegistry({
      canvasContext,
      capabilities,
      modelProvider,
      projectId,
      runNodeId,
    });
    state.toolNamesById = new Map(
      toolRegistry.listAll().map((runtimeTool) => [
        runtimeTool.id,
        getAiSdkToolName(runtimeTool),
      ])
    );
    const shouldUsePlanner = true;

    await appendEvent(store, run.id, eventWriter, {
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
        runtime: "vercel-ai-sdk",
        routing: "plan_agent_run structured intent",
      },
    });
    await appendEvent(store, run.id, eventWriter, {
      projectId,
      runNodeId,
      stepId: "input",
      type: "input.normalized",
      payload: { input },
    });
    await store.setStatus(run.id, "planning");

    const tools = createAiSdkTools({
      capabilities,
      canvasContext,
      eventWriter,
      inputRun: run,
      publicSkills,
      state,
      store,
      streamWriter,
      toolRegistry,
    });
    const validatedMessages = await validateUIMessages({
      messages,
      tools: tools as RuntimeValidationTools,
      dataSchemas: runtimeDataSchemas,
      metadataSchema: runtimeMetadataSchema,
    });
    const modelMessages = await convertToModelMessages(
      [
        ...validatedMessages,
        {
          id: `canvas-${runNodeId}`,
          role: "user",
          parts: [
            {
              type: "text",
              text: buildAiSdkAgentPrompt({
                canvasContext,
                modelProvider,
                publicSkills,
                toolRegistry,
              }),
            },
          ],
        },
      ],
      { tools }
    );
    const result = streamText({
      model: getLanguageModelForProvider(modelProvider),
      system: AGENT_RUN_TEXT_SYSTEM_PROMPT,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(12),
      maxOutputTokens: 3_200,
      prepareStep({ stepNumber }) {
        if (stepNumber === 0 && shouldUsePlanner) {
          return {
            activeTools: [planAgentRunToolName],
            toolChoice: { type: "tool", toolName: planAgentRunToolName },
          };
        }

        return {
          activeTools: selectAiSdkActiveToolNames({
            fallbackToolNames: [],
            state,
          }),
          toolChoice: "auto",
        };
      },
      async onStepFinish(step) {
        await appendEvent(store, run.id, eventWriter, {
          projectId,
          runNodeId,
          stepId: `ai-sdk-step-${step.stepNumber}`,
          type: "step.finished",
          payload: compactObject({
            runtime: "vercel-ai-sdk",
            stepNumber: step.stepNumber,
            finishReason: step.finishReason,
            rawFinishReason: step.rawFinishReason,
            text: step.text,
            toolCalls: step.toolCalls.map(summarizeAiSdkToolCall),
            toolResults: step.toolResults.map(summarizeAiSdkToolResult),
            usage: compactObject(step.usage),
            model: step.model,
            warningCount: step.warnings?.length ?? 0,
          }),
        });
      },
      async experimental_onToolCallStart(event) {
        await appendEvent(store, run.id, eventWriter, {
          projectId,
          runNodeId,
          stepId: getLifecycleStepId(event.toolCall.toolName, state),
          type: "tool.execution.started",
          payload: compactObject({
            runtime: "vercel-ai-sdk",
            stepNumber: event.stepNumber,
            model: event.model,
            toolCall: summarizeAiSdkToolCall(event.toolCall),
          }),
        });
      },
      async experimental_onToolCallFinish(event) {
        await appendEvent(store, run.id, eventWriter, {
          projectId,
          runNodeId,
          stepId: getLifecycleStepId(event.toolCall.toolName, state),
          type: "tool.execution.finished",
          payload: compactObject({
            runtime: "vercel-ai-sdk",
            stepNumber: event.stepNumber,
            model: event.model,
            toolCall: summarizeAiSdkToolCall(event.toolCall),
            durationMs: event.durationMs,
            success: event.success,
            output: event.success ? summarizeToolOutput(event.output) : undefined,
            errorText: event.success ? undefined : getErrorMessage(event.error),
          }),
          errorText: event.success ? undefined : getErrorMessage(event.error),
        });
      },
      async onFinish() {
        await finalizeRun({
          canvasContext,
          eventWriter,
          input,
          runId: run.id,
          state,
          store,
        });
      },
    });

    streamWriter.merge(
      result.toUIMessageStream({
        sendStart: false,
      })
    );
  } catch (error) {
    const agentError = toAgentError(error);
    console.error("[agent-run]", error);
    await store.appendError(run.id, agentError);
    await store.setStatus(run.id, "failed");
    await writeFailureEvent(eventWriter, {
      agentError,
      canvasContext,
      projectId,
      runNodeId,
      storedErrors: store.getRun(run.id).errors,
    });
    await recordRunEvent({
      projectId,
      runNodeId,
      prompt: canvasContext.prompt,
      selectedNodeId: canvasContext.selectedNodeId ?? null,
      upstreamContext: canvasContext.upstreamContext,
      status: "error",
      skillInput: { input, context: state.context, plan: state.plan },
      errorText: agentError.message,
    });
  }
}

function createAiSdkTools({
  capabilities,
  canvasContext,
  eventWriter,
  inputRun,
  publicSkills,
  state,
  store,
  streamWriter,
  toolRegistry,
}: {
  capabilities: ReturnType<typeof buildCapabilityRegistry>;
  canvasContext: PromptCanvasContext;
  eventWriter: RuntimeEventWriter;
  inputRun: AgentRun;
  publicSkills: Awaited<ReturnType<typeof listLatestPublicSkills>>;
  state: MutableAiRunState;
  store: AgentRunStore;
  streamWriter: UIMessageStreamWriter<UIMessage>;
  toolRegistry: ToolRegistry;
}): ToolSet {
  const tools: ToolSet = {
    [planAgentRunToolName]: aiTool({
      description:
        "Plan the agent run before any other tool call. Return layered structured intent and an executable tool plan using only allowed tool ids.",
      inputSchema: planAgentRunInputSchema,
      async execute(input, options) {
        const parsed = planAgentRunInputSchema.parse(input);
        const intentValidation = validateIntentAgainstRegistry({
          capabilities,
          intent: parsed.intent,
          toolRegistry,
        });

        if (!intentValidation.ok) {
          throwAgentError({
            code: runtimeErrorCodes.CAPABILITY_UNAVAILABLE,
            message: intentValidation.errors.join("; "),
            retryable: false,
            severity: "error",
            details: { validation: intentValidation, intent: parsed.intent },
          });
        }

        const selectedIntent = parsed.intent;
        state.context = buildContext({
          input: inputRun.input,
          intent: selectedIntent,
          publicSkills,
          runId: inputRun.id,
          toolRegistry,
        });
        const planning = normalizeAiSdkPlanForIntent({
          context: state.context,
          intent: selectedIntent,
          modelPlan: parsed.plan,
          toolRegistry,
        });
        state.plan = planning.normalizedPlan;
        await store.setIntent(inputRun.id, selectedIntent);
        await appendEvent(store, inputRun.id, eventWriter, {
          projectId: inputRun.projectId,
          runNodeId: inputRun.input.metadata.runNodeId,
          stepId: "intent-router",
          type: "intent.routed",
          payload: {
            intent: selectedIntent,
            modelIntent: parsed.intent,
            runtime: "vercel-ai-sdk",
            routing: "schema_validated_model_intent",
            toolCallId: options.toolCallId,
          },
        });
        await store.setContext(inputRun.id, state.context);
        await appendEvent(store, inputRun.id, eventWriter, {
          projectId: inputRun.projectId,
          runNodeId: inputRun.input.metadata.runNodeId,
          stepId: "context-builder",
          type: "context.built",
          payload: {
            context: state.context,
            runtime: "vercel-ai-sdk",
            toolCallId: options.toolCallId,
          },
        });
        await store.setPlan(inputRun.id, planning.normalizedPlan);
        await appendEvent(store, inputRun.id, eventWriter, {
          projectId: inputRun.projectId,
          runNodeId: inputRun.input.metadata.runNodeId,
          stepId: "planner",
          type: "plan.created",
          payload: {
            rawPlan: parsed.plan,
            normalizedPlan: planning.normalizedPlan,
            validation: planning.validation,
            correctedPlan: planning.correctedPlan,
            correctionReasons: planning.correctionReasons,
            runtime: "vercel-ai-sdk",
            toolCallId: options.toolCallId,
          },
        });
        await recordRunEvent({
          projectId: inputRun.projectId,
          runNodeId: inputRun.input.metadata.runNodeId,
          prompt: canvasContext.prompt,
          selectedNodeId: canvasContext.selectedNodeId ?? null,
          upstreamContext: canvasContext.upstreamContext,
          status: "running",
          skillInput: {
            input: inputRun.input,
            intent: selectedIntent,
            context: state.context,
            plan: planning.normalizedPlan,
          },
        });

        return {
          ok: true,
          plannedToolIds: planning.normalizedPlan.flatMap((step) =>
            step.toolId ? [step.toolId] : []
          ),
          response: parsed.response ?? "",
        };
      },
    }),
  };

  for (const runtimeTool of toolRegistry.listAll()) {
    const aiToolName = getAiSdkToolName(runtimeTool);
    tools[aiToolName] = aiTool({
      title: runtimeTool.name,
      description: [
        runtimeTool.description,
        `Runtime tool id: ${runtimeTool.id}.`,
        runtimeTool.prepareInput
          ? "Input is derived from the current canvas/run context by the server; call with an empty object unless the user supplied explicit arguments."
          : "Provide input matching the schema.",
      ].join(" "),
      inputSchema: runtimeTool.prepareInput
        ? z.object({}).passthrough()
        : runtimeTool.inputSchema,
      metadata: getToolTraceMetadata(runtimeTool),
      async execute(input, options) {
        return executeRuntimeToolFromAiSdk({
          input,
          options,
          runtimeTool,
          state,
          store,
          writer: eventWriter,
        });
      },
    });
  }

  void streamWriter;
  return tools;
}

export function normalizeAiSdkPlanForIntent({
  context,
  intent,
  modelPlan,
  toolRegistry,
}: {
  context: BuiltContext;
  intent: IntentResult;
  modelPlan: PlanStep[];
  toolRegistry: ToolRegistry;
}) {
  const normalizedModelPlan = normalizePlan(modelPlan, {
    expectedImageCount: getExpectedImageCountForIntent(intent),
  });
  const modelValidation = mergePlanValidations(
    validatePlanAgainstRegistry(normalizedModelPlan, toolRegistry, context),
    validatePlanAgainstIntent(normalizedModelPlan, intent)
  );

  if (modelValidation.ok) {
    return {
      normalizedPlan: normalizedModelPlan,
      validation: modelValidation,
      correctedPlan: false,
      correctionReasons: [],
    };
  }

  const deterministicPlan = buildPlanFromIntentDeterministically(intent);
  const normalizedDeterministicPlan = normalizePlan(deterministicPlan, {
    expectedImageCount: getExpectedImageCountForIntent(intent),
  });
  const deterministicValidation = mergePlanValidations(
    validatePlanAgainstRegistry(
      normalizedDeterministicPlan,
      toolRegistry,
      context
    ),
    validatePlanAgainstIntent(normalizedDeterministicPlan, intent)
  );

  if (!deterministicValidation.ok) {
    throw new Error(
      [...modelValidation.errors, ...deterministicValidation.errors].join("; ")
    );
  }

  return {
    normalizedPlan: normalizedDeterministicPlan,
    validation: deterministicValidation,
    correctedPlan: true,
    correctionReasons: modelValidation.errors,
  };
}

export function selectAiSdkActiveToolNames({
  fallbackToolNames,
  state,
}: {
  fallbackToolNames: string[];
  state: Pick<MutableAiRunState, "plan" | "toolNamesById">;
}) {
  const plannedToolNames = uniqueInOrder(
    state.plan.flatMap((step) => {
      if (!step.toolId) {
        return [];
      }

      const toolName = state.toolNamesById.get(step.toolId);
      return toolName ? [toolName] : [];
    })
  );

  return plannedToolNames.length ? plannedToolNames : fallbackToolNames;
}

function validatePlanAgainstIntent(plan: PlanStep[], intent: IntentResult) {
  const errors: string[] = [];
  const allowedToolIds = new Set(intent.requiredTools);
  const plannedToolIds = new Set(
    plan.flatMap((step) => (step.toolId ? [step.toolId] : []))
  );

  for (const step of plan) {
    if (
      (step.kind === "tool" || step.kind === "canvas") &&
      step.toolId &&
      !allowedToolIds.has(step.toolId)
    ) {
      errors.push(
        `Step ${step.id} references tool ${step.toolId}, but intent only allows ${intent.requiredTools.join(", ") || "no tools"}.`
      );
    }
  }

  if (isImageIntent(intent)) {
    if (!plannedToolIds.has(toolIds.expandPrompt)) {
      errors.push("Image intent plan is missing prompt.expand.");
    }
    if (!plannedToolIds.has(toolIds.generateImage)) {
      errors.push("Image intent plan is missing image.generate.");
    }
  }

  return { ok: errors.length === 0, errors };
}

function mergePlanValidations(
  ...validations: Array<{ ok: boolean; errors: string[] }>
) {
  const errors = validations.flatMap((validation) => validation.errors);
  return { ok: errors.length === 0, errors };
}

function getExpectedImageCountForIntent(intent: IntentResult) {
  return Math.max(
    1,
    intent.task.deliverables
      .filter((deliverable) => deliverable.kind === "image")
      .reduce((total, deliverable) => total + (deliverable.count ?? 1), 0)
  );
}

function isImageIntent(intent: IntentResult) {
  return (
    intent.primaryIntent === "image_generation" ||
    intent.task.kind === "image_generation" ||
    intent.task.kind === "image_editing" ||
    intent.requiredTools.includes(toolIds.generateImage)
  );
}

function uniqueInOrder(values: string[]) {
  return Array.from(new Set(values));
}

async function executeRuntimeToolFromAiSdk({
  input,
  options,
  runtimeTool,
  state,
  store,
  writer,
}: {
  input: unknown;
  options: { toolCallId: string };
  runtimeTool: RuntimeToolDefinition;
  state: MutableAiRunState;
  store: AgentRunStore;
  writer: RuntimeEventWriter;
}) {
  if (!state.context) {
    throw new Error("AI SDK runtime tool was called before plan_agent_run.");
  }

  const run = store.getRun(state.context.runId);
  const step = findPlanStepForTool(runtimeTool, state.plan) ?? {
    id: getAiSdkToolName(runtimeTool),
    title: runtimeTool.name,
    goal: runtimeTool.description,
    kind: runtimeTool.policy.canModifyProject ? "canvas" : "tool",
    toolId: runtimeTool.id,
    capabilityId: runtimeTool.capabilityId,
    dependsOn: [],
    expectedArtifacts: [],
    expectedCanvasOperations: [],
    risk: runtimeTool.risk,
    approvalRequired: runtimeTool.policy.requiresApproval,
    retryPolicy: runtimeTool.retryPolicy,
  } satisfies PlanStep;
  const startedAt = new Date().toISOString();
  const startedStep: AgentStep = {
    id: `step-${run.id}-${step.id}`,
    planStepId: step.id,
    status: "running",
    startedAt,
  };
  const previousSteps = store.getRun(run.id).steps;
  const toolInput =
    runtimeTool.prepareInput?.({
      context: state.context,
      previousSteps,
      step,
    }) ??
    input ??
    {};
  const parsedInput = runtimeTool.inputSchema.parse(toolInput);
  const toolMetadata = getToolTraceMetadata(runtimeTool);
  const startedAtMs = Date.now();

  await store.upsertStep(run.id, startedStep);
  await appendEvent(store, run.id, writer, {
    projectId: run.projectId,
    runNodeId: run.input.metadata.runNodeId,
    stepId: step.id,
    type: "step.started",
    payload: {
      label: step.title,
      planStep: step,
      runtime: "vercel-ai-sdk",
    },
  });
  await appendEvent(store, run.id, writer, {
    projectId: run.projectId,
    runNodeId: run.input.metadata.runNodeId,
    stepId: step.id,
    type: "tool.input",
    payload: {
      toolCallId: options.toolCallId,
      toolName: getAiSdkToolName(runtimeTool),
      runtimeToolId: runtimeTool.id,
      input: parsedInput,
      metadata: toolMetadata,
    },
  });

  try {
    const result = await runWithRetry({
      operation: () =>
        runtimeTool.execute(parsedInput, {
          context: state.context as BuiltContext,
          previousSteps: store.getRun(run.id).steps,
          run: store.getRun(run.id),
          step,
        }),
      retryPolicy: step.retryPolicy ?? runtimeTool.retryPolicy,
      timeoutMs: runtimeTool.timeoutMs,
      stepId: step.id,
      toolId: runtimeTool.id,
      onRetryAttempt: async (attempt) => {
        await appendEvent(store, run.id, writer, {
          projectId: run.projectId,
          runNodeId: run.input.metadata.runNodeId,
          stepId: step.id,
          type: "retry.attempt",
          payload: {
            attempt: attempt.attempt,
            maxRetries: attempt.maxRetries,
            delayMs: attempt.delayMs,
            errorCode: attempt.error.code,
            errorText: attempt.error.message,
            toolId: runtimeTool.id,
            toolName: getAiSdkToolName(runtimeTool),
            metadata: toolMetadata,
          },
          errorText: attempt.error.message,
        });
      },
    });
    if (result.data !== undefined) {
      runtimeTool.outputSchema.parse(result.data);
    }

    await appendToolResultToRun({
      durationMs: Date.now() - startedAtMs,
      result,
      runId: run.id,
      step,
      store,
      toolCallId: options.toolCallId,
      toolMetadata,
      toolName: getAiSdkToolName(runtimeTool),
      writer,
    });
    await completeStep(store, store.getRun(run.id), {
      ...startedStep,
      input: parsedInput,
      output: result,
    });

    return result;
  } catch (error) {
    const agentError = toAgentError(error, {
      stepId: step.id,
      toolId: runtimeTool.id,
    });
    await store.appendError(run.id, agentError);
    await store.upsertStep(run.id, {
      ...startedStep,
      status: "failed",
      error: agentError,
      completedAt: new Date().toISOString(),
    });
    await appendEvent(store, run.id, writer, {
      projectId: run.projectId,
      runNodeId: run.input.metadata.runNodeId,
      stepId: step.id,
      type: "tool.error",
      payload: {
        toolCallId: options.toolCallId,
        toolName: getAiSdkToolName(runtimeTool),
        input: parsedInput,
        errorText: agentError.message,
        errorCode: agentError.code,
        errorDetails: agentError.details,
        durationMs: Date.now() - startedAtMs,
        failedStepId: step.id,
        metadata: toolMetadata,
      },
      errorText: agentError.message,
    });
    throw error;
  }
}

async function appendToolResultToRun({
  durationMs,
  result,
  runId,
  step,
  store,
  toolCallId,
  toolMetadata,
  toolName,
  writer,
}: {
  durationMs: number;
  result: ToolResult;
  runId: string;
  step: PlanStep;
  store: AgentRunStore;
  toolCallId: string;
  toolMetadata: Record<string, string>;
  toolName: string;
  writer: RuntimeEventWriter;
}) {
  const run = store.getRun(runId);
  const output = result.data ?? result;
  await appendEvent(store, run.id, writer, {
    projectId: run.projectId,
    runNodeId: run.input.metadata.runNodeId,
    stepId: step.id,
    type: "tool.output",
    payload: {
      toolCallId,
      toolName,
      output,
      durationMs,
      logs: result.logs,
      metadata: toolMetadata,
    },
  });

  await store.appendArtifacts(run.id, result.artifacts);
  for (const artifact of result.artifacts) {
    await appendEvent(store, run.id, writer, {
      projectId: run.projectId,
      runNodeId: run.input.metadata.runNodeId,
      stepId: step.id,
      type: "artifact.created",
      payload: {
        artifact,
        canvasNodeId: getRuntimeArtifactCanvasNodeId(artifact),
        toolCallId,
        toolName,
      },
    });
  }

  const operationPolicy = validateCanvasOperations({
    artifactIds: result.artifacts.map((artifact) => artifact.id),
    knownNodeIds: buildKnownCanvasNodeIds({
      artifacts: result.artifacts,
      run: store.getRun(run.id),
    }),
    operations: result.canvasOperations,
    projectId: run.projectId,
  });
  await store.appendCanvasOperations(
    run.id,
    operationPolicy.accepted.map((item) => item.operation)
  );
  for (const { operation } of operationPolicy.accepted) {
    await appendEvent(store, run.id, writer, {
      projectId: run.projectId,
      runNodeId: run.input.metadata.runNodeId,
      stepId: step.id,
      type: "canvas.operation.proposed",
      payload: { operation },
    });
    const legacyPatch = toLegacyGraphPatch(operation);
    await appendEvent(store, run.id, writer, {
      projectId: run.projectId,
      runNodeId: run.input.metadata.runNodeId,
      stepId: step.id,
      type: "graph.patch.proposed",
      payload: { patch: legacyPatch },
    });
    await appendEvent(store, run.id, writer, {
      projectId: run.projectId,
      runNodeId: run.input.metadata.runNodeId,
      stepId: step.id,
      type: "canvas.operation.applied",
      payload: { operation },
    });
    await appendEvent(store, run.id, writer, {
      projectId: run.projectId,
      runNodeId: run.input.metadata.runNodeId,
      stepId: step.id,
      type: "graph.patch.applied",
      payload: { patch: legacyPatch },
    });
  }
  for (const rejected of operationPolicy.rejected) {
    const agentError = createAgentError({
      code: runtimeErrorCodes.CANVAS_PATCH_REJECTED,
      message: `Canvas operation ${rejected.operation.id} was rejected: ${rejected.reason}.`,
      retryable: false,
      severity: "error",
      stepId: step.id,
      details: {
        operation: rejected.operation,
        reason: rejected.reason,
      },
    });
    await store.appendError(run.id, agentError);
    await appendEvent(store, run.id, writer, {
      projectId: run.projectId,
      runNodeId: run.input.metadata.runNodeId,
      stepId: step.id,
      type: "canvas.operation.rejected",
      payload: {
        operation: rejected.operation,
        reason: rejected.reason,
        errorCode: agentError.code,
        errorText: agentError.message,
      },
      errorText: agentError.message,
    });
  }
}

async function finalizeRun({
  canvasContext,
  eventWriter,
  input,
  runId,
  state,
  store,
}: {
  canvasContext: PromptCanvasContext;
  eventWriter: RuntimeEventWriter;
  input: AgentRun["input"];
  runId: string;
  state: MutableAiRunState;
  store: AgentRunStore;
}) {
  if (!state.context || !state.plan.length) {
    await store.appendError(
      runId,
      createAgentError({
        code: runtimeErrorCodes.PLAN_INVALID,
        message:
          "AI SDK model finished without calling plan_agent_run, so no executable plan was created.",
        retryable: true,
        severity: "error",
        stepId: "planner",
      })
    );
  }

  const evaluated = evaluateAgentRun(store.getRun(runId));
  await store.setEvaluation(runId, evaluated);
  await appendEvent(store, runId, eventWriter, {
    projectId: input.metadata.projectId,
    runNodeId: input.metadata.runNodeId,
    stepId: "evaluation",
    type: "evaluation.completed",
    payload: { evaluation: evaluated, runtime: "vercel-ai-sdk" },
  });

  const finalRun = store.getRun(runId);
  const completed = finalRun.status === "completed";
  await recordRunEvent({
    projectId: input.metadata.projectId,
    runNodeId: input.metadata.runNodeId,
    prompt: canvasContext.prompt,
    selectedNodeId: canvasContext.selectedNodeId ?? null,
    upstreamContext: canvasContext.upstreamContext,
    status: completed ? "success" : "error",
    skillInput: {
      input,
      context: state.context,
      plan: state.plan,
    },
    toolOutput: { artifacts: finalRun.artifacts, evaluation: evaluated },
    errorText: completed
      ? null
      : evaluated.issues.map((issue) => issue.message).join("; "),
  });
  await appendEvent(store, runId, eventWriter, {
    projectId: input.metadata.projectId,
    runNodeId: input.metadata.runNodeId,
    stepId: "run",
    type: completed ? "run.completed" : "run.failed",
    payload: {
      status: completed ? "success" : "error",
      artifactIds: finalRun.artifacts.map((artifact) => artifact.id),
      evaluation: evaluated,
      runtime: "vercel-ai-sdk",
    },
    errorText: completed
      ? undefined
      : evaluated.issues.map((issue) => issue.message).join("; "),
  });
}

function buildAiSdkAgentPrompt({
  canvasContext,
  modelProvider,
  publicSkills,
  toolRegistry,
}: {
  canvasContext: PromptCanvasContext;
  modelProvider: ModelProviderId;
  publicSkills: Awaited<ReturnType<typeof listLatestPublicSkills>>;
  toolRegistry: ToolRegistry;
}) {
  return [
    "You are running Cucumber, an infinite canvas agent.",
    "Use Vercel AI SDK tool calling as the only execution mechanism.",
    "Your first action must be calling plan_agent_run with an intent and an executable plan. Do not write ordinary assistant text before plan_agent_run returns. Then call the planned tools. Do not claim a tool succeeded before it returns.",
    "Use the user's language in visible text.",
    "",
    "USER_PROMPT",
    canvasContext.prompt,
    "",
    "RUN_CONTEXT",
    JSON.stringify(
      {
        modelProvider,
        promptNodeId: canvasContext.promptNodeId ?? null,
        selectedNodeId: canvasContext.selectedNodeId ?? null,
        upstreamContext: canvasContext.upstreamContext,
        contextTrace: canvasContext.contextTrace,
      },
      null,
      2
    ),
    "",
    "PUBLIC_SKILLS",
    JSON.stringify(
      publicSkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        slug: skill.slug,
        description: skill.description,
      })),
      null,
      2
    ),
    "",
    "ALLOWED_RUNTIME_TOOLS",
    JSON.stringify(
      toolRegistry.listAll().map((runtimeTool) => ({
        aiSdkToolName: getAiSdkToolName(runtimeTool),
        toolId: runtimeTool.id,
        capabilityId: runtimeTool.capabilityId,
        description: runtimeTool.description,
        policy: runtimeTool.policy,
        risk: runtimeTool.risk,
        inputDerivedByServer: Boolean(runtimeTool.prepareInput),
      })),
      null,
      2
    ),
    "",
    "PLANNING_RULES",
    [
      "plan_agent_run.plan[*].toolId must use the runtime toolId, not aiSdkToolName.",
      "Build intent in layers: coarse primaryIntent, target object(s), operation(s), constraints, deliverables, confidence/ambiguity, then required capabilities/tools.",
      "Represent target/object and operation details in IntentResult.task.targets, task.operations, task.constraints, and task.deliverables instead of inventing many narrow primaryIntent labels.",
      "Do not route to image generation unless the user explicitly asks to create, generate, edit, redraw, or render an image artifact.",
      "After planning, call tools by aiSdkToolName.",
      "For image generation, plan and call expand_prompt before generate_image. If upstream images are relevant, call analyze_reference_images before expand_prompt.",
      "For current web information, plan and call web_search before write_document.",
      "For document/report/answer tasks, compose the final Markdown yourself as write_document input so the result appears as a canvas artifact.",
      "write_document is an artifactizer: provide title, complete markdown, summary, and sourcesUsed when source links informed the document. Do not pass a prompt, outline, or placeholder markdown.",
      "When the user asks to generate a page, component, landing page, website, or HTML, plan html.generate and call generate_html. The HTML must be a complete standalone single-file document, with CSS in <style>, JS in <script>, and no external dependencies.",
      "Never invent artifacts or canvas changes. Only returned tool results count.",
    ].join("\n"),
  ].join("\n");
}

function getLifecycleStepId(toolName: string, state: MutableAiRunState) {
  if (toolName === planAgentRunToolName) {
    return "planner";
  }

  const runtimeToolId = Array.from(state.toolNamesById.entries()).find(
    ([, aiSdkToolName]) => aiSdkToolName === toolName
  )?.[0];
  return (
    state.plan.find((step) => step.toolId === runtimeToolId)?.id ??
    runtimeToolId ??
    toolName
  );
}

function summarizeAiSdkToolCall(toolCall: {
  toolCallId: string;
  toolName: string;
  input: unknown;
  dynamic?: boolean;
  invalid?: boolean;
  providerExecuted?: boolean;
  title?: string;
}) {
  return compactObject({
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    input: toolCall.input,
    dynamic: toolCall.dynamic,
    invalid: toolCall.invalid,
    providerExecuted: toolCall.providerExecuted,
    title: toolCall.title,
  });
}

function summarizeAiSdkToolResult(toolResult: {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  dynamic?: boolean;
  preliminary?: boolean;
  providerExecuted?: boolean;
  title?: string;
}) {
  return compactObject({
    toolCallId: toolResult.toolCallId,
    toolName: toolResult.toolName,
    input: toolResult.input,
    output: summarizeToolOutput(toolResult.output),
    dynamic: toolResult.dynamic,
    preliminary: toolResult.preliminary,
    providerExecuted: toolResult.providerExecuted,
    title: toolResult.title,
  });
}

function summarizeToolOutput(output: unknown) {
  if (!output || typeof output !== "object") {
    return output;
  }

  const record = output as Partial<ToolResult> & Record<string, unknown>;
  const data = record.data;
  const dataRecord = data && typeof data === "object"
    ? (data as Record<string, unknown>)
    : undefined;

  return compactObject({
    ok: record.ok,
    artifactCount: Array.isArray(record.artifacts) ? record.artifacts.length : undefined,
    canvasOperationCount: Array.isArray(record.canvasOperations)
      ? record.canvasOperations.length
      : undefined,
    logCount: Array.isArray(record.logs) ? record.logs.length : undefined,
    errorText:
      record.error && typeof record.error === "object"
        ? (record.error as { message?: unknown }).message
        : undefined,
    dataKind: dataRecord ? readString(dataRecord.kind) : undefined,
    dataKeys: dataRecord ? Object.keys(dataRecord).slice(0, 12) : undefined,
  });
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Tool execution failed.";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function findPlanStepForTool(
  runtimeTool: RuntimeToolDefinition,
  plan: PlanStep[]
) {
  return plan.find((step) => step.toolId === runtimeTool.id);
}

function getAiSdkToolName(runtimeTool: RuntimeToolDefinition) {
  return runtimeTool.toPlannerToolName.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function completeStep(
  store: AgentRunStore,
  run: AgentRun,
  step: AgentStep
) {
  await store.upsertStep(run.id, {
    ...step,
    status: "success",
    completedAt: new Date().toISOString(),
  });
}

async function appendEvent(
  store: AgentRunStore,
  runId: string,
  writer: RuntimeEventWriter,
  event: Parameters<RuntimeEventWriter["writeEvent"]>[0]
) {
  const written = await writer.writeEvent(event);
  await store.appendEvent(runId, written);
  return written;
}

async function writeFailureEvent(
  writer: RuntimeEventWriter,
  {
    agentError,
    canvasContext,
    projectId,
    runNodeId,
    storedErrors,
  }: {
    agentError: AgentError;
    canvasContext: PromptCanvasContext;
    projectId: string;
    runNodeId: string;
    storedErrors: AgentError[];
  }
) {
  try {
    await writer.writeEvent({
      projectId,
      runNodeId,
      stepId: agentError.stepId ?? "run",
      type: "run.failed",
      payload: {
        prompt: canvasContext.prompt,
        promptNodeId: canvasContext.promptNodeId ?? null,
        selectedNodeId: canvasContext.selectedNodeId ?? null,
        upstreamContext: canvasContext.upstreamContext,
        contextTrace: canvasContext.contextTrace,
        errorText: agentError.message,
        errorCode: agentError.code,
        errorDetails: agentError.details,
        failedStepId: agentError.stepId,
        errors: storedErrors,
        runtime: "vercel-ai-sdk",
      },
      errorText: agentError.message,
    });
  } catch (failureEventError) {
    console.error("[agent-run] failed to persist failure event", failureEventError);
  }
}

function buildKnownCanvasNodeIds({
  artifacts,
  run,
}: {
  artifacts: AgentRun["artifacts"];
  run: AgentRun;
}) {
  return [
    run.input.canvasContext.promptNodeId,
    run.input.canvasContext.runNodeId,
    run.input.canvasContext.selectedNodeId,
    ...run.input.canvasContext.upstreamContext.map((item) => item.nodeId),
    ...artifacts.map(getRuntimeArtifactCanvasNodeId),
  ].filter((nodeId): nodeId is string => Boolean(nodeId));
}

function getRuntimeArtifactCanvasNodeId(artifact: AgentRun["artifacts"][number]) {
  if (artifact.type === "image") {
    return `image-${artifact.id}`;
  }
  if (artifact.type === "webpage") {
    return `webpage-${artifact.id}`;
  }
  if (artifact.type === "code") {
    return `code-${artifact.id}`;
  }
  if (artifact.type === "doc") {
    return isMarkdownArtifact(artifact)
      ? `markdown-${artifact.id}`
      : `document-${artifact.id}`;
  }
  if (artifact.type === "tool_result") {
    return `tool-result-${artifact.id}`;
  }
  return `artifact-${artifact.id}`;
}

function isMarkdownArtifact(artifact: AgentRun["artifacts"][number]) {
  const format =
    typeof artifact.metadata?.format === "string"
      ? artifact.metadata.format.toLowerCase()
      : "";
  const mimeType =
    typeof artifact.metadata?.mimeType === "string"
      ? artifact.metadata.mimeType.toLowerCase()
      : "";

  return (
    format === "markdown" ||
    format === "md" ||
    mimeType === "text/markdown" ||
    artifact.uri?.endsWith(".md") ||
    artifact.contentRef?.endsWith(".md")
  );
}

function toLegacyGraphPatch(operation: CanvasOperation) {
  if (operation.type !== "attachArtifact") {
    return operation;
  }

  return {
    id: operation.id,
    projectId: operation.projectId,
    type: operation.type,
    payload: {
      nodeId: operation.payload.nodeId,
      artifact: operation.payload.artifact ?? {
        id: operation.payload.artifactId,
        type: "image",
      },
    },
  };
}
