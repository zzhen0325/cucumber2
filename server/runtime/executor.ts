import type { UIMessage, UIMessageStreamWriter } from "ai";

import {
  buildCapabilityRegistry,
} from "../capabilities.ts";
import {
  AGENT_RUN_TEXT_SYSTEM_PROMPT,
  renderRuntimePromptParts,
  type PromptCanvasContext,
} from "../prompts.ts";
import { streamTextWithProvider, type ModelProviderId } from "../model-providers.ts";
import {
  type AgentProject,
  listLatestPublicSkills,
  recordRunEvent,
} from "../supabase.ts";
import type {
  AgentError,
  AgentRun,
  AgentStep,
  PlanStep,
  ToolResult,
} from "../../src/types/runtime.ts";
import { createRuntimeEventWriter, type RuntimeEventWriter } from "./events.ts";
import { normalizeAgentInput } from "./input-normalizer.ts";
import { AgentRunStore } from "./run-store.ts";
import { routeIntent } from "./intent-router.ts";
import { buildContext } from "./context-builder.ts";
import { createPlan } from "./planner.ts";
import {
  buildToolRegistry,
  getToolTraceMetadata,
  type ToolRegistry,
} from "./tool-registry.ts";
import { evaluateAgentRun } from "./evaluator.ts";
import {
  createAgentError,
  runtimeErrorCodes,
  throwAgentError,
  toAgentError,
} from "./errors.ts";
import { runWithRetry } from "./retry.ts";
import { validateCanvasOperations } from "./canvas-operation-policy.ts";

type ExecuteAgentRunInput = {
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

type RunStepInput = {
  context: NonNullable<AgentRun["context"]>;
  run: AgentRun;
  step: PlanStep;
  streamWriter: UIMessageStreamWriter<UIMessage>;
  registry: ToolRegistry;
  store: AgentRunStore;
  writer: RuntimeEventWriter;
};

type ExecutePlanStepsInput = Omit<RunStepInput, "step"> & {
  plan: PlanStep[];
};

export async function executeAgentRun({
  canvasContext,
  messages,
  modelProvider,
  projectId,
  attachments,
  projectSnapshot,
  runNodeId,
  userId,
  writer: streamWriter,
}: ExecuteAgentRunInput) {
  const eventWriter = createRuntimeEventWriter({
    projectId,
    runNodeId,
    writer: streamWriter,
  });
  const store = new AgentRunStore();
  let input: ReturnType<typeof normalizeAgentInput> | null = null;
  let run: AgentRun | null = null;
  const promptTrace: Record<string, unknown> = {};

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
    input = normalizeAgentInput({
      canvasContext,
      messages,
      modelProvider,
      projectId,
      attachments,
      projectSnapshot,
      runNodeId,
      userId,
    });
    run = await store.createRun({ input });

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
      },
    });
    await appendEvent(store, run.id, eventWriter, {
      projectId,
      runNodeId,
      stepId: "input",
      type: "input.normalized",
      payload: { input },
    });
    await store.setStatus(run.id, "routing");

    const intent = await routeIntent({
      capabilities,
      input,
      modelProvider,
      toolRegistry,
    });
    await store.setIntent(run.id, intent);
    await appendEvent(store, run.id, eventWriter, {
      projectId,
      runNodeId,
      stepId: "intent-router",
      type: "intent.routed",
      payload: { intent },
    });

    const builtContext = buildContext({
      input,
      intent,
      publicSkills,
      runId: run.id,
      toolRegistry,
    });
    await store.setContext(run.id, builtContext);
    await appendEvent(store, run.id, eventWriter, {
      projectId,
      runNodeId,
      stepId: "context-builder",
      type: "context.built",
      payload: { context: builtContext },
    });

    const plan = await createPlan({
      context: builtContext,
      intent,
      modelProvider,
      toolRegistry,
    });
    await store.setPlan(run.id, plan.normalizedPlan);
    await appendEvent(store, run.id, eventWriter, {
      projectId,
      runNodeId,
      stepId: "planner",
      type: "plan.created",
      payload: plan,
    });

    await recordRunEvent({
      projectId,
      runNodeId,
      prompt: canvasContext.prompt,
      selectedNodeId: canvasContext.selectedNodeId ?? null,
      upstreamContext: canvasContext.upstreamContext,
      status: "running",
      skillInput: {
        input,
        intent,
        context: builtContext,
        plan: plan.normalizedPlan,
      },
    });

    const afterPlanRun = await executePlanSteps({
      context: builtContext,
      run: store.getRun(run.id),
      plan: plan.normalizedPlan,
      streamWriter,
      registry: toolRegistry,
      store,
      writer: eventWriter,
    });
    if (afterPlanRun.status === "waiting_approval") {
      return;
    }

    const evaluated = evaluateAgentRun(store.getRun(run.id));
    await store.setEvaluation(run.id, evaluated);
    await appendEvent(store, run.id, eventWriter, {
      projectId,
      runNodeId,
      stepId: "evaluation",
      type: "evaluation.completed",
      payload: { evaluation: evaluated },
    });

    const finalRun = store.getRun(run.id);
    const completed = finalRun.status === "completed";
    await recordRunEvent({
      projectId,
      runNodeId,
      prompt: canvasContext.prompt,
      selectedNodeId: canvasContext.selectedNodeId ?? null,
      upstreamContext: canvasContext.upstreamContext,
      status: completed ? "success" : "error",
      skillInput: { input, intent, context: builtContext, plan: plan.normalizedPlan },
      toolOutput: { artifacts: finalRun.artifacts, evaluation: evaluated },
      errorText: completed ? null : evaluated.issues.map((issue) => issue.message).join("; "),
    });
    await appendEvent(store, run.id, eventWriter, {
      projectId,
      runNodeId,
      stepId: "run",
      type: completed ? "run.completed" : "run.failed",
      payload: {
        status: completed ? "success" : "error",
        artifactIds: finalRun.artifacts.map((artifact) => artifact.id),
        evaluation: evaluated,
        promptTrace,
      },
      errorText: completed
        ? undefined
        : evaluated.issues.map((issue) => issue.message).join("; "),
    });
  } catch (error) {
    const agentError = toAgentError(error);
    console.error("[agent-run]", error);

    await writeFailureEvent(eventWriter, {
      agentError,
      canvasContext,
      projectId,
      runNodeId,
      storedErrors: run ? [...store.getRun(run.id).errors, agentError] : [agentError],
    });

    if (run) {
      await persistFailureState(store, run.id, agentError);
    }

    await recordRunEvent({
      projectId,
      runNodeId,
      prompt: canvasContext.prompt,
      selectedNodeId: canvasContext.selectedNodeId ?? null,
      upstreamContext: canvasContext.upstreamContext,
      status: "error",
      skillInput: input ? { input } : undefined,
      errorText: agentError.message,
    });
  }
}

