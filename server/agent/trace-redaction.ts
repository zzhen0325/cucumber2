import { getToolRegistryEntry } from "./tool-registry.ts";

const maxTraceStringLength = 8_000;
const maxTraceArrayLength = 50;
const sensitiveKeyPattern =
  /(?:authorization|cookie|credential|password|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)/i;
const sensitiveUrlKeyPattern =
  /(?:imageUrl|sourceUrl|signedUrl|downloadUrl|uploadUrl|url|uri|contentRef)$/i;
const urlValuePattern = /^(?:https?:|data:|blob:|file:)/i;

export type RedactionSummary = {
  redacted: boolean;
  redactedFields: string[];
};

export type RedactedTraceValue = {
  value: unknown;
  summary: RedactionSummary;
};

export function redactTraceValue(value: unknown): RedactedTraceValue {
  const fields = new Set<string>();
  const redacted = redactValue(value, [], fields);
  return {
    value: redacted,
    summary: {
      redacted: fields.size > 0,
      redactedFields: [...fields].sort(),
    },
  };
}

export function redactToolTraceValue({
  direction,
  toolName,
  value,
}: {
  direction: "input" | "output";
  toolName: string;
  value: unknown;
}) {
  const redacted = redactTraceValue(value);
  const entry = getToolRegistryEntry(toolName);
  const metadata: Record<string, string> = {
    redactionApplied: String(redacted.summary.redacted),
    redactedFields: redacted.summary.redactedFields.join(","),
    traceDirection: direction,
  };
  if (entry) {
    metadata.toolLabel = entry.traceLabel;
  }
  return {
    ...redacted,
    metadata,
  };
}

function redactValue(
  value: unknown,
  path: string[],
  fields: Set<string>
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    if (urlValuePattern.test(value.trim()) && shouldRedactUrlValue(path)) {
      fields.add(formatPath(path));
      return "[redacted-url]";
    }
    if (value.length > maxTraceStringLength) {
      fields.add(formatPath(path));
      return `${value.slice(0, maxTraceStringLength)}...[truncated]`;
    }
    return value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, maxTraceArrayLength)
      .map((item, index) => redactValue(item, [...path, String(index)], fields));
    if (value.length > maxTraceArrayLength) {
      fields.add(formatPath(path));
      items.push(`[truncated ${value.length - maxTraceArrayLength} items]`);
    }
    return items;
  }

  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    const childPath = [...path, key];
    if (sensitiveKeyPattern.test(key)) {
      fields.add(formatPath(childPath));
      result[key] = "[redacted]";
      continue;
    }
    if (sensitiveUrlKeyPattern.test(key) && typeof child === "string") {
      fields.add(formatPath(childPath));
      result[key] = "[redacted-url]";
      continue;
    }
    result[key] = redactValue(child, childPath, fields);
  }
  return result;
}

function shouldRedactUrlValue(path: string[]) {
  const key = path[path.length - 1] ?? "";
  return sensitiveUrlKeyPattern.test(key);
}

function formatPath(path: string[]) {
  return path.length ? path.join(".") : "$";
}
