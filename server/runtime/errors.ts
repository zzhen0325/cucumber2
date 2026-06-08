import { CapabilityRuntimeError } from "../capabilities.ts";
import type { AgentError } from "../../src/types/runtime.ts";

export const runtimeErrorCodes = {
  MODEL_OUTPUT_INVALID: "MODEL_OUTPUT_INVALID",
  TOOL_TIMEOUT: "TOOL_TIMEOUT",
  TOOL_NOT_REGISTERED: "TOOL_NOT_REGISTERED",
  TOOL_SCHEMA_INVALID: "TOOL_SCHEMA_INVALID",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  ENV_MISSING: "ENV_MISSING",
  CAPABILITY_UNAVAILABLE: "CAPABILITY_UNAVAILABLE",
  PLAN_INVALID: "PLAN_INVALID",
  CANVAS_PATCH_REJECTED: "CANVAS_PATCH_REJECTED",
  QUALITY_CHECK_FAILED: "QUALITY_CHECK_FAILED",
  TOOL_ERROR: "TOOL_ERROR",
} as const;

export class AgentRuntimeError extends Error {
  readonly agentError: AgentError;

  constructor(error: Omit<AgentError, "id" | "createdAt"> & { id?: string }) {
    super(error.message);
    this.name = "AgentRuntimeError";
    this.agentError = {
      ...error,
      id: error.id ?? `agent-error-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
  }
}

export function createAgentError(
  input: Omit<AgentError, "id" | "createdAt"> & {
    id?: string;
    createdAt?: string;
  }
): AgentError {
  return {
    ...input,
    id: input.id ?? `agent-error-${crypto.randomUUID()}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function toAgentError(error: unknown, context: {
  stepId?: string;
  toolId?: string;
} = {}): AgentError {
  if (error instanceof AgentRuntimeError) {
    return {
      ...error.agentError,
      stepId: error.agentError.stepId ?? context.stepId,
      toolId: error.agentError.toolId ?? context.toolId,
    };
  }

  if (error instanceof CapabilityRuntimeError) {
    return createAgentError({
      code: mapCapabilityErrorCode(error.code),
      message: error.message,
      retryable: error.code === "quota.exceeded" || error.code === "tool.error",
      severity: error.code === "approval.required" ? "warning" : "error",
      stepId: context.stepId,
      toolId: context.toolId,
      details: error.details,
    });
  }

  const message = getErrorMessage(error);
  return createAgentError({
    code: inferErrorCode(message),
    message,
    retryable: false,
    severity: "error",
    stepId: context.stepId,
    toolId: context.toolId,
  });
}

export function throwAgentError(
  input: Omit<AgentError, "id" | "createdAt">
): never {
  throw new AgentRuntimeError(input);
}

function mapCapabilityErrorCode(code: string) {
  if (code === "env.missing") {
    return runtimeErrorCodes.ENV_MISSING;
  }
  if (code === "permission.denied" || code === "approval.required") {
    return runtimeErrorCodes.PERMISSION_DENIED;
  }
  if (code === "capability.unavailable" || code === "capability.route_missing") {
    return runtimeErrorCodes.CAPABILITY_UNAVAILABLE;
  }
  return runtimeErrorCodes.TOOL_ERROR;
}

function inferErrorCode(message: string) {
  if (/(API_KEY|SECRET|TOKEN|SEEDREAM_|ARK_|DEEPSEEK_)/.test(message)) {
    return runtimeErrorCodes.ENV_MISSING;
  }
  if (/schema|parse|invalid/i.test(message)) {
    return runtimeErrorCodes.TOOL_SCHEMA_INVALID;
  }
  if (/timeout/i.test(message)) {
    return runtimeErrorCodes.TOOL_TIMEOUT;
  }
  return runtimeErrorCodes.TOOL_ERROR;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
