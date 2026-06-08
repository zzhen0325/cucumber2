import type { RunStepTraceEvent } from "@/lib/graph-projection";

export function summarizeRunTrace(events: RunStepTraceEvent[]) {
  const completion =
    events.find((event) => event.type === "run.completed") ??
    events.find((event) => event.type === "run.failed") ??
    events.find((event) => event.type === "run.created");
  const promptTrace = findPromptTrace(completion?.payload.promptTrace);
  const runCreated = events.find((event) => event.type === "run.created");
  const intentRouted = events.find((event) => event.type === "intent.routed");
  const contextBuilt = events.find((event) => event.type === "context.built");
  const planCreated = events.find((event) => event.type === "plan.created");
  const evaluationCompleted = events.find(
    (event) => event.type === "evaluation.completed"
  );
  const failed = events.find((event) => event.type === "run.failed");

  return {
    artifacts: events.flatMap((event) => {
      const artifact = event.payload.artifact;
      return event.type === "artifact.created" && isTraceArtifact(artifact)
        ? [artifact]
        : [];
    }),
    canvasOperationEvents: events.filter(
      (event) =>
        event.type === "canvas.operation.proposed" ||
        event.type === "canvas.operation.applied" ||
        event.type === "canvas.operation.rejected"
    ),
    context: summarizeContextEvent(contextBuilt),
    contextTrace:
      runCreated?.payload.contextTrace &&
      typeof runCreated.payload.contextTrace === "object"
        ? runCreated.payload.contextTrace
        : null,
    errorEvents: events.filter(
      (event) =>
        event.type === "tool.error" ||
        event.type === "run.failed" ||
        event.type === "canvas.operation.rejected"
    ),
    evaluation: summarizeEvaluationEvent(evaluationCompleted),
    graphPatchEvents: events.filter(
      (event) =>
        event.type === "graph.patch.proposed" ||
        event.type === "graph.patch.applied"
    ),
    intent: summarizeIntentEvent(intentRouted),
    omittedPromptPartIds: promptTrace.omittedPromptPartIds,
    plan: summarizePlanEvent(planCreated),
    promptDigest: promptTrace.promptDigest,
    prompt: readString(runCreated?.payload.prompt),
    retryEvents: events.filter((event) => event.type === "retry.attempt"),
    runStatus:
      readString(completion?.payload.status) ??
      (failed
        ? "error"
        : events.some((event) => event.type === "run.completed")
          ? "success"
          : "running"),
    selectedCapabilityIds: readStringArray(
      runCreated?.payload.selectedCapabilityIds
    ),
    selectedPromptPartIds: promptTrace.selectedPromptPartIds,
    steps: buildTraceSteps(events),
    toolEvents: events.filter(
      (event) =>
        event.type === "tool.input" ||
        event.type === "tool.output" ||
        event.type === "tool.error" ||
        event.type === "tool.execution.started" ||
        event.type === "tool.execution.finished"
    ),
  };
}

export function getEventLabel(event: RunStepTraceEvent) {
  const labels: Record<RunStepTraceEvent["type"], string> = {
    "approval.requested": "Approval requested",
    "approval.responded": "Approval responded",
    "artifact.created": "Artifact",
    "canvas.operation.applied": "Canvas operation applied",
    "canvas.operation.proposed": "Canvas operation proposed",
    "canvas.operation.rejected": "Canvas operation rejected",
    "context.built": "Context built",
    "evaluation.completed": "Evaluation",
    "graph.patch.applied": "Patch applied",
    "graph.patch.proposed": "Patch proposed",
    "input.normalized": "Input normalized",
    "intent.routed": "Intent routed",
    "plan.created": "Plan created",
    "retry.attempt": "Retry attempt",
    "run.completed": "Run completed",
    "run.created": "Run created",
    "run.failed": "Run failed",
    "step.started": "Step",
    "step.finished": "Step finished",
    "tool.execution.finished": "Tool lifecycle finished",
    "tool.execution.started": "Tool lifecycle started",
    "tool.error": "Tool error",
    "tool.input": "Tool input",
    "tool.output": "Tool output",
  };

  return labels[event.type];
}

export function summarizeUnknown(value: unknown) {
  if (value === null || value === undefined) {
    return "无";
  }
  if (typeof value === "string") {
    return value.length > 180 ? `${value.slice(0, 180)}...` : value;
  }

  try {
    const text = JSON.stringify(value);
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
  } catch {
    return String(value);
  }
}

