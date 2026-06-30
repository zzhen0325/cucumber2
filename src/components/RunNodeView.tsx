import type { Node as FlowNode, NodeProps, ResizeParams } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import {
  BrainIcon as Brain,
  CheckmarkIcon as Check,
  CheckmarkCircleIcon as CheckCircle,
  ChevronDownIcon as ChevronDown,
  AlertCircleIcon as CircleAlert,
  BulletListTreeIcon as ListTree,
  ArrowCounterclockwiseIcon as RotateCcw,
  SparkleIcon as Sparkles,
} from "@proicons/react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Node, NodeContent } from "@/components/ai-elements/node";
import {
  Task,
  TaskContent,
  TaskItem,
  TaskTrigger,
  type TaskItemStatus,
} from "@/components/ai-elements/task";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { MessageResponse } from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { isSimpleRunOutput } from "@/lib/graph";
import { cn } from "@/lib/utils";
import type {
  CanvasAgentMessage,
  CanvasToolPart,
  RunSummaryItem,
  RunNodeData,
} from "@/types/canvas";

const RUN_CARD_CLASS_NAME =
  "min-h-9 !border-cuc-run-border !bg-cuc-accent [--run-text:var(--color-cuc-run-text)] [--run-text-muted:var(--color-cuc-run-text-muted)]";
const RUN_CONTENT_CLASS_NAME =
  "run-content grid min-h-0 p-[14px] [grid-template-rows:auto_auto]";
const RUN_CONTENT_RESIZED_CLASS_NAME =
  "h-full [grid-template-rows:auto_minmax(0,1fr)]";
const RUN_HEADING_CLASS_NAME =
  "run-heading grid h-[34px] grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-1 px-2.5 text-[length:var(--canvas-node-title-size)] leading-[var(--canvas-node-title-line)] [color:var(--run-text)]";
const RUN_HEADING_MAIN_CLASS_NAME =
  "run-heading-main flex min-w-0 items-center gap-[5px]";
const RUN_TITLE_CLASS_NAME =
  "min-w-0 flex-[0_1_auto] overflow-hidden text-ellipsis whitespace-nowrap";
const RUN_TITLE_SHIMMER_CLASS_NAME =
  `${RUN_TITLE_CLASS_NAME} [--ai-shimmer-text:var(--run-text)]`;
const RUN_HEADER_SUMMARY_CLASS_NAME =
  "run-header-summary min-w-[34px] flex-[1_1_auto] overflow-hidden text-ellipsis whitespace-nowrap text-[length:var(--canvas-node-meta-size)] leading-[var(--canvas-node-meta-line)] [color:var(--run-text-muted)] before:mr-1.5 before:text-cuc-ink/42 before:content-['·']";
const RUN_HEADING_ACTIONS_CLASS_NAME =
  "run-heading-actions flex shrink-0 items-center gap-0.5";
const RUN_ICON_BUTTON_CLASS_NAME =
  "grid size-[18px] cursor-pointer place-items-center rounded-cuc-round border-0 bg-transparent [color:var(--run-text)] transition-[background-color,color,opacity] duration-[140ms] ease-[ease]";
const RUN_RETRY_BUTTON_CLASS_NAME =
  `${RUN_ICON_BUTTON_CLASS_NAME} run-retry-button nodrag nopan hover:bg-cuc-run-surface-muted hover:text-cuc-danger-strong`;
const RUN_TRACE_BUTTON_CLASS_NAME =
  `${RUN_ICON_BUTTON_CLASS_NAME} run-trace-button nodrag nopan hover:bg-cuc-run-surface-muted`;
const RUN_TOGGLE_BUTTON_CLASS_NAME =
  `${RUN_ICON_BUTTON_CLASS_NAME} run-toggle nodrag nopan hover:bg-cuc-run-surface-muted disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent data-[expanded=false]:[&_svg]:-rotate-90 [&_svg]:transition-transform [&_svg]:duration-[140ms] [&_svg]:ease-[ease]`;
const RUN_STATUS_DOT_CLASS_NAME =
  "run-status-dot grid size-[18px] place-items-center text-cuc-ink";
