import type {
  AgentInput,
  AgentRun,
  AgentRunStatus,
  AgentStep,
  BuiltContext,
  CanvasOperation,
  EvaluationResult,
  IntentResult,
  PlanStep,
  RuntimeEvent,
  AgentError,
} from "../../src/types/runtime.ts";
import {
  upsertAgentRunSnapshot,
  upsertAgentRunSteps,
} from "../supabase.ts";
import { agentRunSchema } from "./schemas.ts";

type CreateRunInput = {
  id?: string;
  input: AgentInput;
  persist?: boolean;
};

type UpdateRunPatch = Partial<
  Pick<
    AgentRun,
    | "status"
    | "intent"
    | "context"
    | "plan"
    | "evaluation"
  >
> & {
  steps?: AgentStep[];
  artifacts?: AgentRun["artifacts"];
  canvasOperations?: CanvasOperation[];
  errors?: AgentError[];
  events?: RuntimeEvent[];
};

export class AgentRunStore {
  private readonly runs = new Map<string, AgentRun>();
  private readonly persist: boolean;

  constructor({ persist = true }: { persist?: boolean } = {}) {
    this.persist = persist;
  }

  async createRun(input: CreateRunInput) {
    const now = new Date().toISOString();
    const run = agentRunSchema.parse({
      id: input.id ?? `agent-run-${crypto.randomUUID()}`,
      userId: input.input.metadata.userId,
      projectId: input.input.metadata.projectId,
      status: "queued",
      input: input.input,
      steps: [],
      artifacts: [],
      canvasOperations: [],
      errors: [],
      trace: { events: [] },
      createdAt: now,
      updatedAt: now,
    });

    this.runs.set(run.id, run);
    await this.persistRun(run, input.persist);
    return run;
  }

  getRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown AgentRun: ${runId}`);
    }

    return run;
  }

  async setStatus(runId: string, status: AgentRunStatus) {
    return this.updateRun(runId, { status });
  }

  async setIntent(runId: string, intent: IntentResult) {
    return this.updateRun(runId, { status: "building_context", intent });
  }

  async setContext(runId: string, context: BuiltContext) {
    return this.updateRun(runId, { status: "planning", context });
  }

  async setPlan(runId: string, plan: PlanStep[]) {
    const steps = plan.map((step) => ({
      id: `step-${runId}-${step.id}`,
      planStepId: step.id,
      status: "queued" as const,
    }));
    return this.updateRun(runId, { status: "running", plan, steps });
  }

  async appendEvent(runId: string, event: RuntimeEvent) {
    const run = this.getRun(runId);
    return this.updateRun(runId, {
      events: [...run.trace.events, event],
    });
  }

  async upsertStep(runId: string, step: AgentStep) {
    const run = this.getRun(runId);
    const steps = run.steps.some((candidate) => candidate.planStepId === step.planStepId)
      ? run.steps.map((candidate) =>
          candidate.planStepId === step.planStepId ? step : candidate
        )
      : [...run.steps, step];

    return this.updateRun(runId, { steps });
  }

  async appendArtifacts(runId: string, artifacts: AgentRun["artifacts"]) {
    if (!artifacts.length) {
      return this.getRun(runId);
    }
    const run = this.getRun(runId);
    const existingIds = new Set(run.artifacts.map((artifact) => artifact.id));
    return this.updateRun(runId, {
      artifacts: [
        ...run.artifacts,
        ...artifacts.filter((artifact) => !existingIds.has(artifact.id)),
      ],
    });
  }

  async appendCanvasOperations(runId: string, operations: CanvasOperation[]) {
    if (!operations.length) {
      return this.getRun(runId);
    }
    const run = this.getRun(runId);
    return this.updateRun(runId, {
      canvasOperations: [...run.canvasOperations, ...operations],
    });
  }

  async appendError(runId: string, error: AgentError) {
    const run = this.getRun(runId);
    return this.updateRun(runId, {
      errors: [...run.errors, error],
    });
  }

  async setEvaluation(runId: string, evaluation: EvaluationResult) {
    return this.updateRun(runId, {
      status: evaluation.passed ? "completed" : "failed",
      evaluation,
    });
  }

  private async updateRun(runId: string, patch: UpdateRunPatch) {
    const run = this.getRun(runId);
    const updated = agentRunSchema.parse({
      ...run,
      ...patch,
      trace: {
        ...run.trace,
        events: patch.events ?? run.trace.events,
      },
      updatedAt: new Date().toISOString(),
    });

    this.runs.set(runId, updated);
    await this.persistRun(updated);
    return updated;
  }

  private async persistRun(run: AgentRun, override?: boolean) {
    if (!(override ?? this.persist)) {
      return;
    }

    await upsertAgentRunSnapshot({ run });
    await upsertAgentRunSteps({
      projectId: run.projectId,
      runNodeId: run.input.metadata.runNodeId,
      steps: run.steps,
    });
  }
}
