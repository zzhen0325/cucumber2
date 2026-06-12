import type { RunStepTraceEvent } from "@/lib/graph-projection";

export function summarizeRunTrace(events: RunStepTraceEvent[]) {
  const created = events.find((event) => event.type === "run.created");
  const completed = events.findLast((event) => event.type === "run.completed");
  const failed = events.findLast((event) => event.type === "run.failed");

  return {
    agents: events.filter((event) => event.type === "agent.active"),
    artifacts: events.flatMap((event) => {
      const artifact = event.payload.artifact;
      return event.type === "artifact.created" && isTraceArtifact(artifact)
        ? [artifact]
        : [];
    }),
    canvasOperationEvents: events.filter(
      (event) =>
        event.type === "canvas.operation.proposed" ||
        event.type === "canvas.operation.applied" ||
        event.type === "canvas.operation.rejected"
    ),
    errorEvents: events.filter(
      (event) =>
        event.type === "tool.error" ||
        event.type === "run.failed" ||
        event.type === "canvas.operation.rejected"
    ),
    finalOutput: readString(completed?.payload.finalOutput),
    handoffs: events.filter(
      (event) =>
        event.type === "handoff.requested" || event.type === "handoff.completed"
    ),
    prompt: readString(created?.payload.prompt),
    runStatus: failed ? "error" : completed ? "success" : "running",
    skillEvents: events.filter(
      (event) =>
        event.type === "skill.retrieved" ||
        event.type === "skill.activated" ||
        event.type === "skill.script.started" ||
        event.type === "skill.script.completed" ||
        event.type === "skill.script.failed"
    ),
    skills: events.flatMap((event) => {
      if (event.type === "skill.activated" && isTraceSkill(event.payload.skill)) {
        return [event.payload.skill];
      }
      return [];
    }),
    steps: buildTraceSteps(events),
    toolEvents: events.filter(
      (event) =>
        event.type === "tool.input" ||
        event.type === "tool.output" ||
        event.type === "tool.error"
    ),
  };
}

export function getEventLabel(event: RunStepTraceEvent) {
  const labels: Record<RunStepTraceEvent["type"], string> = {
    "agent.active": "Agent active",
    "artifact.created": "Artifact created",
    "canvas.operation.applied": "Canvas operation applied",
    "canvas.operation.proposed": "Canvas operation proposed",
    "canvas.operation.rejected": "Canvas operation rejected",
    "handoff.completed": "Handoff completed",
    "handoff.requested": "Handoff requested",
    "input.normalized": "Input normalized",
    "run.completed": "Run completed",
    "run.created": "Run created",
    "run.failed": "Run failed",
    "skill.activated": "Skill activated",
    "skill.retrieved": "Skills retrieved",
    "skill.script.completed": "Skill script completed",
    "skill.script.failed": "Skill script failed",
    "skill.script.started": "Skill script started",
    "tool.error": "Tool error",
    "tool.input": "Tool input",
    "tool.output": "Tool output",
  };
  return labels[event.type];
}

export function summarizeUnknown(value: unknown) {
  if (value === null || value === undefined) {
    return "无";
  }
  if (typeof value === "string") {
    return value.length > 180 ? `${value.slice(0, 180)}...` : value;
  }
  try {
    const text = JSON.stringify(value);
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
  } catch {
    return String(value);
  }
}

export function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-5)}` : value;
}

function buildTraceSteps(events: RunStepTraceEvent[]) {
  const steps = new Map<
    string,
    { id: string; label: string; status: "running" | "success" | "error"; toolName?: string }
  >();
  for (const event of events) {
    if (
      event.type !== "tool.input" &&
      event.type !== "tool.output" &&
      event.type !== "tool.error" &&
      event.type !== "skill.script.started" &&
      event.type !== "skill.script.completed" &&
      event.type !== "skill.script.failed"
    ) {
      continue;
    }
    const toolName =
      event.type.startsWith("skill.script.")
        ? readString(event.payload.scriptName) ?? event.stepId
        : readString(event.payload.toolName) ?? event.stepId;
    steps.set(event.stepId, {
      id: event.stepId,
      label: toolName,
      status:
        event.type === "tool.error" || event.type === "skill.script.failed"
          ? "error"
          : event.type === "tool.output" || event.type === "skill.script.completed"
            ? "success"
            : "running",
      toolName,
    });
  }
  return [...steps.values()];
}

function isTraceArtifact(value: unknown): value is { id: string; type: string; title?: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { id?: unknown }).id === "string" &&
      typeof (value as { type?: unknown }).type === "string"
  );
}

function isTraceSkill(value: unknown): value is { id: string; name: string; purpose?: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { id?: unknown }).id === "string" &&
      typeof (value as { name?: unknown }).name === "string"
  );
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