export function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-5)}` : value;
}

function summarizeIntentEvent(event: RunStepTraceEvent | undefined) {
  const intent = readObject(event?.payload.intent);
  const task = readObject(intent?.task);
  return {
    primaryIntent: readString(intent?.primaryIntent),
    taskKind: readString(task?.kind),
    routingReason: readString(intent?.routingReason),
    requiredTools: readStringArray(intent?.requiredTools),
  };
}

function summarizeContextEvent(event: RunStepTraceEvent | undefined) {
  const context = readObject(event?.payload.context);
  const budget = readObject(context?.budget);
  const trace = readObject(context?.trace);
  const selectedItems = Array.isArray(context?.selectedItems)
    ? context.selectedItems
    : [];
  const omittedItems = Array.isArray(context?.omittedItems)
    ? context.omittedItems
    : [];
  const availableTools = Array.isArray(context?.availableTools)
    ? context.availableTools
        .map((tool) => readString(readObject(tool)?.id))
        .filter((toolId): toolId is string => Boolean(toolId))
    : [];

  return {
    availableTools: availableTools.join(", "),
    budget: budget
      ? `${readNumber(budget.usedTokens) ?? 0}/${readNumber(budget.maxTokens) ?? "?"}`
      : undefined,
    omittedCount: String(readNumber(trace?.omittedCount) ?? 0),
    omittedReasons: summarizeContextItems(omittedItems, "omissionReason"),
    selectedCount: String(readNumber(trace?.selectedCount) ?? 0),
    selectedReasons: summarizeContextItems(selectedItems, "inclusionReason"),
    skillInjectionReason: readString(trace?.skillInjectionReason),
    toolExposureReason: readString(trace?.toolExposureReason),
  };
}

function summarizeContextItems(
  items: unknown[],
  reasonKey: "inclusionReason" | "omissionReason"
) {
  const summaries = items
    .map((item) => {
      const contextItem = readObject(item);
      const nodeId = readString(contextItem?.nodeId) ?? readString(contextItem?.id);
      const reason = readString(contextItem?.[reasonKey]);
      const tokenEstimate = readNumber(contextItem?.tokenEstimate);
      if (!nodeId && !reason) {
        return undefined;
      }

      return [
        nodeId ?? "context",
        reason,
        tokenEstimate === undefined ? undefined : `${tokenEstimate} tokens`,
      ]
        .filter(Boolean)
        .join(": ");
    })
    .filter((summary): summary is string => Boolean(summary));

  return summaries.join(" | ");
}

function summarizePlanEvent(event: RunStepTraceEvent | undefined) {
  const rawPlan = Array.isArray(event?.payload.rawPlan)
    ? event?.payload.rawPlan
    : [];
  const normalizedPlan = Array.isArray(event?.payload.normalizedPlan)
    ? event?.payload.normalizedPlan
    : [];
  const validation = readObject(event?.payload.validation);
  const steps = normalizedPlan.length ? normalizedPlan : rawPlan;
  const toolIds = steps
    .map((step) => readString(readObject(step)?.toolId))
    .filter((toolId): toolId is string => Boolean(toolId));

  return {
    normalizedPlan: normalizedPlan.length ? summarizeUnknown(normalizedPlan) : undefined,
    rawPlan: rawPlan.length ? summarizeUnknown(rawPlan) : undefined,
    stepCount: steps.length ? String(steps.length) : undefined,
    toolIds,
    validation:
      typeof validation?.ok === "boolean"
        ? validation.ok
          ? "valid"
          : summarizeUnknown(validation.errors)
        : undefined,
    validationDetail: validation ? summarizeUnknown(validation) : undefined,
  };
}

function summarizeEvaluationEvent(event: RunStepTraceEvent | undefined) {
  const evaluation = readObject(event?.payload.evaluation);
  const issues = Array.isArray(evaluation?.issues) ? evaluation.issues : [];
  const recommendedActions = Array.isArray(evaluation?.recommendedActions)
    ? evaluation.recommendedActions
    : [];

  return {
    issues: issues.length ? summarizeUnknown(issues) : "无",
    passed:
      typeof evaluation?.passed === "boolean"
        ? evaluation.passed
          ? "yes"
          : "no"
        : undefined,
    recommendedActions: recommendedActions.length
      ? summarizeUnknown(recommendedActions)
      : "无",
  };
}

function buildTraceSteps(events: RunStepTraceEvent[]) {
  const steps = new Map<
    string,
    {
      id: string;
      label: string;
      status: "queued" | "running" | "success" | "error";
      toolName?: string;
    }
  >();
  const completed = events.some((event) => event.type === "run.completed");

  for (const event of events) {
    if (event.type === "step.started") {
      steps.set(event.stepId, {
        id: event.stepId,
        label: readString(event.payload.label) ?? event.stepId,
        status: "running",
      });
    }
    if (event.type === "tool.input" || event.type === "tool.output") {
      const previous = steps.get(event.stepId);
      steps.set(event.stepId, {
        id: event.stepId,
        label: previous?.label ?? event.stepId,
        status: event.type === "tool.output" ? "success" : "running",
        toolName: readString(event.payload.toolName) ?? previous?.toolName,
      });
    }
    if (event.type === "tool.error") {
      const previous = steps.get(event.stepId);
      steps.set(event.stepId, {
        id: event.stepId,
        label: previous?.label ?? event.stepId,
        status: "error",
        toolName: readString(event.payload.toolName) ?? previous?.toolName,
      });
    }
  }

  return Array.from(steps.values()).map((step) =>
    completed && step.status === "running" ? { ...step, status: "success" } : step
  );
}

function findPromptTrace(value: unknown): {
  promptDigest?: string;
  selectedPromptPartIds: string[];
  omittedPromptPartIds: string[];
} {
  if (!value || typeof value !== "object") {
    return {
      selectedPromptPartIds: [],
      omittedPromptPartIds: [],
    };
  }

  const traces = Object.values(value as Record<string, unknown>);
  const trace = traces.find(
    (item) =>
      item &&
      typeof item === "object" &&
      Array.isArray((item as { selectedPromptPartIds?: unknown }).selectedPromptPartIds)
  ) as
    | {
        promptDigest?: unknown;
        selectedPromptPartIds?: unknown;
        omittedPromptPartIds?: unknown;
      }
    | undefined;

  return {
    promptDigest: readString(trace?.promptDigest),
    selectedPromptPartIds: readStringArray(trace?.selectedPromptPartIds),
    omittedPromptPartIds: readStringArray(trace?.omittedPromptPartIds),
  };
}

function isTraceArtifact(value: unknown): value is {
  id: string;
  type: string;
  title?: string;
} {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readObject(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
