import { describe, expect, it } from "vitest";

import { evaluateAgentRun } from "./evaluator.ts";
import { AgentRunStore } from "./run-store.ts";
import type { AgentRun, PlanStep, RuntimeEvent } from "../../src/types/runtime.ts";

describe("runtime evaluator", () => {
  it("marks image count mismatches, missing artifacts, and missing image URLs", () => {
    const evaluation = evaluateAgentRun(
      runFixture({
        artifacts: [{ id: "image-1", type: "image" }],
        plan: [
          planStep("generate_images", [
            { type: "image", count: 2 },
            { type: "doc", count: 1 },
          ]),
        ],
      })
    );

    expect(evaluation.passed).toBe(false);
    expect(evaluation.needsRegeneration).toBe(true);
    expect(evaluation.issues.map((issue) => issue.code)).toEqual([
      "IMAGE_ARTIFACT_COUNT_MISMATCH",
      "ARTIFACT_MISSING",
      "IMAGE_ARTIFACT_URL_MISSING",
    ]);
    expect(evaluation.recommendedActions[0]).toContain("Regenerate");
  });

  it("marks rejected canvas operations as quality issues", () => {
    const evaluation = evaluateAgentRun(
      runFixture({
        trace: {
          events: [
            runtimeEvent("canvas.operation.rejected", {
              reason: "dangling_edge",
            }),
          ],
        },
      })
    );

    expect(evaluation.passed).toBe(false);
    expect(evaluation.needsRegeneration).toBe(false);
    expect(evaluation.issues).toEqual([
      {
        code: "CANVAS_OPERATION_REJECTED",
        message: "dangling_edge",
        severity: "error",
      },
    ]);
    expect(evaluation.recommendedActions[0]).toContain("Run Trace");
  });

  it("passes webpage artifacts with content and canvas visibility", () => {
    const evaluation = evaluateAgentRun(
      runFixture({
        artifacts: [
          {
            id: "page-1",
            type: "webpage",
            contentRef: "data:text/html,<main>ok</main>",
          },
        ],
        plan: [
          planStep(
            "generate_html",
            [{ type: "webpage", count: 1 }],
            [{ type: "createNode", description: "Place page on canvas." }]
          ),
        ],
        trace: {
          events: [
            runtimeEvent("artifact.created", {
              artifact: { id: "page-1", type: "webpage" },
              canvasNodeId: "webpage-page-1",
            }),
          ],
        },
      })
    );

    expect(evaluation.passed).toBe(true);
    expect(evaluation.issues).toEqual([]);
  });

  it("marks UI artifact completeness and canvas visibility failures", () => {
    const evaluation = evaluateAgentRun(
      runFixture({
        artifacts: [{ id: "page-1", type: "webpage" }],
        plan: [
          planStep(
            "generate_html",
            [{ type: "webpage", count: 1 }],
            [{ type: "createNode", description: "Place page on canvas." }]
          ),
        ],
      })
    );

    expect(evaluation.passed).toBe(false);
    expect(evaluation.needsRegeneration).toBe(true);
    expect(evaluation.issues.map((issue) => issue.code)).toEqual([
      "WEBPAGE_ARTIFACT_CONTENT_MISSING",
      "CANVAS_NODE_VISIBILITY_MISSING",
    ]);
  });

  it("marks code artifact test and typecheck failures", () => {
    const evaluation = evaluateAgentRun(
      runFixture({
        artifacts: [
          {
            id: "code-1",
            type: "code",
            contentRef: "artifact://code-1",
            metadata: {
              testStatus: "failed",
              typecheckStatus: "failed",
            },
          },
        ],
      })
    );

    expect(evaluation.issues.map((issue) => issue.code)).toEqual([
      "CODE_TESTS_FAILED",
      "CODE_TYPECHECK_FAILED",
    ]);
  });

  it("stores quality failures as evaluation state without appending system errors", async () => {
    const store = new AgentRunStore({ persist: false });
    const run = await store.createRun({
      input: runFixture().input,
      persist: false,
    });
    const evaluation = evaluateAgentRun(
      runFixture({
        plan: [planStep("generate_images", [{ type: "image", count: 1 }])],
      })
    );

    await store.setEvaluation(run.id, evaluation);

    const evaluatedRun = store.getRun(run.id);
    expect(evaluatedRun.status).toBe("failed");
    expect(evaluatedRun.errors).toEqual([]);
    expect(evaluatedRun.evaluation).toMatchObject({
      passed: false,
      needsRegeneration: true,
      recommendedActions: [
        "Regenerate from the failed Run node while preserving upstream context.",
      ],
    });
  });
});

function runFixture(overrides: Partial<AgentRun> = {}): AgentRun {
  const now = "2026-06-08T00:00:00.000Z";

  return {
    id: "run-1",
    userId: "user-1",
    projectId: "project-1",
    status: "evaluating",
    input: {
      userMessage: "生成图片",
      attachments: [],
      approvalResponses: [],
      canvasContext: {
        runNodeId: "run-node-1",
        upstreamContext: [],
      },
      conversationHistory: [],
      projectRefs: [],
      metadata: {
        userId: "user-1",
        projectId: "project-1",
        runNodeId: "run-node-1",
        modelProvider: "deepseek",
      },
    },
    plan: [],
    steps: [],
    artifacts: [],
    canvasOperations: [],
    errors: [],
    trace: {
      events: [],
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function planStep(
  id: string,
  expectedArtifacts: PlanStep["expectedArtifacts"],
  expectedCanvasOperations: PlanStep["expectedCanvasOperations"] = []
): PlanStep {
  return {
    id,
    title: id,
    goal: id,
    kind: "tool",
    dependsOn: [],
    expectedArtifacts,
    expectedCanvasOperations,
    risk: "low",
    approvalRequired: false,
  };
}

function runtimeEvent(
  type: RuntimeEvent["type"],
  payload: RuntimeEvent["payload"]
): RuntimeEvent {
  return {
    id: `${type}-event`,
    projectId: "project-1",
    runNodeId: "run-node-1",
    stepId: "step-1",
    type,
    payload,
    createdAt: "2026-06-08T00:00:00.000Z",
  };
}
