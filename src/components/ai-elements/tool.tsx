"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CanvasToolPart, CanvasToolState } from "@/types/canvas";
import {
  CheckmarkCircleIcon as CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  WrenchIcon,
  CancelCircleIcon as XCircleIcon,
} from "@proicons/react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { CodeBlock } from "./code-block";

const TOOL_IO_CLASS_NAME = "tool-card-io grid min-w-0 gap-[3px]";
const TOOL_IO_HEADING_CLASS_NAME =
  "m-0 text-[length:var(--canvas-node-meta-size)] font-medium leading-[var(--canvas-node-meta-line)] [color:var(--run-text-muted)]";
const TOOL_CODE_CLASS_NAME =
  "tool-card-code grid min-w-0 [&>div[data-language]]:rounded-canvas [&>div[data-language]]:border-0 [&>div[data-language]]:bg-surface-warm/72 [&>div[data-language]]:[color:var(--run-text)] [&_code]:text-[length:var(--canvas-node-meta-size)] [&_pre]:max-h-28 [&_pre]:overflow-auto [&_pre]:whitespace-pre-wrap [&_pre]:!bg-transparent [&_pre]:p-1.5 [&_pre]:text-[length:var(--canvas-node-body-size)] [&_pre]:!text-inherit [&_pre]:[overflow-wrap:break-word]";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn(
      "tool-card not-prose group grid w-full min-w-0 gap-[5px] rounded-card border border-subtle-border bg-surface px-1.5 py-[5px] text-[length:var(--canvas-node-body-size)] leading-[var(--canvas-node-body-line)] [color:var(--run-text)]",
      className
    )}
    {...props}
  />
);

export type ToolHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  description?: ReactNode;
  stateLabel?: string;
  title?: string;
  toolType: CanvasToolPart["type"];
  state: CanvasToolState;
};

const getStatusBadge = (status: CanvasToolState, stateLabel?: string) => {
  const labels: Record<CanvasToolState, string> = {
    "input-streaming": "准备中",
    "input-available": "运行中",
    "output-available": "完成",
    "output-error": "失败",
  };

  const icons: Record<CanvasToolState, ReactNode> = {
    "input-streaming": <CircleIcon className="size-4" />,
    "input-available": <LoadingIndicator ariaLabel="工具运行中" size={16} />,
    "output-available": <CheckCircleIcon className="size-4 text-success" />,
    "output-error": <XCircleIcon className="size-4 text-danger-strong" />,
  };

  return (
    <Badge
      className={cn(
        "tool-status-badge !inline-flex !h-[18px] items-center !gap-[3px] !border-0 !bg-run-surface-muted !px-[5px] !py-0 !text-run-text-muted text-[length:var(--canvas-node-meta-size)] !font-medium !leading-none whitespace-nowrap [&_svg]:shrink-0",
        status === "output-error" && "!text-danger-strong"
      )}
      variant="secondary"
    >
      {icons[status]}
      {stateLabel ?? labels[status]}
    </Badge>
  );
};

export const ToolHeader = ({
  className,
  description,
  stateLabel,
  title,
  toolType,
  state,
  type = "button",
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "tool-card-header grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto_13px] items-center gap-1.5 border-0 bg-transparent p-0 text-left text-inherit [font-family:inherit] data-[state=open]:[&_.tool-card-chevron]:rotate-180",
      className
    )}
    type={type}
    {...props}
  >
    <div className="tool-card-heading grid min-w-0 grid-cols-[16px_minmax(0,1fr)] items-center gap-1.5">
      <WrenchIcon
        className="tool-card-icon grid size-4 place-items-center rounded-[5px] bg-run-surface p-0.5 text-run-tool-icon"
        size={12}
      />
      <span className="tool-card-copy grid min-w-0 gap-px">
        <strong className="truncate font-medium">
          {title ?? toolType.split("-").slice(1).join("-")}
        </strong>
      
      </span>
    </div>
    {getStatusBadge(state, stateLabel)}
    <ChevronDownIcon
      className="tool-card-chevron [color:var(--run-text-muted)] transition-transform duration-[140ms] ease-[ease]"
      size={13}
    />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn("tool-card-content grid min-w-0 gap-[5px]", className)}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: CanvasToolPart["input"];
  label?: string;
};

export const ToolInput = ({
  className,
  input,
  label = "参数",
  ...props
}: ToolInputProps) => (
  <div className={cn(TOOL_IO_CLASS_NAME, className)} {...props}>
    <h4 className={TOOL_IO_HEADING_CLASS_NAME}>{label}</h4>
    <div className={TOOL_CODE_CLASS_NAME}>
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: CanvasToolPart["output"];
  errorText: CanvasToolPart["errorText"];
  errorLabel?: string;
  outputLabel?: string;
};

export const ToolOutput = ({
  className,
  errorLabel = "错误",
  output,
  outputLabel = "结果",
  errorText,
  ...props
}: ToolOutputProps) => {
  if (output === undefined && !errorText) {
    return null;
  }

  let Output = output === undefined ? null : <div>{output as ReactNode}</div>;

  if (output !== undefined && typeof output === "object" && !isValidElement(output)) {
    Output = (
      <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn(TOOL_IO_CLASS_NAME, className)} {...props}>
      <h4 className={TOOL_IO_HEADING_CLASS_NAME}>
        {errorText ? errorLabel : outputLabel}
      </h4>
      <div
        className={cn(
          TOOL_CODE_CLASS_NAME,
          errorText &&
            "rounded-canvas bg-danger-surface p-1.5 font-[inherit] text-[length:var(--canvas-node-body-size)] text-danger-deep [overflow-wrap:break-word] whitespace-pre-wrap"
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
