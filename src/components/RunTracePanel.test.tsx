import { describe, expect, it } from "vitest";

import { summarizeRunTrace } from "./run-trace-summary";
import type { RunStepTraceEvent } from "@/lib/graph-projection";

describe("summarizeRunTrace", () => {
  it("summarizes runtime routing, planning, retry, canvas, and evaluation events", () => {
    const summary = summarizeRunTrace([
      event("run.created", "run", {
        prompt: "基于参考图生成海报",
        selectedCapabilityIds: ["image.generate"],
      }),
      event("intent.routed", "router", {
        intent: {
          primaryIntent: "generate_image",
          routingReason: "User asked for image generation",
          requiredTools: ["seedream.generateImage"],
          task: { kind: "image_generation" },
        },
      }),
      event("context.built", "context", {
        context: {
          availableTools: [{ id: "seedream.generateImage" }],
          budget: { maxTokens: 1200, usedTokens: 460 },
          omittedItems: [
            {
              nodeId: "doc-1",
              omissionReason: "budget exceeded",
              tokenEstimate: 180,
            },
          ],
          selectedItems: [
            {
              nodeId: "image-1",
              inclusionReason: "selected reference",
              tokenEstimate: 120,
            },
          ],
          trace: {
            omittedCount: 1,
            selectedCount: 2,
            skillInjectionReason: "prompt skill selected",
            toolExposureReason: "image tools exposed",
          },
        },
      }),
      event("plan.created", "planner", {
        normalizedPlan: [
          {
            id: "step-generate",
            label: "Generate image",
            toolId: "seedream.generateImage",
          },
        ],
        rawPlan: [
          {
            id: "draft-generate",
            title: "Draft generate image",
            toolId: "seedream.generateImage",
          },
        ],
        validation: { ok: true },
      }),
      event("step.started", "step-generate", { label: "Generate image" }),
      event("tool.input", "step-generate", {
        toolName: "seedream.generateImage",
      }),
      event("retry.attempt", "step-generate", {
        attempt: 1,
        delayMs: 100,
        reason: "upstream timeout",
      }),
      event("tool.output", "step-generate", {
        durationMs: 420,
        logs: [{ level: "info", message: "Generated image" }],
        toolName: "seedream.generateImage",
      }),
      event("canvas.operation.proposed", "step-generate", {
        operation: { id: "op-1", type: "createNode" },
      }),
      event("canvas.operation.applied", "step-generate", {
        operationId: "op-1",
      }),
      event("evaluation.completed", "eval", {
        evaluation: {
          passed: false,
          issues: ["low contrast"],
          recommendedActions: ["regenerate"],
        },
      }),
      event("run.completed", "run", { status: "completed" }),
    ]);

    expect(summary.runStatus).toBe("completed");
    expect(summary.prompt).toBe("基于参考图生成海报");
    expect(summary.intent).toMatchObject({
      primaryIntent: "generate_image",
      taskKind: "image_generation",
      routingReason: "User asked for image generation",
      requiredTools: ["seedream.generateImage"],
    });
    expect(summary.context).toMatchObject({
      availableTools: "seedream.generateImage",
      budget: "460/1200",
      omittedCount: "1",
      omittedReasons: "doc-1: budget exceeded: 180 tokens",
      selectedCount: "2",
      selectedReasons: "image-1: selected reference: 120 tokens",
      skillInjectionReason: "prompt skill selected",
      toolExposureReason: "image tools exposed",
    });
    expect(summary.plan).toMatchObject({
      stepCount: "1",
      toolIds: ["seedream.generateImage"],
      validation: "valid",
    });
    expect(summary.plan.rawPlan).toContain("draft-generate");
    expect(summary.plan.normalizedPlan).toContain("step-generate");
    expect(summary.plan.validationDetail).toContain("\"ok\":true");
    expect(summary.retryEvents).toHaveLength(1);
    expect(summary.toolEvents[1]?.payload).toMatchObject({
      durationMs: 420,
      logs: [{ level: "info", message: "Generated image" }],
    });
    expect(summary.canvasOperationEvents.map((traceEvent) => traceEvent.type)).toEqual(
      ["canvas.operation.proposed", "canvas.operation.applied"]
    );
    expect(summary.evaluation).toMatchObject({
      passed: "no",
      issues: "[\"low contrast\"]",
      recommendedActions: "[\"regenerate\"]",
    });
    expect(summary.steps[0]).toMatchObject({
      id: "step-generate",
      label: "Generate image",
      status: "success",
      toolName: "seedream.generateImage",
    });
  });
});

function event(
  type: RunStepTraceEvent["type"],
  stepId: string,
  payload: Record<string, unknown>
): RunStepTraceEvent {
  return {
    projectId: "project-1",
    runNodeId: "run-1",
    stepId,
    type,
    payload,
    createdAt: `2026-06-08T00:00:${String(eventCounter++).padStart(2, "0")}.000Z`,
  };
}

let eventCounter = 0;
