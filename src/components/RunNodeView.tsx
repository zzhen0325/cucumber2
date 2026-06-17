import type { Node as FlowNode, NodeProps, ResizeParams } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import {
  CheckmarkIcon as Check,
  ChevronDownIcon as ChevronDown,
  AlertCircleIcon as CircleAlert,
  BulletListTreeIcon as ListTree,
  ArrowCounterclockwiseIcon as RotateCcw,
  SparkleIcon as Sparkles,
  WrenchIcon as Wrench,
} from "@proicons/react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Node, NodeContent } from "@/components/ai-elements/node";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { isSimpleRunOutput } from "@/lib/graph";
import type { CanvasToolPart, RunNodeData } from "@/types/canvas";

export function RunNodeView({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<FlowNode<RunNodeData, "runNode">>) {
  const isActiveRun = data.status === "queued" || data.status === "running";
  const simpleRunOutput = isSimpleRunOutput(data);
  const [expanded, setExpanded] = useState(
    () => isActiveRun || simpleRunOutput
  );
  const [manualSize, setManualSize] = useState<ResizeParams | null>(null);
  const previousStatus = useRef(data.status);
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
  const title = getRunTitle(data.status, latestToolPart?.state, data.currentStep);
  const headerSummary = getRunHeaderSummary(data.status, toolParts, data.currentStep);
  const hasToolDetail =
    data.status !== "queued" ||
    toolParts.some((part) => part.state !== "input-streaming");
  const agentText = data.agentText?.trim() ?? "";
  const hasPlan = Boolean(data.plan?.length);
  const hasRunOutput = isActiveRun || Boolean(agentText) || hasToolDetail || hasPlan;
  const pendingAgentText = getPendingAgentText(data.status, headerSummary);
  const toggleLabel = expanded ? "收起输出" : "展开输出";
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
        outputKind: data.outputKind,
        simpleRunOutput,
        status: data.status,
        currentStep: data.currentStep,
        plan: data.plan,
        toolParts: toolParts.map((part) => ({
          errorText: part.errorText,
          input: part.input,
          output: part.output,
          state: part.state,
          toolCallId: part.toolCallId,
          type: part.type,
        })),
      }),
    [
      agentText,
      data.currentStep,
      data.outputKind,
      data.plan,
      data.status,
      expanded,
      simpleRunOutput,
      toolParts,
    ]
  );
  const nodeStyle = getResizableNodeStyle(width, height, {
    expanded,
    hasRunOutput,
    manualSize,
  });

  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = data.status;
    const wasActiveRun = previous === "queued" || previous === "running";

    if (
      data.status === "success" &&
      previous !== "success" &&
      !simpleRunOutput
    ) {
      queueMicrotask(() => setExpanded(false));
      return;
    }

    if (isActiveRun && !wasActiveRun) {
      queueMicrotask(() => setExpanded(true));
    }
  }, [data.status, isActiveRun, simpleRunOutput]);

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
          <span className="run-heading-main">
            {isActiveRun ? (
              <Shimmer as="span" className="run-title" duration={1.8}>
                {title}
              </Shimmer>
            ) : (
              <span className="run-title">{title}</span>
            )}
            {headerSummary && (
              <span className="run-header-summary" title={headerSummary.fullLabel}>
                {/* {headerSummary.visibleLabel} */}
              </span>
            )}
          </span>
          <span className="run-heading-actions">
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
          </span>
        </div>
        {hasRunOutput && expanded && (
          <div
            className="run-stream copyable-region nodrag nopan nowheel"
            aria-label="Agent run stream"
            data-expanded="true"
          >
            <div className="run-agent-text-region nodrag nopan nowheel">
              {agentText ? (
                <MessageResponse className="agent-text-output">
                  {agentText}
                </MessageResponse>
              ) : (
                <Shimmer as="p" className="agent-text-output muted" duration={1.8}>
                  {pendingAgentText}
                </Shimmer>
              )}
            </div>
            {hasPlan && <RunPlanView plan={data.plan ?? []} />}
            {hasToolDetail &&
              toolParts.length > 0 && (
                <div className="tool-call-stack" aria-label="工具调用">
                  {toolParts.map((part, index) => (
                    <ToolPartView
                      error={data.error}
                      key={`${part.type}-${part.toolCallId ?? index}`}
                      runNodeId={id}
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
  runNodeId,
  toolPart,
}: {
  error?: string;
  runNodeId?: string;
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
        <span className="tool-call-error-line">
          <span className="tool-call-error-snippet" title={errorText}>
            {errorText}
          </span>
          {runNodeId && (
            <button
              aria-label={`从${toolName}重试`}
              className="tool-call-retry nodrag nopan"
              onClick={(event) => {
                event.stopPropagation();
                dispatchRetryRun(runNodeId, {
                  stepId: getToolStepId(toolPart),
                });
              }}
              title="从这里重试"
              type="button"
            >
              <RotateCcw size={11} />
            </button>
          )}
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

function RunPlanView({ plan }: { plan: NonNullable<RunNodeData["plan"]> }) {
  return (
    <div className="run-plan-list" aria-label="任务计划">
      {plan.map((item) => (
        <div className={`run-plan-item ${item.status}`} key={item.id}>
          <span className={`run-plan-dot ${item.status}`}>
            <RunStatusIcon status={item.status} />
          </span>
          <strong title={item.label}>{item.label}</strong>
        </div>
      ))}
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

function dispatchRetryRun(
  runNodeId: string,
  retryFrom?: { stepId?: string }
) {
  window.dispatchEvent(
    new CustomEvent("cucumber:retry-run", {
      detail: { runNodeId, retryFrom },
    })
  );
}

function getRunTitle(
  status: RunNodeData["status"],
  state?: CanvasToolPart["state"],
  currentStep?: RunNodeData["currentStep"]
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
  return currentStep?.label ?? (status === "queued" ? "等待服务响应" : "Agent 处理中");
}

function getPendingAgentText(
  status: RunNodeData["status"],
  headerSummary: { visibleLabel: string } | null
) {
  if (headerSummary?.visibleLabel) {
    return headerSummary.visibleLabel;
  }
  if (status === "queued") {
    return "等待服务响应";
  }
  if (status === "running") {
    return "等待模型输出";
  }
  if (status === "error") {
    return "运行失败，请查看错误详情。";
  }
  return "已完成，结果已写入画布。";
}

function getToolName(toolPart: CanvasToolPart) {
  const names: Record<string, string> = {
    "tool-expand_image_prompt": "扩写提示词",
    "tool-read_skill_resource": "读取技能资源",
    "tool-render_visual_style_prompt": "风格提示词",
    "tool-generate_image": "生成图片",
    "tool-activate_skill": "激活技能",
    "tool-propose_canvas_operations": "更新画布",
    "tool-run_skill_script": "运行技能脚本",
    "tool-runtime": "运行错误",
    "tool-upscale_image": "高清放大",
  };

  return names[toolPart.type] ?? toolPart.type.replace(/^tool-/, "");
}

function getToolStepId(toolPart: CanvasToolPart) {
  return toolPart.type.replace(/^tool-/, "");
}

function getRunHeaderSummary(
  status: RunNodeData["status"],
  toolParts: CanvasToolPart[],
  currentStep?: RunNodeData["currentStep"]
) {
  if (status === "success") {
    return null;
  }

  if (currentStep?.label) {
    return {
      fullLabel: currentStep.label,
      visibleLabel: currentStep.label,
    };
  }

  const currentToolPart =
    toolParts.findLast(
      (part) => part.state === "input-streaming" || part.state === "input-available"
    ) ??
    (status === "error"
      ? toolParts.findLast((part) => part.state === "output-error")
      : undefined) ??
    toolParts.at(-1);

  if (!currentToolPart) {
    return null;
  }

  const label = getToolHeaderLabel(currentToolPart);

  return {
    fullLabel: label,
    visibleLabel: label,
  };
}

function getToolHeaderLabel(toolPart: CanvasToolPart) {
  if (toolPart.type === "tool-activate_skill") {
    const skillName = readToolString(toolPart.output, "skillName")
      ?? readToolString(toolPart.input, "skillName");
    return skillName ? `激活技能：${skillName}` : getToolName(toolPart);
  }

  if (toolPart.type === "tool-run_skill_script") {
    return readToolString(toolPart.input, "scriptName") ?? getToolName(toolPart);
  }

  return getToolName(toolPart);
}

function readToolString(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "string" && nested.trim() ? nested : null;
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