const RUN_STREAM_CLASS_NAME =
  "run-stream copyable-region nodrag nopan nowheel grid max-h-none min-h-0 gap-1.5 overscroll-contain px-2.5 pb-2.5 [scrollbar-width:thin]";
const RUN_STREAM_RESIZED_CLASS_NAME = "overflow-y-auto";
const RUN_STREAM_UNRESIZED_CLASS_NAME = "overflow-visible";
const RUN_CONVERSATION_FLOW_CLASS_NAME =
  "run-conversation-flow grid min-w-0 gap-[7px]";
const RUN_AGENT_TEXT_REGION_CLASS_NAME =
  "run-agent-text-region nodrag nopan nowheel min-w-0 max-h-none overflow-visible overscroll-contain [scrollbar-width:thin]";
const AGENT_TEXT_OUTPUT_CLASS_NAME =
  "agent-text-output block h-auto m-0 whitespace-pre-wrap text-[length:var(--canvas-node-body-size)] leading-[var(--canvas-node-body-line)] [color:var(--run-text)] [overflow-wrap:anywhere] [&_p]:m-0 [&_p+p]:mt-1";
const AGENT_TEXT_MUTED_CLASS_NAME =
  "[color:var(--run-text-muted)] [--ai-shimmer-text:var(--run-text-muted)]";
const AGENT_REASONING_CLASS_NAME =
  "agent-reasoning mt-1.5 grid min-w-0 gap-1";
const AGENT_MESSAGE_LIST_CLASS_NAME =
  "agent-message-list grid min-w-0 gap-1.5";
const RUN_FLOW_ENTRY_CLASS_NAME =
  "run-flow-entry agent-message grid min-w-0 grid-cols-[17px_minmax(0,1fr)] gap-[5px]";
const RUN_FLOW_MARKER_CLASS_NAME =
  "relative grid justify-items-center after:absolute after:bottom-[-7px] after:top-[15px] after:w-px after:bg-cuc-run-divider after:content-['']";
const RUN_FLOW_MARKER_LAST_CLASS_NAME = "after:hidden";
const RUN_FLOW_MARKER_ICON_CLASS_NAME =
  "z-[1] grid size-[15px] place-items-center rounded-cuc-round border border-cuc-run-marker-border bg-cuc-run-surface [color:var(--run-text)]";
const RUN_FLOW_BODY_CLASS_NAME = "run-flow-body grid min-w-0 gap-1";
const RUN_FLOW_HEADING_CLASS_NAME =
  "run-flow-heading flex min-w-0 items-center gap-1 text-[length:var(--canvas-node-meta-size)] leading-[var(--canvas-node-meta-line)] [color:var(--run-text-muted)]";
const RUN_FLOW_HEADING_NAME_CLASS_NAME =
  "overflow-hidden text-ellipsis whitespace-nowrap font-medium";
const RUN_FLOW_BADGE_CLASS_NAME = "shrink-0 text-cuc-success";
const AGENT_ACTIVITY_STACK_CLASS_NAME =
  "agent-activity-stack mt-1.5 grid min-w-0 gap-1";
const AGENT_TASK_STACK_CLASS_NAME = "agent-task-stack min-w-0";
const RUN_TOOL_LIST_CLASS_NAME = "run-tool-list grid min-w-0 gap-[5px]";
const TOOL_CALL_ERROR_LINE_CLASS_NAME =
  "tool-call-error-line grid grid-cols-[minmax(0,1fr)_auto] items-start gap-[5px]";
const TOOL_CALL_ERROR_SNIPPET_CLASS_NAME =
  "tool-call-error-snippet line-clamp-2 overflow-hidden text-[length:var(--canvas-node-meta-size)] leading-[var(--canvas-node-meta-line)] text-cuc-danger-deep [overflow-wrap:anywhere]";
