import { describe, expect, it } from "vitest";

import {
  completeKernelStep,
  createKernelRun,
  failKernelStep,
  runStepEventInputSchema,
  startKernelStep,
} from "./run-kernel";

describe("run kernel contracts", () => {
  it("moves a step from queued to running to success", () => {
    const run = createKernelRun({
      id: "run-1",
      projectId: "project-1",
      runNodeId: "run-node-1",
      steps: [{ id: "expand_prompt", label: "Expand prompt" }],
      createdAt: "2026-06-08T00:00:00.000Z",
    });

    expect(run.status).toBe("queued");
    expect(run.steps[0].status).toBe("queued");

    startKernelStep(run, "expand_prompt", "2026-06-08T00:00:01.000Z");

    expect(run.status).toBe("running");
    expect(run.steps[0].status).toBe("running");
    expect(run.steps[0].startedAt).toBe("2026-06-08T00:00:01.000Z");

    completeKernelStep(run, "expand_prompt", "2026-06-08T00:00:02.000Z");

    expect(run.steps[0].status).toBe("success");
    expect(run.steps[0].completedAt).toBe("2026-06-08T00:00:02.000Z");
  });

  it("moves a running tool step to error and preserves the tool error", () => {
    const run = createKernelRun({
      id: "run-1",
      projectId: "project-1",
      runNodeId: "run-node-1",
      steps: [
        {
          id: "generate_image",
          label: "Generate image",
          toolName: "generate_image",
        },
      ],
      createdAt: "2026-06-08T00:00:00.000Z",
    });

    startKernelStep(run, "generate_image", "2026-06-08T00:00:01.000Z");
    failKernelStep(
      run,
      "generate_image",
      "Seedream returned no image URL.",
      "2026-06-08T00:00:02.000Z"
    );

    expect(run.status).toBe("error");
    expect(run.steps[0].status).toBe("error");
    expect(run.steps[0].errorText).toBe("Seedream returned no image URL.");
    expect(run.steps[0].toolCall?.errorText).toBe(
      "Seedream returned no image URL."
    );
  });

  it("validates the step event storage contract", () => {
    const event = runStepEventInputSchema.parse({
      projectId: "project-1",
      runNodeId: "run-node-1",
      stepId: "expand_prompt",
      type: "tool.error",
      payload: {
        errorText: "prompt-expand skill returned an empty prompt.",
        failedStepId: "expand_prompt",
      },
      errorText: "prompt-expand skill returned an empty prompt.",
      createdAt: "2026-06-08T00:00:00.000Z",
    });

    expect(event.type).toBe("tool.error");
    expect(event.payload.failedStepId).toBe("expand_prompt");
  });
});
