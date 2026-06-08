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
import {
  getEventLabel,
  shortId,
  summarizeRunTrace,
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
          <TraceSection title="Run Snapshot">
            <TraceKeyValue label="Status" value={summary.runStatus} />
            <TraceKeyValue label="Prompt" value={summary.prompt} />
            <TraceKeyValue label="Events" value={String(events.length)} />
          </TraceSection>

          <TraceSection title="Intent">
            <TraceKeyValue label="Primary" value={summary.intent.primaryIntent} />
            <TraceKeyValue label="Task" value={summary.intent.taskKind} />
            <TraceKeyValue label="Reason" value={summary.intent.routingReason} />
            <div className="trace-chip-row">
              {summary.intent.requiredTools.map((toolId) => (
                <span className="trace-chip" key={toolId}>
                  {toolId}
                </span>
              ))}
              {!summary.intent.requiredTools.length && (
                <span className="trace-muted">无</span>
              )}
            </div>
          </TraceSection>

          <TraceSection title="Context">
            <TraceKeyValue
              label="Selected"
              value={summary.context.selectedCount}
            />
            <TraceKeyValue label="Omitted" value={summary.context.omittedCount} />
            <TraceKeyValue label="Budget" value={summary.context.budget} />
            <TraceKeyValue label="Tools" value={summary.context.availableTools} />
            <TraceKeyValue
              label="Tool Reason"
              value={summary.context.toolExposureReason}
            />
            <TraceKeyValue
              label="Skill Reason"
              value={summary.context.skillInjectionReason}
            />
            <TraceKeyValue
              label="Selected Detail"
              value={summary.context.selectedReasons}
            />
            <TraceKeyValue
              label="Omitted Detail"
              value={summary.context.omittedReasons}
            />
          </TraceSection>

          <TraceSection title="Plan">
            <TraceKeyValue label="Steps" value={summary.plan.stepCount} />
            <TraceKeyValue label="Validation" value={summary.plan.validation} />
            <TraceKeyValue label="Raw" value={summary.plan.rawPlan} />
            <TraceKeyValue
              label="Normalized"
              value={summary.plan.normalizedPlan}
            />
            <TraceKeyValue
              label="Validation Detail"
              value={summary.plan.validationDetail}
            />
            <div className="trace-chip-row">
              {summary.plan.toolIds.map((toolId) => (
                <span className="trace-chip" key={toolId}>
                  {toolId}
                </span>
              ))}
              {!summary.plan.toolIds.length && (
                <span className="trace-muted">无</span>
              )}
            </div>
          </TraceSection>

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

          <TraceSection title="Retry">
            <div className="trace-event-list">
              {summary.retryEvents.map((event) => (
                <TraceEventRow event={event} key={event.id ?? event.createdAt} />
              ))}
              {!summary.retryEvents.length && <span className="trace-muted">无</span>}
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

          <TraceSection title="Canvas Operations">
            <div className="trace-event-list">
              {summary.canvasOperationEvents.map((event) => (
                <TraceEventRow event={event} key={event.id ?? event.createdAt} />
              ))}
              {!summary.canvasOperationEvents.length && (
                <span className="trace-muted">无</span>
              )}
            </div>
          </TraceSection>

          <TraceSection title="Evaluation">
            <TraceKeyValue label="Passed" value={summary.evaluation.passed} />
            <TraceKeyValue label="Issues" value={summary.evaluation.issues} />
            <TraceKeyValue
              label="Actions"
              value={summary.evaluation.recommendedActions}
            />
          </TraceSection>

          <TraceSection title="Errors">
            <div className="trace-event-list">
              {summary.errorEvents.map((event) => (
                <TraceEventRow event={event} key={event.id ?? event.createdAt} />
              ))}
              {!summary.errorEvents.length && <span className="trace-muted">无</span>}
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
