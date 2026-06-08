import { z } from "zod";
import { describe, expect, it } from "vitest";

import { CapabilityRuntimeError } from "../capabilities";
import { runtimeErrorCodes, throwAgentError } from "./errors";
import { normalizeAgentInput } from "./input-normalizer";
import { AgentRunStore } from "./run-store";
import { executePlanSteps, runStep } from "./executor";
import { ToolRegistry, type RuntimeToolDefinition } from "./tool-registry";
import type {
  BuiltContext,
  PlanStep,
  RuntimeEvent,
} from "../../src/types/runtime";

describe("runtime executor", () => {
  it("records rejected canvas operations instead of applying them", async () => {
    const input = normalizeAgentInput({
      canvasContext: {
        prompt: "生成图片",
        promptNodeId: "prompt-1",
        selectedNodeId: null,
        upstreamContext: [],
      },
      messages: [],
      modelProvider: "deepseek",
      projectId: "project-1",
      runNodeId: "run-1",
      userId: "user-1",
    });
    const store = new AgentRunStore({ persist: false });
    const run = await store.createRun({ input, persist: false });
    const step: PlanStep = {
      id: "bad-canvas-op",
      title: "Bad canvas op",
      goal: "Try invalid canvas operation",
      kind: "tool",
      toolId: "test.badCanvasOperation",
      dependsOn: [],
      expectedArtifacts: [],
      expectedCanvasOperations: [{ type: "setNodeStatus" }],
      risk: "low",
      approvalRequired: false,
    };
    await store.setPlan(run.id, [step]);
    const events: RuntimeEvent[] = [];

    await runStep({
      context: createContext(run.id),
      registry: new ToolRegistry([badCanvasOperationTool()] as never),
      run: store.getRun(run.id),
      step,
      store,
      streamWriter: {} as never,
      writer: {
        async writeEvent(event) {
          const written = {
            ...event,
            createdAt: event.createdAt ?? "2026-06-08T00:00:00.000Z",
          } as RuntimeEvent;
          events.push(written);
          return written;
        },
        async writeToolError() {},
        async writeToolInput() {},
        async writeToolOutput() {},
      },
    });

    const finalRun = store.getRun(run.id);
    expect(finalRun.canvasOperations).toEqual([]);
    expect(finalRun.errors[0]).toMatchObject({
      code: "CANVAS_PATCH_REJECTED",
      stepId: "bad-canvas-op",
      toolId: "test.badCanvasOperation",
    });
    expect(events.map((event) => event.type)).toContain(
      "canvas.operation.rejected"
    );
  });

  it("records unknown tools as a standard AgentError", async () => {
    const harness = await createRunStepHarness({
      step: {
        id: "unknown-tool",
        title: "Unknown tool",
        goal: "Call missing tool",
        kind: "tool",
        toolId: "missing.tool",
        dependsOn: [],
        expectedArtifacts: [],
        expectedCanvasOperations: [],
        risk: "low",
        approvalRequired: false,
      },
      registry: new ToolRegistry([]),
    });

    await expect(runStep(harness)).rejects.toThrow();

    expect(harness.store.getRun(harness.run.id).errors[0]).toMatchObject({
      code: runtimeErrorCodes.TOOL_NOT_REGISTERED,
      toolId: "missing.tool",
    });
  });

  it("records tool schema errors as a standard AgentError", async () => {
    const step: PlanStep = {
      id: "schema-error",
      title: "Schema error",
      goal: "Call tool with invalid input",
      kind: "tool",
      toolId: "test.schema",
      input: {},
      dependsOn: [],
      expectedArtifacts: [],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
    };
    const harness = await createRunStepHarness({
      step,
      registry: new ToolRegistry([schemaTool()] as never),
    });

    await expect(runStep(harness)).rejects.toThrow();

    expect(harness.store.getRun(harness.run.id).errors[0]).toMatchObject({
      code: runtimeErrorCodes.TOOL_SCHEMA_INVALID,
      stepId: "schema-error",
      toolId: "test.schema",
    });
  });

  it("records tool permission denial as a standard AgentError", async () => {
    const step: PlanStep = {
      id: "permission-error",
      title: "Permission error",
      goal: "Call denied tool",
      kind: "tool",
      toolId: "test.permission",
      input: {},
      dependsOn: [],
      expectedArtifacts: [],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
    };
    const harness = await createRunStepHarness({
      step,
      registry: new ToolRegistry([permissionDeniedTool()] as never),
    });

    await expect(runStep(harness)).rejects.toThrow();

    expect(harness.store.getRun(harness.run.id).errors[0]).toMatchObject({
      code: runtimeErrorCodes.PERMISSION_DENIED,
      stepId: "permission-error",
      toolId: "test.permission",
    });
  });

  it("pauses plan execution when an approval step is requested", async () => {
    const approvalStep: PlanStep = {
      id: "approval",
      title: "Approval",
      goal: "Wait for user approval.",
      kind: "approval",
      dependsOn: [],
      expectedArtifacts: [],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: true,
    };
    const nextStep = buildPlanStep({
      id: "after-approval",
      toolId: "test.afterApproval",
    });
    const harness = await createPlanHarness({
      plan: [approvalStep, nextStep],
      registry: new ToolRegistry([baseTestTool("test.afterApproval")] as never),
    });

    const run = await executePlanSteps(harness);

    expect(run.status).toBe("waiting_approval");
    expect(run.steps.find((step) => step.planStepId === "approval")).toMatchObject({
      status: "waiting_approval",
    });
    expect(
      run.steps.find((step) => step.planStepId === "after-approval")
    ).toMatchObject({ status: "queued" });
  });

  it("continues plan execution after approval is accepted", async () => {
    const approvalStep = buildApprovalStep();
    const nextStep = buildPlanStep({
      id: "after-approval",
      toolId: "test.afterApproval",
      dependsOn: ["approval"],
    });
    const harness = await createPlanHarness({
      messages: [approvalMessage("approval-run-1-approval", true)],
      plan: [approvalStep, nextStep],
      registry: new ToolRegistry([baseTestTool("test.afterApproval")] as never),
    });

    const run = await executePlanSteps(harness);

    expect(run.steps.find((step) => step.planStepId === "approval"))
      .toMatchObject({ status: "success" });
    expect(run.steps.find((step) => step.planStepId === "after-approval"))
      .toMatchObject({ status: "success" });
  });

  it("does not continue plan execution after approval is denied", async () => {
    const approvalStep = buildApprovalStep();
    const nextStep = buildPlanStep({
      id: "after-approval",
      toolId: "test.afterApproval",
      dependsOn: ["approval"],
    });
    const harness = await createPlanHarness({
      messages: [approvalMessage("approval-run-1-approval", false, "用户拒绝执行")],
      plan: [approvalStep, nextStep],
      registry: new ToolRegistry([baseTestTool("test.afterApproval")] as never),
    });

    await expect(executePlanSteps(harness)).rejects.toThrow();

    const run = harness.store.getRun(harness.run.id);
    expect(run.errors[0]).toMatchObject({
      code: runtimeErrorCodes.PERMISSION_DENIED,
      message: "用户拒绝执行",
      stepId: "approval",
    });
    expect(run.steps.find((step) => step.planStepId === "approval"))
      .toMatchObject({ status: "failed" });
    expect(run.steps.find((step) => step.planStepId === "after-approval"))
      .toMatchObject({
        status: "skipped",
        output: { data: { reason: "approval_denied" } },
      });
  });

  it("marks remaining plan steps skipped after a fatal step error", async () => {
    const fatalStep = buildPlanStep({
      id: "fatal",
      toolId: "test.fatal",
    });
    const nextStep = buildPlanStep({
      id: "after-fatal",
      toolId: "test.afterFatal",
      dependsOn: ["fatal"],
    });
    const harness = await createPlanHarness({
      plan: [fatalStep, nextStep],
      registry: new ToolRegistry([
        fatalTool(),
        baseTestTool("test.afterFatal"),
      ] as never),
    });

    await expect(executePlanSteps(harness)).rejects.toThrow();

    const run = harness.store.getRun(harness.run.id);
    expect(run.steps.find((step) => step.planStepId === "fatal")).toMatchObject({
      status: "failed",
      error: { severity: "fatal" },
    });
    expect(
      run.steps.find((step) => step.planStepId === "after-fatal")
    ).toMatchObject({
      status: "skipped",
      output: { data: { reason: "previous_step_failed" } },
    });
  });

  it("executes canvas steps through tool-generated canvas operations", async () => {
    const canvasStep: PlanStep = {
      ...buildPlanStep({
        id: "create-node",
        kind: "canvas",
        toolId: "test.createNode",
      }),
      expectedCanvasOperations: [{ type: "createNode" }],
    };
    const harness = await createPlanHarness({
      plan: [canvasStep],
      registry: new ToolRegistry([createNodeCanvasTool()] as never),
    });

    const run = await executePlanSteps(harness);

    expect(run.steps.find((step) => step.planStepId === "create-node"))
      .toMatchObject({ status: "success" });
    expect(run.canvasOperations).toHaveLength(1);
    expect(run.canvasOperations[0]).toMatchObject({
      type: "createNode",
      payload: { node: { id: "created-node-1" } },
    });
  });
});

