import { describe, expect, it, vi } from "vitest";

import { AgentRuntimeError, createAgentError, runtimeErrorCodes } from "./errors";
import { runWithRetry } from "./retry";

describe("runtime retry", () => {
  it("retries retryable errors and reports retry attempts", async () => {
    const attempts: number[] = [];
    let calls = 0;

    const result = await runWithRetry({
      stepId: "expand_prompt",
      toolId: "prompt.expand",
      timeoutMs: 1_000,
      retryPolicy: {
        maxRetries: 1,
        backoffMs: 0,
        retryableErrorCodes: [runtimeErrorCodes.TOOL_ERROR],
      },
      async onRetryAttempt(input) {
        attempts.push(input.attempt);
      },
      async operation() {
        calls += 1;
        if (calls === 1) {
          throw new AgentRuntimeError({
            code: runtimeErrorCodes.TOOL_ERROR,
            message: "Transient tool failure.",
            retryable: true,
            severity: "error",
            stepId: "expand_prompt",
            toolId: "prompt.expand",
          });
        }

        return "ok";
      },
    });

    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(attempts).toEqual([1]);
  });

  it("converts slow operations to TOOL_TIMEOUT", async () => {
    vi.useFakeTimers();
    try {
      const promise = runWithRetry({
        stepId: "generate_image",
        toolId: "seedream.generateImage",
        timeoutMs: 10,
        retryPolicy: {
          maxRetries: 0,
          backoffMs: 0,
          retryableErrorCodes: [],
        },
        operation: () => new Promise(() => {}),
      });
      const expectation = expect(promise).rejects.toMatchObject({
        agentError: {
          code: runtimeErrorCodes.TOOL_TIMEOUT,
          retryable: true,
        },
      });

      await vi.advanceTimersByTimeAsync(10);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry non-retryable errors", async () => {
    let calls = 0;

    await expect(
      runWithRetry({
        stepId: "planner",
        timeoutMs: 1_000,
        retryPolicy: {
          maxRetries: 2,
          backoffMs: 0,
          retryableErrorCodes: [],
        },
        async operation() {
          calls += 1;
          throw new AgentRuntimeError(
            createAgentError({
              code: runtimeErrorCodes.PLAN_INVALID,
              message: "Bad plan.",
              retryable: false,
              severity: "error",
              stepId: "planner",
            })
          );
        },
      })
    ).rejects.toMatchObject({
      agentError: {
        code: runtimeErrorCodes.PLAN_INVALID,
      },
    });
    expect(calls).toBe(1);
  });
});
