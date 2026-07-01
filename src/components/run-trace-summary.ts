import type { RunStepTraceEvent } from "@/lib/graph-projection";

export function summarizeRunTrace(events: RunStepTraceEvent[]) {
  const created = events.find((event) => event.type === "run.created");
  const completed = events.findLast((event) => event.type === "run.completed");
  const failed = events.findLast((event) => event.type === "run.failed");

  return {
    agents: events.filter((event) => event.type === "agent.active"),
    agentMessageEvents: events.filter(
      (event) =>
        event.type === "agent.message.delta" ||
        event.type === "agent.message.completed"
    ),
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
        event.type === "skill.script.failed" ||
        event.type === "run.step.failed" ||
        event.type === "run.failed" ||
        event.type === "canvas.operation.rejected"
    ),
    finalOutput: readString(completed?.payload.finalOutput),
    handoffs: events.filter(
      (event) =>
        event.type === "handoff.requested" || event.type === "handoff.completed"
    ),
    context: readContextSummary(events),
    inputEvents: events.filter((event) => event.type === "input.normalized"),
    normalizedInputSummary: summarizeNormalizedInput(
      events.findLast((event) => event.type === "input.normalized")
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
        event.type === "tool.error" ||
        event.type === "run.step.started" ||
        event.type === "run.step.completed" ||
        event.type === "run.step.failed"
    ),
  };
}