async function createRunStepHarness({
  messages = [],
  registry,
  step,
}: {
  messages?: Parameters<typeof normalizeAgentInput>[0]["messages"];
  registry: ToolRegistry;
  step: PlanStep;
}): Promise<Parameters<typeof runStep>[0]> {
  const input = normalizeAgentInput({
    canvasContext: {
      prompt: "生成图片",
      promptNodeId: "prompt-1",
      selectedNodeId: null,
      upstreamContext: [],
    },
    messages,
    modelProvider: "deepseek",
    projectId: "project-1",
    runNodeId: "run-1",
    userId: "user-1",
  });
  const store = new AgentRunStore({ persist: false });
  const run = await store.createRun({ input, persist: false });
  await store.setPlan(run.id, [step]);

  return {
    context: createContext(run.id),
    registry,
    run: store.getRun(run.id),
    step,
    store,
    streamWriter: { write() {} } as never,
    writer: {
      async writeEvent(event) {
        return {
          ...event,
          createdAt: event.createdAt ?? "2026-06-08T00:00:00.000Z",
        };
      },
      async writeToolError() {},
      async writeToolInput() {},
      async writeToolOutput() {},
    },
  };
}

async function createPlanHarness({
  messages,
  plan,
  registry,
}: {
  messages?: Parameters<typeof normalizeAgentInput>[0]["messages"];
  plan: PlanStep[];
  registry: ToolRegistry;
}): Promise<Parameters<typeof executePlanSteps>[0]> {
  const stepHarness = await createRunStepHarness({
    messages,
    step: plan[0],
    registry,
  });
  await stepHarness.store.setPlan(stepHarness.run.id, plan);
  return {
    context: stepHarness.context,
    registry,
    run: stepHarness.store.getRun(stepHarness.run.id),
    plan,
    store: stepHarness.store,
    streamWriter: stepHarness.streamWriter,
    writer: stepHarness.writer,
  };
}