export async function executePlanSteps({
  context,
  plan,
  registry,
  run,
  store,
  streamWriter,
  writer,
}: ExecutePlanStepsInput) {
  const orderedPlan = orderPlan(plan);
  for (let index = 0; index < orderedPlan.length; index += 1) {
    const step = orderedPlan[index];
    const currentRun = store.getRun(run.id);
    if (!dependenciesSucceeded(currentRun, step)) {
      await skipPlanStep({
        run: currentRun,
        reason: "dependency_not_successful",
        step,
        store,
      });
      continue;
    }

    try {
      const result = await runStep({
        context,
        run: currentRun,
        step,
        streamWriter,
        registry,
        store,
        writer,
      });
      const updatedRun = store.getRun(run.id);
      if (result.status === "waiting_approval" || updatedRun.status === "waiting_approval") {
        return updatedRun;
      }
    } catch (error) {
      const failedRun = store.getRun(run.id);
      const latestError = failedRun.errors.at(-1);
      if (latestError?.severity === "fatal" || step.kind === "approval") {
        await skipRemainingPlanSteps({
          error: latestError,
          reason:
            step.kind === "approval" ? "approval_denied" : "previous_step_failed",
          plan: orderedPlan.slice(index + 1),
          run: failedRun,
          store,
        });
      }
      throw error;
    }
  }

  return store.getRun(run.id);
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
      },
      errorText: agentError.message,
    });
  } catch (failureEventError) {
    console.error("[agent-run] failed to persist failure event", failureEventError);
  }
}

async function persistFailureState(
  store: AgentRunStore,
  runId: string,
  agentError: AgentError
) {
  try {
    await store.appendError(runId, agentError);
    await store.setStatus(runId, "failed");
  } catch (persistenceError) {
    console.error("[agent-run] failed to persist failure state", persistenceError);
  }
}

