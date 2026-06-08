import type { Node as FlowNode, NodeProps } from "@xyflow/react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  ListTree,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { useState } from "react";

import { Node, NodeContent } from "@/components/ai-elements/node";
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
}: NodeProps<FlowNode<RunNodeData, "runNode">>) {
  const [expanded, setExpanded] = useState(true);
  const toolParts = data.toolParts?.length
    ? data.toolParts
    : [
        data.toolPart ?? {
          type: "tool-expand_prompt",
          state: "input-streaming",
          input: { prompt: data.prompt },
        } satisfies CanvasToolPart,
      ];
  const latestToolPart = toolParts.at(-1) ?? toolParts[0];
  const title = getRunTitle(data.status, latestToolPart.state, data.evaluation);
  const toggleLabel = expanded ? "收起输出" : "展开输出";
  const summaryItems = data.summaryItems ?? [];
  const stepTimeline = getStepTimeline(data.stepTimeline, toolParts);
  const hasToolDetail =
    data.status !== "queued" ||
    toolParts.some((part) => part.state !== "input-streaming");
  const agentText = data.agentText?.trim() ?? "";
  const hasRunOutput = Boolean(agentText) || hasToolDetail;

  return (
    <Node
      className={selected ? "canvas-node selected run-card" : "canvas-node run-card"}
      handles={{ source: true, target: true }}
    >
      <NodeContent className="run-content">
        <div className="run-heading">
          <span className={`run-status-dot ${data.status}`}>
            <RunStatusIcon status={data.status} />
          </span>
          <span className="run-title">{title}</span>
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
          <div className="run-stream">
            {agentText && (
              <p className="agent-text-output" title={agentText}>
                {agentText}
              </p>
            )}
            <PlanSummaryView items={summaryItems} />
            <StepTimelineView steps={stepTimeline} />
            {data.evaluation && (
              <RunEvaluationView evaluation={data.evaluation} runNodeId={id} />
            )}
            {hasToolDetail &&
              toolParts.map((part, index) => (
                <ToolPartView
                  error={data.error}
                  key={`${part.type}-${index}`}
                  toolPart={part}
                />
              ))}
          </div>
        )}
      </NodeContent>
    </Node>
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
  const toolName = getToolName(toolPart);
  const stateLabel = getToolStateLabel(toolPart.state);
  const detailLines = getToolDetailLines(toolPart, error);
  const isError = toolPart.state === "output-error";
  const approvalId =
    toolPart.state === "approval-requested" ? toolPart.approval?.id : undefined;

  return (
    <div className={isError ? "tool-call-row error" : "tool-call-row"}>
      <div className="tool-call-main">
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
      </div>
      <div className="tool-call-detail">
        {detailLines.map((line) => (
          <small className="tool-detail-line" key={line} title={line}>
            {line}
          </small>
        ))}
      </div>
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
  state: CanvasToolPart["state"],
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
  const names: Record<CanvasToolPart["type"], string> = {
    "tool-analyze_reference_images": "参考图分析",
    "tool-expand_prompt": "提示词扩写",
    "tool-generate_image": "生成图片",
  };

  return names[toolPart.type];
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
    return [error ?? toolPart.errorText ?? "工具调用失败"];
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
    const output = toolPart.output as { expandedPrompt?: unknown };
    if (typeof output?.expandedPrompt === "string" && output.expandedPrompt.trim()) {
      return [`扩写: ${output.expandedPrompt.trim()}`];
    }

    return ["扩写完成"];
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
    imageCount?: unknown;
    modelProvider?: unknown;
    skillSlug?: unknown;
    resultCount?: unknown;
    upstreamContext?: unknown;
  };
  const lines: string[] = [];

  if (typeof candidate.prompt === "string" && candidate.prompt.trim()) {
    lines.push(`输入: ${candidate.prompt.trim()}`);
  }
  if (typeof candidate.modelProvider === "string" && candidate.modelProvider.trim()) {
    lines.push(`模型: ${candidate.modelProvider.trim()}`);
  }
  if (typeof candidate.skillSlug === "string" && candidate.skillSlug.trim()) {
    lines.push(`Skill: ${candidate.skillSlug.trim()}`);
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