function buildApprovalStep(): PlanStep {
  return {
    id: "approval",
    title: "Approval",
    goal: "Wait for user approval.",
    kind: "approval",
    dependsOn: [],
    expectedArtifacts: [],
    expectedCanvasOperations: [],
    risk: "low",
    approvalRequired: true,
  };
}

function approvalMessage(id: string, approved: boolean, reason?: string) {
  return {
    id: `message-${id}`,
    role: "assistant",
    parts: [
      {
        type: "tool-generate_image",
        state: approved ? "approval-responded" : "output-denied",
        toolCallId: id,
        input: {},
        output: undefined,
        errorText: approved ? undefined : reason,
        approval: { id, approved, reason },
      },
    ],
  } as unknown as Parameters<typeof normalizeAgentInput>[0]["messages"][number];
}

function createContext(runId: string): BuiltContext {
  return {
    runId,
    taskContext: "test",
    selectedItems: [],
    omittedItems: [],
    availableTools: [],
    injectedSkills: [],
    promptParts: [],
    tokenEstimate: 1,
    budget: { maxTokens: 10, omittedTokens: 0, usedTokens: 1 },
    trace: {
      omittedCount: 0,
      selectedCount: 0,
      skillInjectionReason: "test",
      toolExposureReason: "test",
    },
  };
}