export function getEventLabel(event: RunStepTraceEvent) {
  const labels: Record<RunStepTraceEvent["type"], string> = {
    "agent.active": "Agent active",
    "agent.message.completed": "Agent message completed",
    "agent.message.delta": "Agent message delta",
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
    "run.plan.created": "Run plan created",
    "run.step.completed": "Run step completed",
    "run.step.failed": "Run step failed",
    "run.step.started": "Run step started",
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

export function summarizeTraceEvent(event: RunStepTraceEvent) {
  if (event.type === "input.normalized") {
    return summarizeNormalizedInput(event) ?? summarizeUnknown(event.payload);
  }

  if (event.type === "skill.retrieved") {
    const candidates = readArray(event.payload.candidates)
      .map((candidate) => readRecord(candidate))
      .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
    if (!candidates.length) {
      return "未命中技能";
    }
    const names = candidates
      .map((candidate) => readString(candidate.name))
      .filter((name): name is string => Boolean(name))
      .slice(0, 4);
    return `${candidates.length} 个候选：${names.join("、")}`;
  }

  if (event.type === "skill.activated") {
    const skill = readRecord(event.payload.skill);
    const name = readString(skill?.name) ?? "技能";
    const purpose = readString(skill?.purpose);
    return purpose ? `${name} · ${purpose}` : name;
  }

  if (
    event.type === "agent.message.delta" ||
    event.type === "agent.message.completed"
  ) {
    const agentName = readString(event.payload.agentName) ?? "Agent";
    const text =
      readString(event.payload.content) ?? readString(event.payload.delta);
    return text ? `${agentName}: ${summarizeUnknown(text)}` : agentName;
  }

  if (event.type.startsWith("skill.script.")) {
    const scriptName = readString(event.payload.scriptName) ?? event.stepId;
    const skillName = readString(event.payload.skillName);
    const error = event.errorText ?? readString(event.payload.message);
    return [skillName, scriptName, error].filter(Boolean).join(" · ");
  }

  if (event.type === "tool.error") {
    const toolName = readString(event.payload.toolName) ?? event.stepId;
    const duration = formatDurationMs(readNumber(event.payload.durationMs));
    const error = event.errorText ?? readString(event.payload.errorText);
    const prefix = [toolName, duration].filter(Boolean).join(" · ");
    return error ? `${prefix}: ${error}` : `${prefix} 调用失败`;
  }

  if (event.type === "canvas.operation.rejected") {
    const operation = readRecord(event.payload.operation);
    const operationType = readString(operation?.type) ?? "operation";
    const operationId = readString(operation?.id);
    const reason = readString(event.payload.reason) ?? event.errorText;
    return [operationType, operationId, reason].filter(Boolean).join(" · ");
  }

  if (event.type === "run.failed") {
    const source = readString(event.payload.errorSource);
    const error = readString(event.payload.errorText) ?? event.errorText;
    const sourceLabel = source ? getErrorSourceLabel(source) : "运行失败";
    return error ? `${sourceLabel}: ${error}` : sourceLabel;
  }

  if (event.type === "run.plan.created") {
    const items = readArray(event.payload.items);
    return items.length ? `${items.length} 个步骤` : "计划已生成";
  }

  if (event.type.startsWith("run.step.")) {
    const label = getRunStepDisplayLabel(event);
    const duration = formatDurationMs(readNumber(event.payload.durationMs));
    const error = event.errorText ?? readString(event.payload.errorText);
    return [label, duration, error]
      .filter(Boolean)
      .join(" · ");
  }

  if (event.type === "tool.input" || event.type === "tool.output") {
    const toolName = readString(event.payload.toolName);
    const duration =
      event.type === "tool.output"
        ? formatDurationMs(readNumber(event.payload.durationMs))
        : undefined;
    return [toolName, duration].filter(Boolean).join(" · ") || summarizeUnknown(event.payload);
  }

  return summarizeUnknown(event.payload);
}

export function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-5)}` : value;
}

function buildTraceSteps(events: RunStepTraceEvent[]) {
  const steps = new Map<
    string,
    {
      durationMs?: number;
      id: string;
      label: string;
      startedAtMs?: number;
      status: "running" | "success" | "error";
      toolName?: string;
    }
  >();
  for (const event of events) {
    if (
      event.type !== "tool.input" &&
      event.type !== "tool.output" &&
      event.type !== "tool.error" &&
      event.type !== "run.step.started" &&
      event.type !== "run.step.completed" &&
      event.type !== "run.step.failed" &&
      event.type !== "skill.script.started" &&
      event.type !== "skill.script.completed" &&
      event.type !== "skill.script.failed"
    ) {
      continue;
    }
    const stepId = getTraceSummaryStepId(event);
    const previous = steps.get(stepId);
    const toolName =
      event.type.startsWith("run.step.")
        ? getRunStepDisplayLabel(event)
        : event.type.startsWith("skill.script.")
        ? readString(event.payload.scriptName) ?? event.stepId
        : readString(event.payload.toolName) ?? event.stepId;
    const startedAtMs =
      event.type === "tool.input"
        ? parseTimestampMs(event.createdAt)
        : previous?.startedAtMs;
    const durationMs = getTraceStepDurationMs(event, previous);
    steps.set(stepId, {
      durationMs,
      id: stepId,
      label: toolName,
      startedAtMs,
      status:
        event.type === "tool.error" || event.type === "skill.script.failed"
          || event.type === "run.step.failed"
          ? "error"
          : event.type === "tool.output" ||
              event.type === "skill.script.completed" ||
              event.type === "run.step.completed"
            ? "success"
            : "running",
      toolName,
    });
  }
  return [...steps.values()].map((step) => ({
    id: step.id,
    label: step.label,
    status: step.status,
    toolName: step.toolName,
    durationLabel: formatDurationMs(step.durationMs),
  }));
}

function getTraceSummaryStepId(event: RunStepTraceEvent) {
  if (
    event.type.startsWith("run.step.") &&
    (event.stepId === "quick.route" || event.stepId === "input.normalize")
  ) {
    return "requirement.normalize";
  }
  return event.stepId;
}

function getTraceStepDurationMs(
  event: RunStepTraceEvent,
  previous:
    | {
        durationMs?: number;
        startedAtMs?: number;
      }
    | undefined
) {
  const payloadDuration = readNumber(event.payload.durationMs);
  if (event.type === "tool.output" || event.type === "tool.error") {
    if (payloadDuration !== undefined) {
      return Math.max(0, Math.round(payloadDuration));
    }
    const completedAtMs = parseTimestampMs(event.createdAt);
    if (
      previous?.startedAtMs !== undefined &&
      completedAtMs !== undefined &&
      completedAtMs > previous.startedAtMs
    ) {
      return Math.round(completedAtMs - previous.startedAtMs);
    }
    return previous?.durationMs;
  }

  if (event.type === "run.step.completed" || event.type === "run.step.failed") {
    if (payloadDuration === undefined) {
      return previous?.durationMs;
    }
    if (getTraceSummaryStepId(event) === "requirement.normalize") {
      return Math.max(0, Math.round((previous?.durationMs ?? 0) + payloadDuration));
    }
    return Math.max(0, Math.round(payloadDuration));
  }

  return previous?.durationMs;
}

function parseTimestampMs(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function getRunStepDisplayLabel(event: RunStepTraceEvent) {
  if (event.stepId === "quick.route" || event.stepId === "input.normalize") {
    return "整理用户需求";
  }
  return readString(event.payload.label) ?? event.stepId;
}

function readContextSummary(events: RunStepTraceEvent[]) {
  const event =
    events.findLast((candidate) => candidate.type === "input.normalized") ??
    events.find((candidate) => candidate.type === "run.created") ??
    events.findLast((candidate) => candidate.type === "run.failed");
  const summary = readRecord(event?.payload.contextSummary);
  if (!summary) {
    return {
      selectedNodes: [],
      referenceNodes: [],
      upstreamPath: [],
      omittedNodes: [],
    };
  }

  return {
    selectedNodes: readContextNodes(summary.selectedNodes),
    referenceNodes: readContextNodes(summary.referenceNodes),
    upstreamPath: readArray(summary.upstreamPath).flatMap((item) => {
      const record = readRecord(item);
      const nodeId = readString(record?.nodeId);
      const type = readString(record?.type);
      if (!nodeId || !type) {
        return [];
      }
      return [{
        nodeId,
        type,
        title: readString(record?.title),
        summary: readString(record?.summary),
      }];
    }),
    omittedNodes: readArray(summary.omittedNodes).flatMap((item) => {
      const record = readRecord(item);
      const id = readString(record?.id);
      const kind = readString(record?.kind);
      if (!id || !kind) {
        return [];
      }
      return [{
        id,
        kind,
        label: readString(record?.label),
        reason: readString(record?.reason) ?? "omitted",
      }];
    }),
  };
}

function readContextNodes(value: unknown) {
  return readArray(value).flatMap((item) => {
    const record = readRecord(item);
    const id = readString(record?.id);
    const kind = readString(record?.kind);
    if (!id || !kind) {
      return [];
    }
    return [{
      id,
      kind,
      label: readString(record?.label),
    }];
  });
}

function summarizeNormalizedInput(event: RunStepTraceEvent | undefined) {
  const normalized = readRecord(event?.payload.normalizedInput);
  if (!normalized) {
    return undefined;
  }

  const task = readRecord(normalized.task);
  const intent = readString(task?.intent) ?? readString(task?.domain) ?? "unknown";
  const parts = [intent];

  const constraints = readRecord(normalized.constraints);
  const explicit = readArray(constraints?.explicit)
    .map(readRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const countEntry = explicit.find((entry) => readString(entry.key) === "output_count");
  const count = countEntry ? Number.parseInt(readString(countEntry.value) ?? "", 10) : NaN;
  if (Number.isInteger(count) && count > 0) {
    parts.push(`${count} 张`);
  }

  const dimensions = explicit.filter((entry) => readString(entry.key) === "dimension");
  if (dimensions.length > 1) {
    parts.push(`${dimensions.length} 个尺寸 · ${readString(dimensions[0].value)}…`);
  } else if (dimensions.length === 1) {
    parts.push(readString(dimensions[0].value) ?? "");
  } else {
    const aspectRatio = explicit.find((entry) => readString(entry.key) === "aspect_ratio");
    if (aspectRatio) {
      parts.push(readString(aspectRatio.value) ?? "");
    }
  }

  const goal = readRecord(normalized.userGoal);
  const goalText = readString(goal?.normalized);
  if (goalText) {
    parts.push(truncate(goalText, 80));
  }
  return parts.filter(Boolean).join(" · ");
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

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getErrorSourceLabel(source: string) {
  const labels: Record<string, string> = {
    byteartist: "ByteArtist",
    context: "上下文校验",
    coze: "Coze",
    model: "模型",
    seedream: "Seedream",
    skill_script: "技能脚本",
    tool: "工具",
    user: "用户停止",
    canvas_policy: "画布策略",
  };
  return labels[source] ?? source;
}

function formatDurationMs(durationMs: number | undefined) {
  if (durationMs === undefined) {
    return undefined;
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