export async function runStep({
  context,
  registry,
  run,
  step,
  store,
  streamWriter,
  writer,
}: RunStepInput): Promise<AgentStep> {
  const startedAt = new Date().toISOString();
  const startedStep: AgentStep = {
    id: `step-${run.id}-${step.id}`,
    planStepId: step.id,
    status: step.kind === "approval" ? "waiting_approval" : "running",
    startedAt,
  };
  await store.upsertStep(run.id, startedStep);
  await appendEvent(store, run.id, writer, {
    projectId: run.projectId,
    runNodeId: run.input.metadata.runNodeId,
    stepId: step.id,
    type: "step.started",
    payload: {
      label: step.title,
      planStep: step,
    },
  });

  try {
    if (step.kind === "reasoning") {
      await runReasoningStep({ context, run, streamWriter });
      return completeStep(store, run, {
        ...startedStep,
        output: okResult({ text: "streamed" }),
      });
    }

    if (step.kind === "approval") {
      const approvalId = getApprovalId(run.input.metadata.runNodeId, step.id);
      const approvalResponse = run.input.approvalResponses.find(
        (response) => response.id === approvalId
      );
      if (approvalResponse?.approved === true) {
        await appendEvent(store, run.id, writer, {
          projectId: run.projectId,
          runNodeId: run.input.metadata.runNodeId,
          stepId: step.id,
          type: "approval.responded",
          payload: {
            approvalId,
            approved: true,
            reason: approvalResponse.reason,
            step,
          },
        });
        return completeStep(store, run, {
          ...startedStep,
          output: okResult({
            approvalId,
            approved: true,
            reason: approvalResponse.reason,
          }),
        });
      }

      if (approvalResponse?.approved === false) {
        await appendEvent(store, run.id, writer, {
          projectId: run.projectId,
          runNodeId: run.input.metadata.runNodeId,
          stepId: step.id,
          type: "approval.responded",
          payload: {
            approvalId,
            approved: false,
            reason: approvalResponse.reason,
            step,
          },
          errorText: approvalResponse.reason ?? "Approval was denied.",
        });
        throwAgentError({
          code: runtimeErrorCodes.PERMISSION_DENIED,
          message: approvalResponse.reason ?? "Approval was denied.",
          retryable: false,
          severity: "error",
          stepId: step.id,
          details: { approvalId, approved: false },
        });
      }

      await store.setStatus(run.id, "waiting_approval");
      streamWriter.write({
        type: "tool-approval-request",
        approvalId,
        toolCallId: approvalId,
      });
      await appendEvent(store, run.id, writer, {
        projectId: run.projectId,
        runNodeId: run.input.metadata.runNodeId,
        stepId: step.id,
        type: "approval.requested",
        payload: {
          approvalId,
          step,
          reason: step.goal,
        },
      });
      return startedStep;
    }

    if (step.kind === "evaluation") {
      return completeStep(store, run, {
        ...startedStep,
        output: okResult({ pending: true }),
      });
    }

    if (step.kind !== "tool" && step.kind !== "canvas") {
      return completeStep(store, run, {
        ...startedStep,
        output: okResult({ skipped: step.kind }),
      });
    }

    const tool = registry.requireTool(step.toolId ?? "");
    const previousSteps = store.getRun(run.id).steps;
    const toolInput =
      tool.prepareInput?.({ context, previousSteps, step }) ?? step.input ?? {};
    const parsedInput = tool.inputSchema.parse(toolInput);
    const toolCallId = `${tool.toPlannerToolName}-${crypto.randomUUID()}`;
    const toolMetadata = getToolTraceMetadata(tool);
    const toolStartedAtMs = Date.now();
    await writer.writeToolInput({
      stepId: step.id,
      toolCallId,
      toolName: tool.toPlannerToolName,
      toolInput: parsedInput,
      metadata: {
        projectId: run.projectId,
        runNodeId: run.input.metadata.runNodeId,
        stepId: step.id,
        ...toolMetadata,
      },
    });

    const result = await runWithRetry({
      operation: () =>
        tool.execute(parsedInput, {
          context,
          previousSteps,
          run: store.getRun(run.id),
          step,
        }),
      retryPolicy: tool.retryPolicy,
      timeoutMs: tool.timeoutMs,
      stepId: step.id,
      toolId: tool.id,
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
            toolId: tool.id,
            toolName: tool.toPlannerToolName,
            metadata: toolMetadata,
          },
          errorText: attempt.error.message,
        });
      },
    });
    if (result.data !== undefined) {
      tool.outputSchema.parse(result.data);
    }
    const output = result.data ?? result;

    await writer.writeToolOutput({
      stepId: step.id,
      toolCallId,
      toolName: tool.toPlannerToolName,
      output,
      durationMs: Date.now() - toolStartedAtMs,
      logs: result.logs,
      metadata: toolMetadata,
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
          toolName: tool.toPlannerToolName,
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
        toolId: tool.id,
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

    return completeStep(store, run, {
      ...startedStep,
      input: parsedInput,
      output: result,
    });
  } catch (error) {
    const agentError = toAgentError(error, {
      stepId: step.id,
      toolId: step.toolId,
    });
    await store.appendError(run.id, agentError);
    if (step.kind === "tool" || step.kind === "canvas") {
      const tool = registry.getTool(step.toolId ?? "");
      if (tool) {
        await writer.writeToolError({
          stepId: step.id,
          toolCallId: `${tool.toPlannerToolName}-${step.id}`,
          toolName: tool.toPlannerToolName,
          input: step.input,
          inputWritten: false,
          errorText: agentError.message,
          errorCode: agentError.code,
          errorDetails: agentError.details,
          durationMs: Date.now() - Date.parse(startedAt),
          logs: [],
          metadata: getToolTraceMetadata(tool),
        });
      }
    }

    const failedStep: AgentStep = {
      ...startedStep,
      status: "failed",
      error: agentError,
      completedAt: new Date().toISOString(),
    };
    await store.upsertStep(run.id, failedStep);
    throw error;
  }
}

