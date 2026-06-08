import {
  Check,
  CircleAlert,
  ListTree,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { useMemo } from "react";
import type { ReactNode } from "react";

import type { RunStepTraceEvent } from "@/lib/graph-projection";

type RunTracePanelProps = {
  error: string | null;
  events: RunStepTraceEvent[];
  loading: boolean;
  open: boolean;
  replayActive: boolean;
  runNodeId: string | null;
  onClose: () => void;
  onExitReplay: () => void;
  onReplay: () => void;
};

export function RunTracePanel({
  error,
  events,
  loading,
  open,
  replayActive,
  runNodeId,
  onClose,
  onExitReplay,
  onReplay,
}: RunTracePanelProps) {
  const summary = useMemo(() => summarizeRunTrace(events), [events]);

  if (!open) {
    return null;
  }

  return (
    <aside className="run-trace-panel" aria-label="Run Trace">
      <header className="run-trace-header">
        <div>
          <strong>Run Trace</strong>
          <span>{runNodeId ? shortId(runNodeId) : "未选择 Run"}</span>
        </div>
        <div className="run-trace-actions">
          {replayActive ? (
            <button
              aria-label="退出回放"
              onClick={onExitReplay}
              title="退出回放"
              type="button"
            >
              <X size={14} />
            </button>
          ) : (
            <button
              aria-label="回放到只读画布"
              disabled={!events.length || loading}
              onClick={onReplay}
              title="回放"
              type="button"
            >
              <RotateCcw size={14} />
            </button>
          )}
          <button
            aria-label="关闭 Trace 面板"
            onClick={onClose}
            title="关闭"
            type="button"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {loading && (
        <div className="trace-state">
          <Loader2 size={15} />
          <span>读取 trace</span>
        </div>
      )}

      {error && (
        <div className="trace-error">
          <CircleAlert size={14} />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && !events.length && (
        <div className="trace-state">
          <ListTree size={15} />
          <span>暂无事件</span>
        </div>
      )}

      {!loading && !error && events.length > 0 && (
        <div className="trace-sections">
          <TraceSection title="Step Timeline">
            <div className="trace-step-list">
              {summary.steps.map((step) => (
                <div className="trace-step-row" key={step.id}>
                  <span className={`trace-step-dot ${step.status}`}>
                    {step.status === "error" ? (
                      <CircleAlert size={11} />
                    ) : step.status === "success" ? (
                      <Check size={11} />
                    ) : (
                      <Loader2 size={11} />
                    )}
                  </span>
                  <strong>{step.label}</strong>
                  <small>{step.toolName ?? step.status}</small>
                </div>
              ))}
            </div>
          </TraceSection>

          <TraceSection title="Prompt Parts">
            <TraceKeyValue label="Digest" value={summary.promptDigest} />
            <TraceKeyValue
              label="Selected"
              value={summary.selectedPromptPartIds.join(", ") || "无"}
            />
            <TraceKeyValue
              label="Omitted"
              value={summary.omittedPromptPartIds.join(", ") || "无"}
            />
            {summary.contextTrace && (
              <TraceKeyValue
                label="Context"
                value={summarizeUnknown(summary.contextTrace)}
              />
            )}
          </TraceSection>

          <TraceSection title="Capabilities">
            <div className="trace-chip-row">
              {summary.selectedCapabilityIds.map((capabilityId) => (
                <span className="trace-chip" key={capabilityId}>
                  {capabilityId}
                </span>
              ))}
              {!summary.selectedCapabilityIds.length && (
                <span className="trace-muted">无</span>
              )}
            </div>
          </TraceSection>

          <TraceSection title="Tool IO">
            <div className="trace-event-list">
              {summary.toolEvents.map((event) => (
                <TraceEventRow event={event} key={event.id ?? event.createdAt} />
              ))}
              {!summary.toolEvents.length && <span className="trace-muted">无</span>}
            </div>
          </TraceSection>

          <TraceSection title="Artifacts">
            <div className="trace-chip-row">
              {summary.artifacts.map((artifact) => (
                <span className="trace-chip" key={artifact.id}>
                  {artifact.title ?? artifact.id} · {artifact.type}
                </span>
              ))}
              {!summary.artifacts.length && <span className="trace-muted">无</span>}
            </div>
          </TraceSection>

          <TraceSection title="Graph Patches">
            <div className="trace-event-list">
              {summary.graphPatchEvents.map((event) => (
                <TraceEventRow event={event} key={event.id ?? event.createdAt} />
              ))}
              {!summary.graphPatchEvents.length && (
                <span className="trace-muted">无</span>
              )}
            </div>
          </TraceSection>
        </div>
      )}
    </aside>
  );
}

export function ReplayBanner({
  activeRunId,
  onExit,
}: {
  activeRunId: string | null;
  onExit: () => void;
}) {
  if (!activeRunId) {
    return null;
  }

  return (
    <div className="replay-banner">
      <ListTree size={14} />
      <span>只读回放 · {shortId(activeRunId)}</span>
      <button aria-label="退出回放" onClick={onExit} title="退出回放" type="button">
        <X size={13} />
      </button>
    </div>
  );
}

function TraceSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="trace-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function TraceKeyValue({ label, value }: { label: string; value?: string }) {
  return (
    <div className="trace-kv">
      <span>{label}</span>
      <strong title={value}>{value || "无"}</strong>
    </div>
  );
}

function TraceEventRow({ event }: { event: RunStepTraceEvent }) {
  return (
    <div className="trace-event-row">
      <div>
        <strong>{getEventLabel(event)}</strong>
        <span>{event.stepId}</span>
      </div>
      <small title={summarizeUnknown(event.payload)}>
        {summarizeUnknown(event.payload)}
      </small>
    </div>
  );
}

function summarizeRunTrace(events: RunStepTraceEvent[]) {
  const completion =
    events.find((event) => event.type === "run.completed") ??
    events.find((event) => event.type === "run.failed") ??
    events.find((event) => event.type === "run.created");
  const promptTrace = findPromptTrace(completion?.payload.promptTrace);
  const runCreated = events.find((event) => event.type === "run.created");

  return {
    artifacts: events.flatMap((event) => {
      const artifact = event.payload.artifact;
      return event.type === "artifact.created" && isTraceArtifact(artifact)
        ? [artifact]
        : [];
    }),
    contextTrace:
      runCreated?.payload.contextTrace &&
      typeof runCreated.payload.contextTrace === "object"
        ? runCreated.payload.contextTrace
        : null,
    graphPatchEvents: events.filter(
      (event) =>
        event.type === "graph.patch.proposed" ||
        event.type === "graph.patch.applied"
    ),
    omittedPromptPartIds: promptTrace.omittedPromptPartIds,
    promptDigest: promptTrace.promptDigest,
    selectedCapabilityIds: readStringArray(
      runCreated?.payload.selectedCapabilityIds
    ),
    selectedPromptPartIds: promptTrace.selectedPromptPartIds,
    steps: buildTraceSteps(events),
    toolEvents: events.filter(
      (event) =>
        event.type === "tool.input" ||
        event.type === "tool.output" ||
        event.type === "tool.error"
    ),
  };
}

function buildTraceSteps(events: RunStepTraceEvent[]) {
  const steps = new Map<
    string,
    {
      id: string;
      label: string;
      status: "queued" | "running" | "success" | "error";
      toolName?: string;
    }
  >();
  const completed = events.some((event) => event.type === "run.completed");

  for (const event of events) {
    if (event.type === "step.started") {
      steps.set(event.stepId, {
        id: event.stepId,
        label: readString(event.payload.label) ?? event.stepId,
        status: "running",
      });
    }
    if (event.type === "tool.input" || event.type === "tool.output") {
      const previous = steps.get(event.stepId);
      steps.set(event.stepId, {
        id: event.stepId,
        label: previous?.label ?? event.stepId,
        status: event.type === "tool.output" ? "success" : "running",
        toolName: readString(event.payload.toolName) ?? previous?.toolName,
      });
    }
    if (event.type === "tool.error") {
      const previous = steps.get(event.stepId);
      steps.set(event.stepId, {
        id: event.stepId,
        label: previous?.label ?? event.stepId,
        status: "error",
        toolName: readString(event.payload.toolName) ?? previous?.toolName,
      });
    }
  }

  return Array.from(steps.values()).map((step) =>
    completed && step.status === "running" ? { ...step, status: "success" } : step
  );
}

function findPromptTrace(value: unknown): {
  promptDigest?: string;
  selectedPromptPartIds: string[];
  omittedPromptPartIds: string[];
} {
  if (!value || typeof value !== "object") {
    return {
      selectedPromptPartIds: [],
      omittedPromptPartIds: [],
    };
  }

  const traces = Object.values(value as Record<string, unknown>);
  const trace = traces.find(
    (item) =>
      item &&
      typeof item === "object" &&
      Array.isArray((item as { selectedPromptPartIds?: unknown }).selectedPromptPartIds)
  ) as
    | {
        promptDigest?: unknown;
        selectedPromptPartIds?: unknown;
        omittedPromptPartIds?: unknown;
      }
    | undefined;

  return {
    promptDigest: readString(trace?.promptDigest),
    selectedPromptPartIds: readStringArray(trace?.selectedPromptPartIds),
    omittedPromptPartIds: readStringArray(trace?.omittedPromptPartIds),
  };
}

function getEventLabel(event: RunStepTraceEvent) {
  const labels: Record<RunStepTraceEvent["type"], string> = {
    "artifact.created": "Artifact",
    "graph.patch.applied": "Patch applied",
    "graph.patch.proposed": "Patch proposed",
    "run.completed": "Run completed",
    "run.created": "Run created",
    "run.failed": "Run failed",
    "step.started": "Step",
    "tool.error": "Tool error",
    "tool.input": "Tool input",
    "tool.output": "Tool output",
  };

  return labels[event.type];
}

function isTraceArtifact(value: unknown): value is {
  id: string;
  type: string;
  title?: string;
} {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function summarizeUnknown(value: unknown) {
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

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-5)}` : value;
}
