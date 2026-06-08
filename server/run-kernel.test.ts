import { describe, expect, it } from "vitest";

import {
  fromLegacyRunStatus,
  toLegacyRunStatus,
} from "../src/types/runtime";
import { normalizeAgentInput } from "./runtime/input-normalizer";
import { agentRunSchema } from "./runtime/schemas";
import {
  adaptKernelRunToAgentRun,
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

  it("maps legacy and first-class run statuses both ways", () => {
    expect(fromLegacyRunStatus("queued")).toBe("queued");
    expect(fromLegacyRunStatus("running")).toBe("running");
    expect(fromLegacyRunStatus("success")).toBe("completed");
    expect(fromLegacyRunStatus("error")).toBe("failed");

    expect(toLegacyRunStatus("queued")).toBe("queued");
    expect(toLegacyRunStatus("routing")).toBe("running");
    expect(toLegacyRunStatus("building_context")).toBe("running");
    expect(toLegacyRunStatus("planning")).toBe("running");
    expect(toLegacyRunStatus("running")).toBe("running");
    expect(toLegacyRunStatus("waiting_approval")).toBe("running");
    expect(toLegacyRunStatus("evaluating")).toBe("running");
    expect(toLegacyRunStatus("completed")).toBe("success");
    expect(toLegacyRunStatus("failed")).toBe("error");
    expect(toLegacyRunStatus("cancelled")).toBe("error");
  });

  it("adapts a legacy kernel run into a schema-valid AgentRun", () => {
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
    run.artifacts.push({
      id: "artifact-1",
      type: "image",
      uri: "https://cdn.example/image.png",
      title: "Generated image",
    });
    run.graphPatchProposals.push({
      id: "patch-1",
      type: "attachArtifact",
      payload: {
        nodeId: "run-node-1",
        artifactId: "artifact-1",
      },
      status: "applied",
    });

    startKernelStep(run, "generate_image", "2026-06-08T00:00:01.000Z");
    failKernelStep(
      run,
      "generate_image",
      "Seedream returned no image URL.",
      "2026-06-08T00:00:02.000Z"
    );

    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-node-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext: {
        prompt: "生成图片",
        promptNodeId: "prompt-1",
        selectedNodeId: null,
        upstreamContext: [],
      },
    });
    const adapted = agentRunSchema.parse(
      adaptKernelRunToAgentRun({ run, agentInput: input })
    );

    expect(adapted.status).toBe("failed");
    expect(adapted.input.canvasContext.promptNodeId).toBe("prompt-1");
    expect(adapted.input.canvasContext.runNodeId).toBe("run-node-1");
    expect(adapted.artifacts).toHaveLength(1);
    expect(adapted.canvasOperations).toEqual([
      {
        id: "patch-1",
        type: "attachArtifact",
        payload: {
          nodeId: "run-node-1",
          artifactId: "artifact-1",
        },
      },
    ]);
    expect(adapted.steps[0]).toMatchObject({
      id: "generate_image",
      planStepId: "generate_image",
      status: "failed",
      error: {
        code: "legacy.run_step_error",
        message: "Seedream returned no image URL.",
        toolId: "generate_image",
      },
      output: {
        ok: false,
        data: {
          legacyToolCall: {
            name: "generate_image",
            errorText: "Seedream returned no image URL.",
          },
        },
      },
    });
    expect(adapted.errors[0].message).toBe("Seedream returned no image URL.");
  });
});
