import type { Node as FlowNode, NodeProps } from "@xyflow/react";
import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  ListTree,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

import { Node, NodeContent } from "@/components/ai-elements/node";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import type {
  CanvasToolPart,
  RunNodeData,
  RunStepTimelineItem,
  RunSummaryItem,
} from "@/types/canvas";

export function RunNodeView({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<FlowNode<RunNodeData, "runNode">>) {
  const [expanded, setExpanded] = useState(true);
  const toolParts = data.toolParts?.length
    ? data.toolParts
    : data.toolPart
      ? [data.toolPart]
      : [];
  const latestToolPart = toolParts.at(-1) ?? toolParts[0];
  const title = getRunTitle(data.status, latestToolPart?.state);
  const toggleLabel = expanded ? "收起输出" : "展开输出";
  const summaryItems = data.summaryItems ?? [];
  const stepTimeline = getStepTimeline(data.stepTimeline, toolParts);
  const hasToolDetail =
    data.status !== "queued" ||
    toolParts.some((part) => part.state !== "input-streaming");
  const agentText = data.agentText?.trim() ?? "";
  const hasRunOutput = Boolean(agentText) || hasToolDetail;
  const isActiveRun = data.status === "queued" || data.status === "running";
  const nodeClassName = [
    "canvas-node",
    "run-card",
    data.status,
    isActiveRun ? "active" : "",
    selected ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const nodeStyle = getResizableNodeStyle(width, height, {
    expanded,
    hasRunOutput,
  });

  return (
    <Node
      className={nodeClassName}
      handles={{ source: true, target: true }}
      minHeight={36}
      minWidth={220}
      selected={selected}
      style={nodeStyle}
      data-resized={nodeStyle?.height ? "true" : undefined}
    >
      <NodeContent className="run-content">
        <div className="run-heading">
          <span className={`run-status-dot ${data.status}`}>
            <RunStatusIcon status={data.status} />
          </span>
          {isActiveRun ? (
            <Shimmer as="span" className="run-title" duration={1.8}>
              {title}
            </Shimmer>
          ) : (
            <span className="run-title">{title}</span>
          )}
          <button
            aria-label="查看 Run Trace"
            className="run-trace-button nodrag nopan"
            onClick={(event) => {
              event.stopPropagation();
              dispatchOpenTrace(id);
            }}
            title="查看 Trace"
            type="button"
          >
            <ListTree size={12} />
          </button>
          <button
            aria-expanded={expanded}
            aria-label={toggleLabel}
            className="run-toggle nodrag nopan"
            data-expanded={expanded}
            disabled={!hasRunOutput}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((current) => !current);
            }}
            title={toggleLabel}
            type="button"
          >
            <ChevronDown size={12} />
          </button>
        </div>
        {hasRunOutput && expanded && (
          <div
            className="run-stream copyable-region nodrag nopan"
            aria-label="Agent run stream"
          >
            <RunStreamGroup icon={<UserRound size={11} />} title="用户请求">
              <p className="run-user-prompt" title={data.prompt}>
                {data.prompt}
              </p>
            </RunStreamGroup>
            <RunStreamGroup icon={<Bot size={12} />} title="Agent 输出">
              {agentText ? (
                <MessageResponse className="agent-text-output">
                  {agentText}
                </MessageResponse>
              ) : (
                <Shimmer as="p" className="agent-text-output muted" duration={1.8}>
                  等待模型输出...
                </Shimmer>
              )}
            </RunStreamGroup>
            {(summaryItems.length > 0 || stepTimeline.length > 0) && (
              <RunStreamGroup icon={<ListTree size={11} />} title="Agent 运行">
                <PlanSummaryView items={summaryItems} />
                <StepTimelineView steps={stepTimeline} />
              </RunStreamGroup>
            )}
            {hasToolDetail &&
              toolParts.length > 0 && (
                <RunStreamGroup icon={<Wrench size={11} />} title="工具调用">
                  <div className="tool-call-stack">
                    {toolParts.map((part, index) => (
                      <ToolPartView
                        error={data.error}
                        key={`${part.type}-${part.toolCallId ?? index}`}
                        toolPart={part}
                      />
                    ))}
                  </div>
                </RunStreamGroup>
              )}
          </div>
        )}
      </NodeContent>
    </Node>
  );
}

