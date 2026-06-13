import type { Node as FlowNode, NodeProps, ResizeParams } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  ListTree,
  RotateCcw,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Node, NodeContent } from "@/components/ai-elements/node";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import type { CanvasToolPart, RunNodeData } from "@/types/canvas";

export function RunNodeView({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<FlowNode<RunNodeData, "runNode">>) {
  const [expanded, setExpanded] = useState(false);
  const [manualSize, setManualSize] = useState<ResizeParams | null>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const toolParts = useMemo(
    () =>
      data.toolParts?.length
        ? data.toolParts
        : data.toolPart
          ? [data.toolPart]
          : [],
    [data.toolPart, data.toolParts]
  );
  const latestToolPart = toolParts.at(-1) ?? toolParts[0];
  const title = getRunTitle(data.status, latestToolPart?.state);
  const toggleLabel = expanded ? "收起输出" : "展开输出";
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
  const contentSignature = useMemo(
    () =>
      JSON.stringify({
        agentText,
        expanded,
        status: data.status,
        toolParts: toolParts.map((part) => ({
          errorText: part.errorText,
          input: part.input,
          output: part.output,
          state: part.state,
          toolCallId: part.toolCallId,
          type: part.type,
        })),
      }),
    [agentText, data.status, expanded, toolParts]
  );
  const nodeStyle = getResizableNodeStyle(width, height, {
    expanded,
    hasRunOutput,
    manualSize,
  });

  useEffect(() => {
    updateNodeInternals(id);
  }, [contentSignature, id, updateNodeInternals]);

  useEffect(() => {
    const element = nodeRef.current;
    if (!element) {
      return;
    }

    let animationFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => updateNodeInternals(id));
    });

    resizeObserver.observe(element);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [id, updateNodeInternals]);

  return (
    <Node
      className={nodeClassName}
      handles={{ source: true, target: true }}
      minHeight={36}
      minWidth={220}
      onResize={(_, params) => setManualSize(params)}
      onResizeEnd={(_, params) => setManualSize(params)}
      ref={nodeRef}
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
          {data.status === "error" && (
            <button
              aria-label="重试 Agent Run"
              className="run-retry-button nodrag nopan"
              onClick={(event) => {
                event.stopPropagation();
                dispatchRetryRun(id);
              }}
              title="重试"
              type="button"
            >
              <RotateCcw size={12} />
            </button>
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
        {hasRunOutput && (
          <div
            className="run-stream copyable-region nodrag nopan nowheel"
            aria-label="Agent run stream"
            data-expanded={expanded}
          >
            <div className="run-agent-text-region nodrag nopan nowheel">
              {agentText ? (
                <MessageResponse className="agent-text-output">
                  {agentText}
                </MessageResponse>
              ) : (
                <Shimmer as="p" className="agent-text-output muted" duration={1.8}>
                  Thinking...
                </Shimmer>
              )}
            </div>
            {hasToolDetail &&
              toolParts.length > 0 && (
                <div className="tool-call-stack" aria-label="工具调用">
                  {toolParts.map((part, index) => (
                    <ToolPartView
                      error={data.error}
                      key={`${part.type}-${part.toolCallId ?? index}`}
                      toolPart={part}
                    />
                  ))}
                </div>
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
  options: {
    expanded: boolean;
    hasRunOutput: boolean;
    manualSize: ResizeParams | null;
  } = {
    expanded: false,
    hasRunOutput: false,
    manualSize: null,
  }
): CSSProperties | undefined {
  if (!width && !height && !options.manualSize) {
    return undefined;
  }

  return {
    height: options.manualSize?.height,
    width: options.manualSize?.width ?? width,
  };
}

export function ToolPartView({
  error,
  toolPart,
}: {
  error?: string;
  toolPart: CanvasToolPart;
}) {
  const [open, setOpen] = useState(false);
  const toolName = getToolName(toolPart);
  const errorText =
    toolPart.state === "output-error"
      ? toolPart.errorText ?? error
      : toolPart.errorText;
  const stateLabel = getToolStateLabel(toolPart.state);

  return (
    <div
      className={`tool-call-row ${toolPart.state === "output-error" ? "error" : ""}`}
      data-state={open ? "open" : "closed"}
    >
      <button
        aria-expanded={open}
        className="tool-call-main nodrag nopan"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        type="button"
      >
        <Wrench size={13} />
        <strong>{toolName}</strong>
        <span className={`tool-state ${toolPart.state}`}>{stateLabel}</span>
        <ChevronDown className="tool-call-chevron" size={13} />
      </button>
      {errorText && !open && (
        <span className="tool-call-error-snippet" title={errorText}>
          {errorText}
        </span>
      )}
      {open && (
        <div className="tool-call-content nodrag nopan nowheel">
          {toolPart.input !== undefined && (
            <ToolJsonBlock label="参数" value={toolPart.input} />
          )}
          {(toolPart.output !== undefined || errorText) && (
            <ToolJsonBlock
              error={Boolean(errorText)}
              label={errorText ? "错误" : "结果"}
              value={errorText ?? toolPart.output}
            />
          )}
        </div>
      )}
    </div>
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

function dispatchOpenTrace(runNodeId: string) {
  window.dispatchEvent(
    new CustomEvent("cucumber:open-run-trace", {
      detail: { runNodeId },
    })
  );
}

function dispatchRetryRun(runNodeId: string) {
  window.dispatchEvent(
    new CustomEvent("cucumber:retry-run", {
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
    return "DONE！😊";
  }
  if (state === "input-available" || state === "output-available") {
    return "调用工具";
  }
  return "Thinking...";
}

function getToolName(toolPart: CanvasToolPart) {
  const names: Record<string, string> = {
    "tool-expand_image_prompt": "扩写提示词",
    "tool-generate_image": "生成图片",
    "tool-activate_skill": "激活技能",
    "tool-propose_canvas_operations": "更新画布",
    "tool-run_skill_script": "运行技能脚本",
    "tool-runtime": "运行错误",
    "tool-upscale_image": "高清放大",
  };

  return names[toolPart.type] ?? toolPart.type.replace(/^tool-/, "");
}

function getToolStateLabel(state: CanvasToolPart["state"]) {
  const labels: Record<CanvasToolPart["state"], string> = {
    "input-streaming": "准备中",
    "input-available": "运行中",
    "output-available": "完成",
    "output-error": "失败",
  };

  return labels[state];
}

function ToolJsonBlock({
  error = false,
  label,
  value,
}: {
  error?: boolean;
  label: string;
  value: unknown;
}) {
  return (
    <div className={`tool-json-block ${error ? "error" : ""}`}>
      <span>{label}</span>
      <pre>{formatToolValue(value)}</pre>
    </div>
  );
}

function formatToolValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}
