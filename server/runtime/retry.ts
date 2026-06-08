import type { AgentError, RetryPolicy } from "../../src/types/runtime.ts";
import { AgentRuntimeError, createAgentError, runtimeErrorCodes, toAgentError } from "./errors.ts";

export type RunWithRetryInput<T> = {
  operation: () => Promise<T>;
  retryPolicy: RetryPolicy;
  timeoutMs: number;
  stepId: string;
  toolId?: string;
  onRetryAttempt?: (input: {
    attempt: number;
    maxRetries: number;
    error: AgentError;
    delayMs: number;
  }) => Promise<void> | void;
};

export async function runWithRetry<T>({
  onRetryAttempt,
  operation,
  retryPolicy,
  stepId,
  timeoutMs,
  toolId,
}: RunWithRetryInput<T>): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await withTimeout(operation(), {
        stepId,
        timeoutMs,
        toolId,
      });
    } catch (error) {
      const agentError = toAgentError(error, { stepId, toolId });
      const shouldRetry =
        attempt < retryPolicy.maxRetries &&
        (agentError.retryable ||
          retryPolicy.retryableErrorCodes.includes(agentError.code));

      if (!shouldRetry) {
        throw error;
      }

      attempt += 1;
      const delayMs = retryPolicy.backoffMs * attempt;
      await onRetryAttempt?.({
        attempt,
        maxRetries: retryPolicy.maxRetries,
        error: agentError,
        delayMs,
      });
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  input: {
    timeoutMs: number;
    stepId: string;
    toolId?: string;
  }
) {
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    return promise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new AgentRuntimeError(
          createAgentError({
            code: runtimeErrorCodes.TOOL_TIMEOUT,
            message: `Tool ${input.toolId ?? input.stepId} timed out after ${input.timeoutMs}ms.`,
            retryable: true,
            severity: "error",
            stepId: input.stepId,
            toolId: input.toolId,
          })
        )
      );
    }, input.timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