function getResizableNodeStyle(
  width?: number,
  height?: number,
  options: { expanded: boolean; hasRunOutput: boolean } = {
    expanded: false,
    hasRunOutput: false,
  }
): CSSProperties | undefined {
  if (!width && !height) {
    return undefined;
  }

  const shouldReleaseCompactHeight =
    options.expanded && options.hasRunOutput && height !== undefined && height <= 48;

  return {
    height: shouldReleaseCompactHeight ? undefined : height,
    width,
  };
}

function RunStreamGroup({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="run-stream-group">
      <div className="run-stream-group-heading">
        <span>{icon}</span>
        <strong>{title}</strong>
      </div>
      <div className="run-stream-group-body">{children}</div>
    </section>
  );
}

export function PlanSummaryView({ items }: { items: RunSummaryItem[] }) {
  if (!items.length) {
    return null;
  }

  return (
    <div className="run-summary-list" aria-label="Run summary">
      {items.map((item) => (
        <div className={`run-summary-item ${item.kind}`} key={item.kind}>
          <span>{item.label}</span>
          <strong title={item.detail}>{item.detail}</strong>
        </div>
      ))}
    </div>
  );
}

export function StepTimelineView({ steps }: { steps: RunStepTimelineItem[] }) {
  if (!steps.length) {
    return null;
  }

  return (
    <div className="run-step-timeline" aria-label="Run step timeline">
      {steps.map((step) => (
        <span
          className={`run-step-chip ${step.status}`}
          key={step.id}
          title={step.errorText ?? step.label}
        >
          {step.label}
        </span>
      ))}
    </div>
  );
}

export function ToolPartView({
  error,
  toolPart,
}: {
  error?: string;
  toolPart: CanvasToolPart;
}) {
  const [open, setOpen] = useState(
    toolPart.state !== "output-available" || toolPart.type === "tool-generate_image"
  );
  const toolName = getToolName(toolPart);
  const errorText =
    toolPart.state === "output-error"
      ? toolPart.errorText ?? error
      : toolPart.errorText;

  return (
    <Tool className="nodrag nopan" open={open} onOpenChange={setOpen}>
      <ToolHeader state={toolPart.state} title={toolName} type={toolPart.type} />
      <ToolContent>
        {toolPart.input !== undefined && <ToolInput input={toolPart.input} />}
        <ToolOutput errorText={errorText} output={toolPart.output} />
      </ToolContent>
    </Tool>
  );
}

function RunStatusIcon({ status }: { status: RunNodeData["status"] }) {
  if (status === "success") {
    return <Check size={14} />;
  }
  if (status === "error") {
    return <CircleAlert size={14} />;
  }
  return <Sparkles size={14} />;
}

function getStepTimeline(
  timeline: RunNodeData["stepTimeline"],
  toolParts: CanvasToolPart[]
) {
  if (timeline?.length) {
    return timeline;
  }

  return toolParts.map((part, index) => ({
    id: `${part.type}-${index}`,
    label: getToolName(part),
    status:
      part.state === "output-error"
        ? ("error" as const)
        : part.state === "output-available"
          ? ("success" as const)
          : ("running" as const),
    toolName: getToolName(part),
    errorText: part.errorText,
  }));
}

function dispatchOpenTrace(runNodeId: string) {
  window.dispatchEvent(
    new CustomEvent("cucumber:open-run-trace", {
      detail: { runNodeId },
    })
  );
}

function getRunTitle(
  status: RunNodeData["status"],
  state?: CanvasToolPart["state"]
) {
  if (status === "error" || state === "output-error") {
    return "生成失败";
  }
  if (status === "success") {
    return "生成完成";
  }
  if (state === "input-available" || state === "output-available") {
    return "调用工具";
  }
  return "Thinking...";
}

function getToolName(toolPart: CanvasToolPart) {
  const names: Record<string, string> = {
    "tool-generate_image": "生成图片",
    "tool-propose_canvas_operations": "更新画布",
    "tool-runtime": "运行错误",
  };

  return names[toolPart.type] ?? toolPart.type.replace(/^tool-/, "");
}
