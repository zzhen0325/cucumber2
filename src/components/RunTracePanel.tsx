import { CheckmarkIcon as Check, AlertCircleIcon as CircleAlert, BulletListTreeIcon as ListTree, SpinnerIcon as Loader2, ArrowCounterclockwiseIcon as RotateCcw, CancelIcon as X } from "@proicons/react";
import { useMemo, type ReactNode } from "react";

import type { RunStepTraceEvent } from "@/lib/graph-projection";
import {
  getEventLabel,
  shortId,
  summarizeRunTrace,
  summarizeTraceEvent,
  summarizeUnknown,
} from "./run-trace-summary";

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
            <button aria-label="退出回放" onClick={onExitReplay} title="退出回放" type="button">
              <X size={14} />
            </button>
          ) : (
            <button aria-label="回放到只读画布" disabled={!events.length || loading} onClick={onReplay} title="回放" type="button">
              <RotateCcw size={14} />
            </button>
          )}
          <button aria-label="关闭 Trace 面板" onClick={onClose} title="关闭" type="button">
            <X size={14} />
          </button>
        </div>
      </header>

      {loading && <TraceState icon={<Loader2 size={15} />} label="读取 trace" />}
      {error && (
        <div className="trace-error">
          <CircleAlert size={14} />
          <span>{error}</span>
        </div>
      )}
      {!loading && !error && !events.length && (
        <TraceState icon={<ListTree size={15} />} label="暂无事件" />
      )}

      {!loading && !error && events.length > 0 && (
        <div className="trace-sections">
          <TraceSection title="Run">
            <TraceKeyValue label="Status" value={summary.runStatus} />
            <TraceKeyValue label="Prompt" value={summary.prompt} />
            <TraceKeyValue label="Input" value={summary.normalizedInputSummary} />
            <TraceKeyValue label="Final" value={summary.finalOutput} />
            <TraceKeyValue label="Events" value={String(events.length)} />
          </TraceSection>

          <TraceSection title="Context">
            <ContextSummaryView context={summary.context} />
          </TraceSection>

          <TraceSection title="Input">
            <EventList events={summary.inputEvents} />
          </TraceSection>

          <TraceSection title="Agents & Handoffs">
            <EventList events={[...summary.agents, ...summary.handoffs]} />
          </TraceSection>

          <TraceSection title="Skills">
            <div className="trace-chip-row">
              {summary.skills.map((skill) => (
                <span className="trace-chip" key={skill.id}>
                  {skill.name}
                  {skill.purpose ? ` · ${skill.purpose}` : ""}
                </span>
              ))}
              {!summary.skills.length && <span className="trace-muted">无</span>}
            </div>
            <EventList events={summary.skillEvents} />
          </TraceSection>

          <TraceSection title="Steps & Tools">
            <div className="trace-step-list">
              {summary.steps.map((step) => (
                <div className="trace-step-row" key={step.id}>
                  <span className={`trace-step-dot ${step.status}`}>
                    {step.status === "error" ? <CircleAlert size={11} /> : step.status === "success" ? <Check size={11} /> : <Loader2 size={11} />}
                  </span>
                  <strong>{step.label}</strong>
                  <small>
                    {[step.status, step.durationLabel].filter(Boolean).join(" · ")}
                  </small>
                </div>
              ))}
            </div>
            <EventList events={summary.toolEvents} />
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

          <TraceSection title="Canvas Operations">
            <EventList events={summary.canvasOperationEvents} />
          </TraceSection>

          <TraceSection title="Errors">
            <EventList events={summary.errorEvents} />
          </TraceSection>
        </div>
      )}
    </aside>
  );
}

export function ReplayBanner({ activeRunId, onExit }: { activeRunId: string | null; onExit: () => void }) {
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

function TraceState({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="trace-state">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function TraceSection({ children, title }: { children: ReactNode; title: string }) {
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

function EventList({ events }: { events: RunStepTraceEvent[] }) {
  return (
    <div className="trace-event-list">
      {events.map((event) => (
        <TraceEventRow event={event} key={event.id ?? `${event.type}-${event.createdAt}`} />
      ))}
      {!events.length && <span className="trace-muted">无</span>}
    </div>
  );
}

function TraceEventRow({ event }: { event: RunStepTraceEvent }) {
  const summary = summarizeTraceEvent(event);
  return (
    <div className="trace-event-row">
      <div>
        <strong>{getEventLabel(event)}</strong>
        <span>{event.stepId}</span>
      </div>
      <small title={summarizeUnknown(event.payload)}>{summary}</small>
    </div>
  );
}

function ContextSummaryView({
  context,
}: {
  context: ReturnType<typeof summarizeRunTrace>["context"];
}) {
  return (
    <div className="trace-event-list">
      <ContextRow
        label="Selected"
        value={
          context.selectedNodes.length
            ? context.selectedNodes.map(formatContextNode).join(" -> ")
            : "无"
        }
      />
      <ContextRow
        label="References"
        value={
          context.referenceNodes.length
            ? context.referenceNodes.map(formatContextNode).join(" -> ")
            : "无"
        }
      />
      <ContextRow
        label="Upstream path"
        value={
          context.upstreamPath.length
            ? context.upstreamPath
                .map((item) =>
                  [item.type, item.title ?? item.summary ?? shortId(item.nodeId)]
                    .filter(Boolean)
                    .join(": ")
                )
                .join(" -> ")
            : "无"
        }
      />
      <ContextRow
        label="Omitted"
        value={
          context.omittedNodes.length
            ? context.omittedNodes
                .map((node) => `${formatContextNode(node)} · ${node.reason}`)
                .join(" -> ")
            : "无"
        }
      />
    </div>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="trace-event-row">
      <div>
        <strong>{label}</strong>
      </div>
      <small title={value}>{value}</small>
    </div>
  );
}

function formatContextNode(node: { id: string; kind: string; label?: string }) {
  return `${node.kind}: ${node.label ? truncateLabel(node.label) : shortId(node.id)}`;
}

function truncateLabel(value: string) {
  return value.length > 48 ? `${value.slice(0, 45)}...` : value;
}