const TOOL_CALL_RETRY_CLASS_NAME =
  "tool-call-retry nodrag nopan grid size-4 cursor-pointer place-items-center rounded-cuc-round border-0 bg-cuc-run-surface-muted text-cuc-danger-strong hover:bg-cuc-run-surface-hover";

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
  const agentMessages = useMemo(
    () => normalizeAgentMessages(data.agentMessages),
    [data.agentMessages]
  );
  const reasoningMessages = useMemo(
    () => agentMessages.filter((message) => message.kind === "progress"),
    [agentMessages]
  );
  const assistantMessages = useMemo(
    () => agentMessages.filter((message) => message.kind !== "progress"),
    [agentMessages]
  );
  const explicitAgentText = data.agentText?.trim();
  const agentMessagesText = formatAgentMessagesForText(assistantMessages);
  const agentText = explicitAgentText || agentMessagesText;
  const hasSeparateFinalOutput = Boolean(
    explicitAgentText && agentMessagesText && explicitAgentText !== agentMessagesText
  );
  const showAgentMessages =
    assistantMessages.length > 0 &&
    (!explicitAgentText || explicitAgentText === agentMessagesText);
  const hasReasoningMessages = reasoningMessages.length > 0;
  const summaryItems = useMemo(
    () => (data.summaryItems ?? []).filter((item) => item.kind !== "artifact"),
    [data.summaryItems]
  );
  const hasPlan = Boolean(data.plan?.length);
  const hasSummaryItems = Boolean(summaryItems.length);
  const hasToolParts = hasToolDetail && toolParts.length > 0;
  const showCurrentStepFallback =
    !hasSummaryItems && !hasPlan && !hasToolParts && Boolean(data.currentStep);
  const hasAgentActivity =
    hasSummaryItems || hasPlan || hasToolParts || showCurrentStepFallback;
  const hasRunOutput =
    isActiveRun ||
    Boolean(agentText) ||
    hasReasoningMessages ||
    hasToolDetail ||
    hasPlan ||
    hasSummaryItems ||
    Boolean(data.currentStep);
  const pendingAgentText = getPendingAgentText(data.status, headerSummary);
  const toggleLabel = expanded ? "收起输出" : "展开输出";
  const nodeClassName = cn(
    RUN_CARD_CLASS_NAME,
    data.status,
    isActiveRun && "active"
  );
  const contentSignature = useMemo(
    () =>
      JSON.stringify({
        agentText,
        expanded,
        outputKind: data.outputKind,
        simpleRunOutput,
        status: data.status,
        currentStep: data.currentStep,
        assistantMessages,
        reasoningMessages,
        plan: data.plan,
        summaryItems,
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
      assistantMessages,
      data.outputKind,
      data.plan,
      data.status,
      expanded,
      reasoningMessages,
      simpleRunOutput,
      summaryItems,
      toolParts,
    ]
  );
  const nodeStyle = getResizableNodeStyle(width, height, {
    expanded,
    hasRunOutput,
    manualSize,
  });
  const hasFixedHeight = Boolean(nodeStyle?.height);

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
      data-resized={hasFixedHeight ? "true" : undefined}
    >
      <NodeContent
        className={cn(
          RUN_CONTENT_CLASS_NAME,
          hasFixedHeight && RUN_CONTENT_RESIZED_CLASS_NAME
        )}
      >
        <div className={RUN_HEADING_CLASS_NAME}>
          <span
            className={cn(
              RUN_STATUS_DOT_CLASS_NAME,
              data.status,
              data.status === "success" && "text-cuc-success",
              data.status === "error" && "text-cuc-danger-strong"
            )}
          >
            <RunStatusIcon status={data.status} />
          </span>
          <span className={RUN_HEADING_MAIN_CLASS_NAME}>
            {isActiveRun ? (
              <Shimmer as="span" className={RUN_TITLE_SHIMMER_CLASS_NAME} duration={1.8}>
                {title}
              </Shimmer>
            ) : (
              <span className={RUN_TITLE_CLASS_NAME}>{title}</span>
            )}
            {headerSummary && (
              <span
                className={RUN_HEADER_SUMMARY_CLASS_NAME}
                title={headerSummary.fullLabel}
              >
                {/* {headerSummary.visibleLabel} */}
              </span>
            )}
          </span>
          <span className={RUN_HEADING_ACTIONS_CLASS_NAME}>
            {data.status === "error" && (
              <button
                aria-label="重试 Agent Run"
                className={RUN_RETRY_BUTTON_CLASS_NAME}
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
              className={RUN_TRACE_BUTTON_CLASS_NAME}
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
              className={RUN_TOGGLE_BUTTON_CLASS_NAME}
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
            className={cn(
              RUN_STREAM_CLASS_NAME,
              hasFixedHeight
                ? RUN_STREAM_RESIZED_CLASS_NAME
                : RUN_STREAM_UNRESIZED_CLASS_NAME
            )}
            aria-label="Agent run stream"
            data-expanded="true"
          >
            <div className={RUN_CONVERSATION_FLOW_CLASS_NAME}>
              <div className={RUN_AGENT_TEXT_REGION_CLASS_NAME}>
                {hasReasoningMessages && !agentText && (
                  <RunReasoningBlock
                    messages={reasoningMessages}
                    runStatus={data.status}
                  />
                )}
                {showAgentMessages ? (
                  <AgentMessageList messages={assistantMessages} />
                ) : agentText ? (
                  <MessageResponse className={AGENT_TEXT_OUTPUT_CLASS_NAME}>
                    {agentText}
                  </MessageResponse>
                ) : !hasReasoningMessages ? (
                  <Shimmer
                    as="p"
                    className={cn(
                      AGENT_TEXT_OUTPUT_CLASS_NAME,
                      AGENT_TEXT_MUTED_CLASS_NAME
                    )}
                    duration={1.8}
                  >
                    {pendingAgentText}
                  </Shimmer>
                ) : null}
                {hasReasoningMessages && agentText && (
                  <RunReasoningBlock
                    messages={reasoningMessages}
                    runStatus={data.status}
                  />
                )}
                {hasSeparateFinalOutput && (
                  <RunReasoningBlock
                    messages={assistantMessages}
                    runStatus={data.status}
                  />
                )}
                {hasAgentActivity && (
                  <RunActivityStack
                    currentStep={
                      showCurrentStepFallback ? data.currentStep : undefined
                    }
                    error={data.error}
                    plan={data.plan ?? []}
                    runNodeId={id}
                    runStatus={data.status}
                    summaryItems={summaryItems}
                    toolParts={hasToolParts ? toolParts : []}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </NodeContent>
    </Node>
  );
}

function RunReasoningBlock({
  messages,
  runStatus,
}: {
  messages: CanvasAgentMessage[];
  runStatus: RunNodeData["status"];
}) {
  const reasoningText = formatReasoningMessagesForText(messages);
  const isStreaming =
    runStatus === "running" &&
    messages.some((message) => message.status !== "completed");

  if (!reasoningText) {
    return null;
  }

  return (
    <Reasoning
      aria-label="Agent 推理"
      className={AGENT_REASONING_CLASS_NAME}
      defaultOpen={isStreaming}
      isStreaming={isStreaming}
      key={isStreaming ? "streaming" : "completed"}
    >
      <ReasoningTrigger className="nodrag nopan" type="button" />
      <ReasoningContent className="nodrag nopan nowheel">
        {reasoningText}
      </ReasoningContent>
    </Reasoning>
  );
}

function AgentMessageList({ messages }: { messages: CanvasAgentMessage[] }) {
  return (
    <div className={AGENT_MESSAGE_LIST_CLASS_NAME} aria-label="Agent 对话">
      {messages.map((message, index) => (
        <div className={RUN_FLOW_ENTRY_CLASS_NAME} key={message.id}>
          <div
            className={cn(
              RUN_FLOW_MARKER_CLASS_NAME,
              index === messages.length - 1 && RUN_FLOW_MARKER_LAST_CLASS_NAME
            )}
          >
            <span className={RUN_FLOW_MARKER_ICON_CLASS_NAME}>
              <Sparkles size={10} />
            </span>
          </div>
          <div className={RUN_FLOW_BODY_CLASS_NAME}>
            <div className={RUN_FLOW_HEADING_CLASS_NAME}>
              <strong
                className={RUN_FLOW_HEADING_NAME_CLASS_NAME}
                title={message.agentName ?? "Agent"}
              >
                {message.agentName ?? "Agent"}
              </strong>
              {getAgentMessageBadges(message).map((badge) => (
                <span className={RUN_FLOW_BADGE_CLASS_NAME} key={badge}>
                  {badge}
                </span>
              ))}
            </div>
            <MessageResponse className={AGENT_TEXT_OUTPUT_CLASS_NAME}>
              {message.content}
            </MessageResponse>
          </div>
        </div>
      ))}
    </div>
  );
}

function getAgentMessageBadges(message: CanvasAgentMessage) {
  const badges: string[] = [];
  if (message.kind === "progress") {
    badges.push(message.status === "streaming" ? "进展中" : "进展");
  } else if (message.status === "streaming") {
    badges.push("输出中");
  }
  return badges;
}

function normalizeAgentMessages(messages?: CanvasAgentMessage[]) {
  return (messages ?? []).flatMap((message) => {
    const content = message.content.trim();
    return content ? [{ ...message, content }] : [];
  });
}

function formatAgentMessagesForText(messages: CanvasAgentMessage[]) {
  return messages
    .filter((message) => message.kind !== "progress")
    .map((message) =>
      message.agentName
        ? `${message.agentName}\n${message.content}`
        : message.content
    )
    .join("\n\n")
    .trim();
}

function formatReasoningMessagesForText(messages: CanvasAgentMessage[]) {
  return messages
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
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
  const previewLine = errorText ?? getToolPreviewLine(toolPart);

  return (
    <Tool
      className={cn(
        toolPart.state === "output-error" &&
          "border-cuc-danger-border bg-cuc-danger-surface"
      )}
      onOpenChange={setOpen}
      open={open}
    >
      <ToolHeader
        aria-label={`${toolName}${stateLabel}`}
        className="nodrag nopan"
        description={previewLine}
        onClick={(event) => event.stopPropagation()}
        state={toolPart.state}
        stateLabel={stateLabel}
        title={toolName}
        toolType={toolPart.type}
      />
      {errorText && !open && (
        <span className={TOOL_CALL_ERROR_LINE_CLASS_NAME}>
          <span className={TOOL_CALL_ERROR_SNIPPET_CLASS_NAME} title={errorText}>
            {errorText}
          </span>
          {runNodeId && (
            <button
              aria-label={`从${toolName}重试`}
              className={TOOL_CALL_RETRY_CLASS_NAME}
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
        <ToolContent className="nodrag nopan nowheel">
          {toolPart.input !== undefined && <ToolInput input={toolPart.input} />}
          {(toolPart.output !== undefined || errorText) && (
            <ToolOutput errorText={errorText} output={toolPart.output} />
          )}
        </ToolContent>
      )}
    </Tool>
  );
}

function RunActivityStack({
  currentStep,
  error,
  plan,
  runNodeId,
  runStatus,
  summaryItems,
  toolParts,
}: {
  currentStep?: RunNodeData["currentStep"];
  error?: string;
  plan: NonNullable<RunNodeData["plan"]>;
  runNodeId: string;
  runStatus: RunNodeData["status"];
  summaryItems: RunSummaryItem[];
  toolParts: CanvasToolPart[];
}) {
  const completedPlanCount = plan.filter((item) => item.status === "success").length;
  const headerDetail = getActivityHeaderDetail({
    completedPlanCount,
    currentStep,
    planCount: plan.length,
    runStatus,
    toolParts,
  });
  const hasTaskItems = Boolean(summaryItems.length || plan.length || currentStep);
  const taskTitle = plan.length ? "执行计划" : "执行过程";

  return (
    <div aria-label="Agent 执行" className={AGENT_ACTIVITY_STACK_CLASS_NAME}>
      {hasTaskItems && (
        <Task
          className={AGENT_TASK_STACK_CLASS_NAME}
          defaultOpen={runStatus !== "success"}
          key={runStatus}
        >
          <TaskTrigger className="nodrag nopan" detail={headerDetail} title={taskTitle} />
          <TaskContent className="nodrag nopan nowheel">
            {summaryItems.map((item) => (
              <TaskItem
                description={item.label}
                icon={getSummaryIcon(item.kind)}
                key={`summary-${item.kind}-${item.label}-${item.detail ?? ""}`}
                status="completed"
                title={item.detail ?? item.label}
              />
            ))}
            {plan.map((item) => (
              <TaskItem
                description={getPlanStepDescription(item.status)}
                key={`plan-${item.id}`}
                status={mapRunStatusToTaskStatus(item.status)}
                title={item.label}
              />
            ))}
            {currentStep && (
              <TaskItem
                description={getPlanStepDescription(currentStep.status)}
                status={mapRunStatusToTaskStatus(currentStep.status)}
                title={currentStep.label}
              />
            )}
          </TaskContent>
        </Task>
      )}
      {toolParts.length > 0 && (
        <div aria-label="工具调用" className={RUN_TOOL_LIST_CLASS_NAME}>
          {toolParts.map((part, index) => (
            <ToolPartView
              error={error}
              key={`tool-${part.type}-${part.toolCallId ?? index}`}
              runNodeId={runNodeId}
              toolPart={part}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function getActivityHeaderDetail({
  completedPlanCount,
  currentStep,
  planCount,
  runStatus,
  toolParts,
}: {
  completedPlanCount: number;
  currentStep?: RunNodeData["currentStep"];
  planCount: number;
  runStatus: RunNodeData["status"];
  toolParts: CanvasToolPart[];
}) {
  if (planCount) {
    return `${completedPlanCount}/${planCount} 已完成`;
  }

  const failedTool = toolParts.find((part) => part.state === "output-error");
  if (failedTool || runStatus === "error") {
    return "失败";
  }

  const activeTool = toolParts.find(
    (part) =>
      part.state === "input-streaming" || part.state === "input-available"
  );
  if (activeTool) {
    return getToolStateLabel(activeTool.state);
  }

  if (currentStep?.label) {
    return currentStep.label;
  }

  return null;
}

function getSummaryIcon(kind: RunSummaryItem["kind"]) {
  const icons = {
    agent: Sparkles,
    artifact: CheckCircle,
    canvas: ListTree,
    handoff: ListTree,
    skill: Brain,
  };

  return icons[kind];
}

function getPlanStepDescription(status: RunNodeData["status"]) {
  const labels: Record<RunNodeData["status"], string> = {
    error: "失败",
    queued: "等待中",
    running: "进行中",
    success: "完成",
  };

  return labels[status];
}

function mapRunStatusToTaskStatus(
  status: RunNodeData["status"]
): TaskItemStatus {
  if (status === "success") {
    return "completed";
  }
  if (status === "error") {
    return "error";
  }
  if (status === "running") {
    return "in_progress";
  }
  return "pending";
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
    "tool-decompose_image": "拆解图片",
    "tool-read_skill_resource": "读取技能资源",
    "tool-render_visual_style_prompt": "风格提示词",
    "tool-generate_image": "生成图片",
    "tool-image_matting": "抠图",
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

function getToolPreviewLine(toolPart: CanvasToolPart) {
  const skillName =
    readToolString(toolPart.output, "skillName") ??
    readToolString(toolPart.input, "skillName");
  if (skillName) {
    return skillName;
  }

  const scriptName = readToolString(toolPart.input, "scriptName");
  if (scriptName) {
    return scriptName;
  }

  const prompt =
    readToolString(toolPart.input, "prompt") ??
    readToolString(toolPart.input, "sourcePrompt") ??
    readToolString(toolPart.output, "expandedPrompt");
  if (prompt) {
    return prompt;
  }

  const summary =
    readToolString(toolPart.output, "summary") ??
    readToolString(toolPart.output, "message");
  if (summary) {
    return summary;
  }

  const count =
    readToolNumber(toolPart.output, "generated") ??
    readToolNumber(toolPart.input, "resultCount");
  if (count !== null) {
    return `${count} 个结果`;
  }

  return null;
}

function readToolString(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "string" && nested.trim() ? nested : null;
}

function readToolNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "number" && Number.isFinite(nested) ? nested : null;
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