function badCanvasOperationTool(): RuntimeToolDefinition {
  const schema = z.object({});
  return {
    id: "test.badCanvasOperation",
    version: "test",
    capabilityId: "test.canvas",
    name: "Bad canvas operation",
    description: "Returns an invalid canvas operation.",
    inputSchema: schema,
    outputSchema: schema,
    policy: {
      canModifyProject: true,
      canUseNetwork: false,
      canWriteFiles: false,
      mayExternalCost: false,
      requiresApproval: false,
    },
    renderHint: { kind: "canvas_operation", label: "Bad canvas op" },
    retryPolicy: { backoffMs: 0, maxRetries: 0, retryableErrorCodes: [] },
    risk: "low",
    timeoutMs: 1_000,
    toPlannerToolName: "bad_canvas_operation",
    async execute() {
      return {
        ok: true,
        artifacts: [],
        canvasOperations: [
          {
            id: "op-bad",
            projectId: "project-1",
            type: "setNodeStatus",
            payload: { nodeId: "missing-node", status: "success" },
          },
        ],
        logs: [],
      };
    },
  };
}

function schemaTool(): RuntimeToolDefinition {
  return {
    ...baseTestTool("test.schema"),
    inputSchema: z.object({ required: z.string().min(1) }),
  };
}

function permissionDeniedTool(): RuntimeToolDefinition {
  return {
    ...baseTestTool("test.permission"),
    async execute() {
      throw new CapabilityRuntimeError(
        "permission.denied",
        "Tool is not allowed for this run."
      );
    },
  };
}

function fatalTool(): RuntimeToolDefinition {
  return {
    ...baseTestTool("test.fatal"),
    async execute() {
      throwAgentError({
        code: runtimeErrorCodes.TOOL_ERROR,
        message: "Fatal tool failure.",
        retryable: false,
        severity: "fatal",
        toolId: "test.fatal",
      });
    },
  };
}

function createNodeCanvasTool(): RuntimeToolDefinition {
  return {
    ...baseTestTool("test.createNode"),
    policy: {
      canModifyProject: true,
      canUseNetwork: false,
      canWriteFiles: false,
      mayExternalCost: false,
      requiresApproval: false,
    },
    renderHint: { kind: "canvas_operation", label: "Create node" },
    async execute() {
      return {
        ok: true,
        artifacts: [],
        canvasOperations: [
          {
            id: "op-create-node-1",
            projectId: "project-1",
            type: "createNode",
            payload: {
              node: {
                id: "created-node-1",
                type: "markdownNode",
                position: { x: 0, y: 0 },
                data: {
                  kind: "markdown",
                  artifact: { id: "artifact-md-1", type: "doc" },
                  title: "Created node",
                  content: "Created from a canvas step.",
                },
              },
            },
          },
        ],
        logs: [],
      };
    },
  };
}

function buildPlanStep({
  dependsOn = [],
  id,
  kind = "tool",
  toolId,
}: {
  dependsOn?: string[];
  id: string;
  kind?: PlanStep["kind"];
  toolId: string;
}): PlanStep {
  return {
    id,
    title: id,
    goal: id,
    kind,
    toolId,
    dependsOn,
    expectedArtifacts: [],
    expectedCanvasOperations: [],
    risk: "low",
    approvalRequired: false,
  };
}

function baseTestTool(id: string): RuntimeToolDefinition {
  const schema = z.object({});
  return {
    id,
    version: "test",
    capabilityId: "test.capability",
    name: id,
    description: id,
    inputSchema: schema,
    outputSchema: schema,
    policy: {
      canModifyProject: false,
      canUseNetwork: false,
      canWriteFiles: false,
      mayExternalCost: false,
      requiresApproval: false,
    },
    renderHint: { kind: "text", label: id },
    retryPolicy: { backoffMs: 0, maxRetries: 0, retryableErrorCodes: [] },
    risk: "low",
    timeoutMs: 1_000,
    toPlannerToolName: id.replace(".", "_"),
    async execute() {
      return {
        ok: true,
        artifacts: [],
        canvasOperations: [],
        logs: [],
      };
    },
  };
}
