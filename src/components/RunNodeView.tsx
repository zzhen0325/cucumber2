import type { Node as FlowNode, NodeProps } from "@xyflow/react";
import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  ListTree,
  Sparkles,
  UserRound,
  WandSparkles,
  Wrench,
  X,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

import { Node, NodeContent } from "@/components/ai-elements/node";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { extractImagesFromToolOutput } from "@/lib/graph";
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
  const title = getRunTitle(data.status, latestToolPart?.state, data.evaluation);
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
          <div className="run-stream" aria-label="Agent run stream">
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
              <RunStreamGroup icon={<ListTree size={11} />} title="运行计划">
                <PlanSummaryView items={summaryItems} />
                <StepTimelineView steps={stepTimeline} />
              </RunStreamGroup>
            )}
            {data.evaluation && (
              <RunStreamGroup icon={<Sparkles size={11} />} title="质量检查">
                <RunEvaluationView evaluation={data.evaluation} runNodeId={id} />
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
  const stateLabel = getToolStateLabel(toolPart.state);
  const detailLines = getToolDetailLines(toolPart, error);
  const isError = toolPart.state === "output-error";
  const approvalId =
    toolPart.state === "approval-requested" ? toolPart.approval?.id : undefined;
  const hasStructuredDetail =
    Boolean(toolPart.input) || Boolean(toolPart.output) || Boolean(toolPart.errorText);

  return (
    <Collapsible
      className={isError ? "tool-call-row error" : "tool-call-row"}
      open={open}
      onOpenChange={setOpen}
    >
      <CollapsibleTrigger asChild>
        <button className="tool-call-main nodrag nopan" type="button">
          <span className="tool-call-action">
            {toolPart.state === "output-available"
              ? "完成"
              : toolPart.state === "output-denied"
                ? "拒绝"
                : "调用"}
          </span>
          <strong title={toolName}>{toolName}</strong>
          <span className={`tool-state ${toolPart.state}`}>
            {getToolStateIcon(toolPart.state)}
            {stateLabel}
          </span>
          <ChevronDown className="tool-call-chevron" size={12} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="tool-call-content">
        <div className="tool-call-detail">
          {detailLines.map((line) => (
            <small className="tool-detail-line" key={line} title={line}>
              {line}
            </small>
          ))}
        </div>
        {hasStructuredDetail && (
          <div className="tool-io-grid">
            {toolPart.input !== undefined && (
              <ToolJsonBlock label="参数" value={toolPart.input} />
            )}
            {(toolPart.output !== undefined || toolPart.errorText) && (
              <ToolJsonBlock
                error={isError}
                label={isError ? "错误" : "结果"}
                value={toolPart.errorText ?? toolPart.output}
              />
            )}
          </div>
        )}
      </CollapsibleContent>
      {approvalId && (
        <div className="tool-approval-actions">
          <button
            className="nodrag nopan"
            onClick={(event) => {
              event.stopPropagation();
              dispatchToolApprovalResponse(approvalId, true);
            }}
            type="button"
          >
            <Check size={11} />
            确认
          </button>
          <button
            className="nodrag nopan secondary"
            onClick={(event) => {
              event.stopPropagation();
              dispatchToolApprovalResponse(approvalId, false);
            }}
            type="button"
          >
            <X size={11} />
            拒绝
          </button>
        </div>
      )}
    </Collapsible>
  );
}

function ToolJsonBlock({
  error,
  label,
  value,
}: {
  error?: boolean;
  label: string;
  value: unknown;
}) {
  return (
    <div className={error ? "tool-json-block error" : "tool-json-block"}>
      <span>{label}</span>
      <pre>{formatToolValue(value)}</pre>
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

function RunEvaluationView({
  evaluation,
  runNodeId,
}: {
  evaluation: NonNullable<RunNodeData["evaluation"]>;
  runNodeId: string;
}) {
  return (
    <div
      className={evaluation.passed ? "run-evaluation passed" : "run-evaluation failed"}
      title={getRunEvaluationTitle(evaluation)}
    >
      <span className="run-evaluation-label">
        {evaluation.passed
          ? "质量检查通过"
          : `质量检查发现 ${evaluation.issueCount} 个问题`}
      </span>
      {!evaluation.passed && evaluation.recommendedActions[0] && (
        <small>{evaluation.recommendedActions[0]}</small>
      )}
      {!evaluation.passed && (
        <button
          className="run-evaluation-action nodrag nopan"
          onClick={(event) => {
            event.stopPropagation();
            dispatchRunRevisionRequest(runNodeId);
          }}
          type="button"
        >
          <WandSparkles size={11} />
          {evaluation.needsRegeneration ? "准备重试" : "准备修正"}
        </button>
      )}
    </div>
  );
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
      part.state === "output-error" || part.state === "output-denied"
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

function dispatchToolApprovalResponse(approvalId: string, approved: boolean) {
  window.dispatchEvent(
    new CustomEvent("cucumber:respond-tool-approval", {
      detail: { approvalId, approved },
    })
  );
}

function dispatchRunRevisionRequest(runNodeId: string) {
  window.dispatchEvent(
    new CustomEvent("cucumber:prepare-run-revision", {
      detail: { runNodeId },
    })
  );
}

function getRunTitle(
  status: RunNodeData["status"],
  state?: CanvasToolPart["state"],
  evaluation?: RunNodeData["evaluation"]
) {
  if (evaluation && !evaluation.passed) {
    return "质量检查未通过";
  }
  if (status === "error" || state === "output-error") {
    return "生成失败";
  }
  if (status === "success") {
    return "生成完成";
  }
  if (state === "input-available" || state === "output-available") {
    return "调用工具";
  }
  if (state === "approval-requested") {
    return "等待确认";
  }
  if (state === "approval-responded") {
    return "继续执行";
  }
  return "Thinking...";
}

function getRunEvaluationTitle(evaluation: NonNullable<RunNodeData["evaluation"]>) {
  if (evaluation.passed) {
    return "Evaluator passed";
  }

  const action = evaluation.recommendedActions[0];
  return action
    ? `Evaluator found ${evaluation.issueCount} issue(s): ${action}`
    : `Evaluator found ${evaluation.issueCount} issue(s)`;
}

function getToolName(toolPart: CanvasToolPart) {
  const names: Record<string, string> = {
    "tool-analyze_reference_images": "参考图分析",
    "tool-asset_analyze_context": "素材分析",
    "tool-asset.analyze_context": "素材分析",
    "tool-expand_prompt": "提示词扩写",
    "tool-generate_html": "生成 HTML",
    "tool-generate_image": "生成图片",
    "tool-plan_agent_run": "规划运行",
    "tool-runtime": "运行错误",
    "tool-web_read": "读取网页",
    "tool-web.read": "读取网页",
    "tool-web_search": "搜索网页",
    "tool-write_document": "写文档",
  };

  return names[toolPart.type] ?? toolPart.type.replace(/^tool-/, "");
}

function getToolStateIcon(state: CanvasToolPart["state"]) {
  if (state === "output-available" || state === "approval-responded") {
    return <Check size={11} />;
  }
  if (state === "output-error" || state === "output-denied") {
    return <CircleAlert size={11} />;
  }
  return <Sparkles size={11} />;
}

function getToolStateLabel(state: CanvasToolPart["state"]) {
  const labels: Record<CanvasToolPart["state"], string> = {
    "approval-requested": "等待确认",
    "approval-responded": "已确认",
    "input-available": "运行中",
    "input-streaming": "准备参数",
    "output-available": "输出完成",
    "output-denied": "已拒绝",
    "output-error": "失败",
  };

  return labels[state];
}

function getToolDetailLines(toolPart: CanvasToolPart, error?: string) {
  if (toolPart.state === "output-error") {
    return [toolPart.errorText ?? error ?? "工具调用失败"];
  }
  if (toolPart.state === "output-available") {
    return [...getToolOutputLines(toolPart), ...getToolInputLines(toolPart.input)];
  }
  if (toolPart.state === "output-denied") {
    return ["工具调用被拒绝"];
  }
  if (toolPart.state === "approval-requested") {
    return ["需要确认后继续执行"];
  }
  if (toolPart.state === "approval-responded") {
    return [toolPart.approval?.approved === false ? "已拒绝执行" : "已确认执行"];
  }
  return getToolInputLines(toolPart.input);
}

function getToolOutputLines(toolPart: CanvasToolPart) {
  if (toolPart.type === "tool-analyze_reference_images") {
    const output = toolPart.output as {
      analysis?: unknown;
      imageCount?: unknown;
    };
    const lines = [
      typeof output?.imageCount === "number"
        ? `参考图: ${output.imageCount} 张`
        : "参考图分析完成",
    ];

    if (typeof output?.analysis === "string" && output.analysis.trim()) {
      lines.push(`视觉摘要: ${output.analysis.trim()}`);
    }

    return lines;
  }

  if (toolPart.type === "tool-expand_prompt") {
    const output = toolPart.output as {
      expandedPrompts?: unknown;
      promptBatchMode?: unknown;
    };
    if (Array.isArray(output?.expandedPrompts)) {
      const prompts = output.expandedPrompts.filter(
        (prompt): prompt is string =>
          typeof prompt === "string" && Boolean(prompt.trim())
      );
      if (prompts.length === 1) {
        return [`扩写: ${prompts[0].trim()}`];
      }
      if (prompts.length > 1) {
        return [`扩写: ${prompts.length} 条不同提示词`];
      }
    }

    return ["扩写完成"];
  }

  if (toolPart.type === "tool-write_document") {
    const output = toolPart.output as {
      markdown?: unknown;
      summary?: unknown;
      title?: unknown;
    };
    if (typeof output?.title === "string" && output.title.trim()) {
      return [`文档: ${output.title.trim()}`];
    }
    if (typeof output?.summary === "string" && output.summary.trim()) {
      return [`摘要: ${output.summary.trim()}`];
    }
    if (typeof output?.markdown === "string" && output.markdown.trim()) {
      return ["Markdown 文档已生成"];
    }

    return ["文档已生成"];
  }

  if (toolPart.type === "tool-generate_html") {
    const output = toolPart.output as {
      title?: unknown;
      html?: unknown;
      artifactId?: unknown;
      summary?: unknown;
    };
    if (typeof output?.title === "string" && output.title.trim()) {
      return [`HTML: ${output.title.trim()}`];
    }
    if (typeof output?.summary === "string" && output.summary.trim()) {
      return [`摘要: ${output.summary.trim()}`];
    }
    if (typeof output?.html === "string" && output.html.trim()) {
      return ["HTML 页面已生成"];
    }
    if (typeof output?.artifactId === "string" && output.artifactId.trim()) {
      return ["页面产物已生成"];
    }

    return ["页面已生成"];
  }

  if (toolPart.type === "tool-web.read") {
    const output = toolPart.output as { sources?: unknown };
    const sourceCount = Array.isArray(output?.sources)
      ? output.sources.length
      : undefined;
    return [
      typeof sourceCount === "number"
        ? `读取完成: ${sourceCount} 个网页`
        : "网页读取完成",
    ];
  }

  if (toolPart.type === "tool-asset.analyze_context") {
    const output = toolPart.output as {
      imageCount?: unknown;
      summary?: unknown;
    };
    if (typeof output?.imageCount === "number") {
      return [`素材分析: ${output.imageCount} 张图片`];
    }
    if (typeof output?.summary === "string" && output.summary.trim()) {
      return [`素材摘要: ${output.summary.trim()}`];
    }

    return ["素材分析完成"];
  }

  if (toolPart.type === "tool-web_search") {
    const output = toolPart.output as {
      answer?: unknown;
      sources?: unknown;
    };
    const sourceCount = Array.isArray(output?.sources)
      ? output.sources.length
      : undefined;
    if (typeof sourceCount === "number") {
      return [`搜索完成: ${sourceCount} 个来源`];
    }
    if (typeof output?.answer === "string" && output.answer.trim()) {
      return [`搜索摘要: ${output.answer.trim()}`];
    }

    return ["搜索完成"];
  }

  const images = extractImagesFromToolOutput(toolPart.output);
  return [images.length ? `输出 ${images.length} 张图片` : "输出已返回"];
}

function getToolInputLines(input: unknown) {
  if (!input || typeof input !== "object") {
    return ["等待工具参数"];
  }

  const candidate = input as {
    prompt?: unknown;
    brief?: unknown;
    title?: unknown;
    query?: unknown;
    imageCount?: unknown;
    modelProvider?: unknown;
    skillSlug?: unknown;
    prompts?: unknown;
    promptBatchMode?: unknown;
    resultCount?: unknown;
    upstreamContext?: unknown;
  };
  const lines: string[] = [];

  if (typeof candidate.prompt === "string" && candidate.prompt.trim()) {
    lines.push(`输入: ${candidate.prompt.trim()}`);
  }
  if (typeof candidate.brief === "string" && candidate.brief.trim()) {
    lines.push(`输入: ${candidate.brief.trim()}`);
  }
  if (typeof candidate.title === "string" && candidate.title.trim()) {
    lines.push(`标题: ${candidate.title.trim()}`);
  }
  if (typeof candidate.query === "string" && candidate.query.trim()) {
    lines.push(`查询: ${candidate.query.trim()}`);
  }
  if (typeof candidate.modelProvider === "string" && candidate.modelProvider.trim()) {
    lines.push(`模型: ${candidate.modelProvider.trim()}`);
  }
  if (typeof candidate.skillSlug === "string" && candidate.skillSlug.trim()) {
    lines.push(`Skill: ${candidate.skillSlug.trim()}`);
  }
  if (Array.isArray(candidate.prompts)) {
    lines.push(`提示词: ${candidate.prompts.length} 条`);
  }
  if (
    typeof candidate.promptBatchMode === "string" &&
    candidate.promptBatchMode.trim()
  ) {
    lines.push(
      candidate.promptBatchMode === "distinct_prompts"
        ? "模式: 多提示词"
        : "模式: 单提示词"
    );
  }
  if (
    typeof candidate.resultCount === "number" &&
    Number.isInteger(candidate.resultCount)
  ) {
    lines.push(`目标: ${candidate.resultCount} 张图片`);
  }
  if (
    typeof candidate.imageCount === "number" &&
    Number.isInteger(candidate.imageCount)
  ) {
    lines.push(`参考图: ${candidate.imageCount} 张`);
  }
  if (Array.isArray(candidate.upstreamContext)) {
    lines.push(`上游上下文: ${candidate.upstreamContext.length} 项`);
  }

  return lines.length ? lines : ["工具参数已就绪"];
}

function formatToolValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
