export function getAgentErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (isRecord(error)) {
    const message =
      readString(error.message) ??
      readString(error.error_description) ??
      readString(error.error) ??
      readString(error.reason);
    const code = readString(error.code) ?? readString(error.statusCode);
    const details = readString(error.details);
    const hint = readString(error.hint);
    const parts = [
      message,
      code ? `Code: ${code}` : null,
      details ? `Details: ${details}` : null,
      hint ? `Hint: ${hint}` : null,
    ].filter(Boolean);

    if (parts.length) {
      return parts.join(" ");
    }

    try {
      return JSON.stringify(error);
    } catch {
      // Fall through to the generic String conversion below.
    }
  }

  return String(error);
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function readString(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