function dependenciesSucceeded(run: AgentRun, step: PlanStep) {
  if (!step.dependsOn.length) {
    return true;
  }
  const stepsByPlanId = new Map(
    run.steps.map((candidate) => [candidate.planStepId, candidate])
  );
  return step.dependsOn.every(
    (dependency) => stepsByPlanId.get(dependency)?.status === "success"
  );
}

async function skipRemainingPlanSteps({
  error,
  plan,
  reason,
  run,
  store,
}: {
  error: AgentStep["error"];
  plan: PlanStep[];
  reason: string;
  run: AgentRun;
  store: AgentRunStore;
}) {
  for (const step of plan) {
    await skipPlanStep({
      error,
      reason,
      run,
      step,
      store,
    });
  }
}

async function skipPlanStep({
  error,
  reason,
  run,
  step,
  store,
}: {
  error?: AgentStep["error"];
  reason: string;
  run: AgentRun;
  step: PlanStep;
  store: AgentRunStore;
}) {
  await store.upsertStep(run.id, {
    id: `step-${run.id}-${step.id}`,
    planStepId: step.id,
    status: "skipped",
    output: okResult({ reason }),
    error,
    completedAt: new Date().toISOString(),
  });
}

async function runReasoningStep({
  context,
  run,
  streamWriter,
}: {
  context: NonNullable<AgentRun["context"]>;
  run: AgentRun;
  streamWriter: UIMessageStreamWriter<UIMessage>;
}) {
  const runtimePrompt = renderRuntimePromptParts([
    ...context.promptParts,
    {
      id: "runtime.run-target",
      category: "run_target",
      content: [
        `modelProvider: ${run.input.metadata.modelProvider}`,
        "resultCount: 1",
        "instruction: 请输出 1 到 3 句执行说明，说明你会如何理解需求并使用已选择的上下文。",
      ].join("\n"),
      tokenEstimate: 32,
    },
  ]);

  for await (const chunk of streamTextWithProvider(
    run.input.metadata.modelProvider as ModelProviderId,
    {
      system: AGENT_RUN_TEXT_SYSTEM_PROMPT,
      prompt: runtimePrompt,
      maxOutputTokens: 240,
    }
  )) {
    streamWriter.write(chunk);
  }
}

async function completeStep(
  store: AgentRunStore,
  run: AgentRun,
  step: AgentStep
) {
  const completedStep: AgentStep = {
    ...step,
    status: "success",
    completedAt: new Date().toISOString(),
  };
  await store.upsertStep(run.id, completedStep);
  return completedStep;
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

function okResult(data: unknown): ToolResult {
  return {
    ok: true,
    data,
    artifacts: [],
    canvasOperations: [],
    logs: [],
  };
}

function getApprovalId(runNodeId: string, stepId: string) {
  return `approval-${runNodeId}-${stepId}`;
}

function orderPlan(plan: PlanStep[]) {
  const remaining = new Map(plan.map((step) => [step.id, step]));
  const ordered: PlanStep[] = [];
  while (remaining.size) {
    const ready = Array.from(remaining.values()).find((step) =>
      step.dependsOn.every((dependency) =>
        ordered.some((candidate) => candidate.id === dependency)
      )
    );
    if (!ready) {
      throw new Error("Plan contains unresolved dependencies.");
    }
    ordered.push(ready);
    remaining.delete(ready.id);
  }
  return ordered;
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
    return `document-${artifact.id}`;
  }
  if (artifact.type === "tool_result") {
    return `tool-result-${artifact.id}`;
  }
  return `artifact-${artifact.id}`;
}

function toLegacyGraphPatch(operation: ToolResult["canvasOperations"][number]) {
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
