import { CheckmarkIcon as Check, AlertCircleIcon as CircleAlert, BulletListTreeIcon as ListTree, ArrowCounterclockwiseIcon as RotateCcw, CancelIcon as X } from "@proicons/react";
import { useMemo, type ReactNode } from "react";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import type { RunStepTraceEvent } from "@/lib/graph-projection";
import { cn } from "@/lib/utils";
import {
  getEventLabel,
  shortId,
  summarizeRunTrace,
  summarizeTraceEvent,
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

type AgentRunDebugPanelProps = {
  events: RunStepTraceEvent[];
  open: boolean;
  runNodeId: string | null;
  onClose: () => void;
};

const TRACE_PANEL_BASE_CLASS =
  "absolute right-5 top-[66px] grid max-h-[calc(100vh-154px)] grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden rounded-[22px] border border-cuc-border-muted bg-white/[0.97] p-3.5 shadow-[0_10px_30px_rgb(0_0_0_/_6%)] max-[760px]:bottom-[86px] max-[760px]:right-3 max-[760px]:top-auto max-[760px]:max-h-[min(540px,calc(100vh-128px))] max-[760px]:w-[calc(100vw-24px)]";
const TRACE_HEADER_CLASS =
  "flex items-center justify-between gap-3";
const TRACE_HEADER_TITLE_CLASS =
  "grid min-w-0 gap-0.5";
const TRACE_HEADER_STRONG_CLASS =
  "text-sm font-semibold leading-[18px] text-cuc-text";
const TRACE_HEADER_SUBTITLE_CLASS =
  "overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-[14px] text-cuc-text-muted";
const TRACE_ACTIONS_CLASS =
  "flex gap-1.5";
const TRACE_ACTION_BUTTON_CLASS =
  "grid size-cuc-toolbar-button cursor-pointer place-items-center rounded-cuc-round border border-cuc-border-muted bg-cuc-surface text-cuc-text-secondary hover:bg-cuc-surface-warm hover:text-cuc-text disabled:cursor-default disabled:opacity-[0.42]";
const TRACE_STATE_CLASS =
  "flex items-center justify-center gap-[7px] rounded-cuc-floating border border-dashed border-cuc-border-dashed p-3 text-xs leading-4 text-cuc-text-subtle";
const TRACE_ERROR_CLASS =
  "flex items-center gap-[7px] rounded-cuc-floating border border-cuc-danger-border bg-cuc-danger-surface p-3 text-xs leading-4 text-cuc-danger-strong";
const TRACE_SECTIONS_CLASS =
  "grid content-start gap-2.5 overflow-auto pr-0.5";
const TRACE_SECTION_CLASS =
  "grid gap-2 rounded-cuc-floating border border-cuc-border-muted bg-cuc-surface p-3";
const TRACE_SECTION_TITLE_CLASS =
  "m-0 text-xs font-semibold leading-[15px] text-cuc-text";
const REPLAY_BANNER_CLASS =
  "absolute left-1/2 top-[62px] z-[28] flex h-[34px] -translate-x-1/2 items-center gap-2 rounded-cuc-pill border border-black/30 bg-white/[0.96] py-0 pl-3 pr-[7px] text-xs text-cuc-ink shadow-[0_8px_24px_rgb(0_0_0_/_5%)] max-[760px]:top-[61px] max-[760px]:max-w-[calc(100vw-24px)]";
const TRACE_LIST_CLASS = "grid gap-[7px]";
const TRACE_MUTED_CLASS = "text-[10px] leading-[13px] text-cuc-text-muted";
const TRACE_CHIP_ROW_CLASS = "flex flex-wrap gap-1.5";
const TRACE_CHIP_CLASS =
  "max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-cuc-pill bg-cuc-surface-warm px-2 py-1 text-[10px] leading-[13px] text-cuc-ink";
const TRACE_STEP_ROW_CLASS =
  "grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-[7px] text-[11px] text-cuc-text-secondary";
const TRACE_STEP_DOT_CLASS = "grid size-[18px] place-items-center text-cuc-ink";
const TRACE_STEP_TITLE_CLASS =
  "overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium text-cuc-text";
const TRACE_ROW_CLASS = "grid min-w-0 gap-1";
const TRACE_ROW_HEADER_CLASS = "grid grid-cols-[minmax(0,1fr)_auto] gap-2";
const TRACE_ROW_TITLE_CLASS =
  "overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium text-cuc-text";
const TRACE_ROW_VALUE_CLASS =
  "overflow-hidden text-[11px] font-normal leading-[14px] text-cuc-text-secondary [overflow-wrap:anywhere]";
const TRACE_DEBUG_LIST_CLASS = "grid gap-2";
const TRACE_DEBUG_CARD_CLASS =
  "grid min-w-0 gap-1.5 rounded-cuc-control border border-cuc-border-soft bg-cuc-surface-subtle p-[9px]";
const TRACE_DEBUG_OUTPUT_CARD_CLASS =
  "border-cuc-primary-border bg-cuc-primary-surface";
const TRACE_DEBUG_HEADER_CLASS = "grid grid-cols-[minmax(0,1fr)_auto] gap-2";
const TRACE_DEBUG_TITLE_CLASS =
  "overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold leading-[14px] text-cuc-text";
const TRACE_DEBUG_PRE_CLASS =
  "m-0 max-h-[260px] overflow-auto whitespace-pre-wrap text-[10px] leading-[14px] text-cuc-text-secondary [overflow-wrap:anywhere]";

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
    <aside className={cn(TRACE_PANEL_BASE_CLASS, "z-[26] w-[min(390px,calc(100vw-40px))]")} aria-label="Run Trace">
      <header className={TRACE_HEADER_CLASS}>
        <div className={TRACE_HEADER_TITLE_CLASS}>
          <strong className={TRACE_HEADER_STRONG_CLASS}>Run Trace</strong>
          <span className={TRACE_HEADER_SUBTITLE_CLASS}>{runNodeId ? shortId(runNodeId) : "未选择 Run"}</span>
        </div>
        <div className={TRACE_ACTIONS_CLASS}>
          {replayActive ? (
            <button className={TRACE_ACTION_BUTTON_CLASS} aria-label="退出回放" onClick={onExitReplay} title="退出回放" type="button">
              <X size={14} />
            </button>
          ) : (
            <button className={TRACE_ACTION_BUTTON_CLASS} aria-label="回放到只读画布" disabled={!events.length || loading} onClick={onReplay} title="回放" type="button">
              <RotateCcw size={14} />
            </button>
          )}
          <button className={TRACE_ACTION_BUTTON_CLASS} aria-label="关闭 Trace 面板" onClick={onClose} title="关闭" type="button">
            <X size={14} />
          </button>
        </div>
      </header>

      {loading && <TraceState icon={<LoadingIndicator ariaLabel="读取 trace 中" size={15} />} label="读取 trace" />}
      {error && (
        <div className={TRACE_ERROR_CLASS}>
          <CircleAlert size={14} />
          <span>{error}</span>
        </div>
      )}
      {!loading && !error && !events.length && (
        <TraceState icon={<ListTree size={15} />} label="暂无事件" />
      )}

      {!loading && !error && events.length > 0 && (
        <div className={TRACE_SECTIONS_CLASS}>
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

          <TraceSection title="Agent Messages">
            <EventList events={summary.agentMessageEvents} />
          </TraceSection>

          <TraceSection title="Skills">
            <div className={TRACE_CHIP_ROW_CLASS}>
              {summary.skills.map((skill) => (
                <span className={TRACE_CHIP_CLASS} key={skill.id}>
                  {skill.name}
                  {skill.purpose ? ` · ${skill.purpose}` : ""}
                </span>
              ))}
              {!summary.skills.length && <span className={TRACE_MUTED_CLASS}>无</span>}
            </div>
            <EventList events={summary.skillEvents} />
          </TraceSection>

          <TraceSection title="Steps & Tools">
            <div className={TRACE_LIST_CLASS}>
              {summary.steps.map((step) => (
                <div className={TRACE_STEP_ROW_CLASS} key={step.id}>
                  <span
                    className={cn(
                      TRACE_STEP_DOT_CLASS,
                      step.status === "success" && "text-cuc-success-strong",
                      step.status === "error" && "text-cuc-danger-strong"
                    )}
                  >
                    {step.status === "error" ? <CircleAlert size={11} /> : step.status === "success" ? <Check size={11} /> : <LoadingIndicator ariaLabel="执行中" size={11} />}
                  </span>
                  <strong className={TRACE_STEP_TITLE_CLASS}>{step.label}</strong>
                  <small className={TRACE_MUTED_CLASS}>
                    {[step.status, step.durationLabel].filter(Boolean).join(" · ")}
                  </small>
                </div>
              ))}
            </div>
            <EventList events={summary.toolEvents} />
          </TraceSection>

          <TraceSection title="Artifacts">
            <div className={TRACE_CHIP_ROW_CLASS}>
              {summary.artifacts.map((artifact) => (
                <span className={TRACE_CHIP_CLASS} key={artifact.id}>
                  {artifact.title ?? artifact.id} · {artifact.type}
                </span>
              ))}
              {!summary.artifacts.length && <span className={TRACE_MUTED_CLASS}>无</span>}
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

export function AgentRunDebugPanel({
  events,
  open,
  runNodeId,
  onClose,
}: AgentRunDebugPanelProps) {
  const outputEvents = useMemo(
    () => events.filter(isDebugOutputEvent),
    [events]
  );
  if (!open) {
    return null;
  }

  return (
    <aside className={cn(TRACE_PANEL_BASE_CLASS, "z-[25] w-[min(460px,calc(100vw-40px))]")} aria-label="Agent Run 检查">
      <header className={TRACE_HEADER_CLASS}>
        <div className={TRACE_HEADER_TITLE_CLASS}>
          <strong className={TRACE_HEADER_STRONG_CLASS}>Agent Run 检查</strong>
          <span className={TRACE_HEADER_SUBTITLE_CLASS}>
            {runNodeId ? shortId(runNodeId) : "等待运行"} · {events.length} events
          </span>
        </div>
        <div className={TRACE_ACTIONS_CLASS}>
          <button className={TRACE_ACTION_BUTTON_CLASS} aria-label="关闭 Agent Run 检查" onClick={onClose} title="关闭" type="button">
            <X size={14} />
          </button>
        </div>
      </header>

      {!events.length ? (
        <TraceState icon={<ListTree size={15} />} label="等待 Agent Run 事件" />
      ) : (
        <div className={TRACE_SECTIONS_CLASS}>
          <TraceSection title="Outputs">
            <div className={TRACE_DEBUG_LIST_CLASS}>
              {outputEvents.map((event) => (
                <DebugOutputEvent event={event} key={getDebugEventKey(event)} />
              ))}
              {!outputEvents.length && <span className={TRACE_MUTED_CLASS}>暂无输出</span>}
            </div>
          </TraceSection>

          <TraceSection title="All Events">
            <div className={TRACE_DEBUG_LIST_CLASS}>
              {events.map((event, index) => (
                <DebugRawEvent
                  event={event}
                  index={index}
                  key={getDebugEventKey(event)}
                />
              ))}
            </div>
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
    <div className={REPLAY_BANNER_CLASS}>
      <ListTree size={14} />
      <span>只读回放 · {shortId(activeRunId)}</span>
      <button className={cn(TRACE_ACTION_BUTTON_CLASS, "size-cuc-icon-button")} aria-label="退出回放" onClick={onExit} title="退出回放" type="button">
        <X size={13} />
      </button>
    </div>
  );
}

function DebugOutputEvent({ event }: { event: RunStepTraceEvent }) {
  const text = getDebugOutputText(event);
  return (
    <article className={cn(TRACE_DEBUG_CARD_CLASS, TRACE_DEBUG_OUTPUT_CARD_CLASS)}>
      <div className={TRACE_DEBUG_HEADER_CLASS}>
        <strong className={TRACE_DEBUG_TITLE_CLASS}>{getEventLabel(event)}</strong>
        <span className={TRACE_MUTED_CLASS}>{formatDebugEventTime(event.createdAt)}</span>
      </div>
      <pre className={TRACE_DEBUG_PRE_CLASS}>{text}</pre>
    </article>
  );
}

function DebugRawEvent({
  event,
  index,
}: {
  event: RunStepTraceEvent;
  index: number;
}) {
  return (
    <article className={TRACE_DEBUG_CARD_CLASS}>
      <div className={TRACE_DEBUG_HEADER_CLASS}>
        <strong className={TRACE_DEBUG_TITLE_CLASS}>
          {index + 1}. {getEventLabel(event)}
        </strong>
        <span className={TRACE_MUTED_CLASS}>{[event.stepId, formatDebugEventTime(event.createdAt)].filter(Boolean).join(" · ")}</span>
      </div>
      <small className={TRACE_MUTED_CLASS}>{summarizeTraceEvent(event)}</small>
      <pre className={TRACE_DEBUG_PRE_CLASS}>{stringifyDebugEvent(event)}</pre>
    </article>
  );
}

function isDebugOutputEvent(event: RunStepTraceEvent) {
  return (
    event.type === "agent.message.delta" ||
    event.type === "agent.message.completed" ||
    event.type === "tool.output" ||
    event.type === "tool.error" ||
    event.type === "artifact.created" ||
    event.type === "canvas.operation.applied" ||
    event.type === "run.completed" ||
    event.type === "run.failed"
  );
}

function getDebugOutputText(event: RunStepTraceEvent) {
  const payloadText =
    readDebugString(event.payload.content) ??
    readDebugString(event.payload.delta) ??
    readDebugString(event.payload.finalOutput) ??
    event.errorText;
  if (payloadText) {
    return payloadText;
  }
  return JSON.stringify(event.payload, null, 2);
}

function stringifyDebugEvent(event: RunStepTraceEvent) {
  return JSON.stringify(event, null, 2);
}

function readDebugString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatDebugEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getDebugEventKey(event: RunStepTraceEvent) {
  return (
    event.id ??
    `${event.projectId}:${event.runNodeId}:${event.stepId}:${event.type}:${event.createdAt}`
  );
}

function TraceState({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className={TRACE_STATE_CLASS}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function TraceSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className={TRACE_SECTION_CLASS}>
      <h3 className={TRACE_SECTION_TITLE_CLASS}>{title}</h3>
      {children}
    </section>
  );
}

function TraceKeyValue({ label, value }: { label: string; value?: string }) {
  return (
    <div className={TRACE_ROW_CLASS}>
      <span className={TRACE_MUTED_CLASS}>{label}</span>
      <strong className={TRACE_ROW_VALUE_CLASS} title={value}>{value || "无"}</strong>
    </div>
  );
}

function EventList({ events }: { events: RunStepTraceEvent[] }) {
  return (
    <div className={TRACE_LIST_CLASS}>
      {events.map((event) => (
        <TraceEventRow event={event} key={event.id ?? `${event.type}-${event.createdAt}`} />
      ))}
      {!events.length && <span className={TRACE_MUTED_CLASS}>无</span>}
    </div>
  );
}

function TraceEventRow({ event }: { event: RunStepTraceEvent }) {
  const summary = summarizeTraceEvent(event);
  return (
    <div className={TRACE_ROW_CLASS}>
      <div className={TRACE_ROW_HEADER_CLASS}>
        <strong className={TRACE_ROW_TITLE_CLASS}>{getEventLabel(event)}</strong>
        <span className={TRACE_MUTED_CLASS}>{event.stepId}</span>
      </div>
      <small className={TRACE_ROW_VALUE_CLASS} title={summary}>{summary}</small>
    </div>
  );
}

function ContextSummaryView({
  context,
}: {
  context: ReturnType<typeof summarizeRunTrace>["context"];
}) {
  return (
    <div className={TRACE_LIST_CLASS}>
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
    <div className={TRACE_ROW_CLASS}>
      <div className={TRACE_ROW_HEADER_CLASS}>
        <strong className={TRACE_ROW_TITLE_CLASS}>{label}</strong>
      </div>
      <small className={TRACE_ROW_VALUE_CLASS} title={value}>{value}</small>
    </div>
  );
}

function formatContextNode(node: { id: string; kind: string; label?: string }) {
  return `${node.kind}: ${node.label ? truncateLabel(node.label) : shortId(node.id)}`;
}

function truncateLabel(value: string) {
  return value.length > 48 ? `${value.slice(0, 45)}...` : value;
}
