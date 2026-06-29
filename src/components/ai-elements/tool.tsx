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

const TOOL_CLASS_NAME =
  "tool-card not-prose group run-body run-text grid w-full min-w-0 gap-[5px] rounded-cuc-card border border-cuc-subtle-border bg-cuc-surface px-1.5 py-[5px] [&.error]:border-cuc-danger-border [&.error]:bg-cuc-danger-surface";
const TOOL_HEADER_CLASS_NAME =
  "tool-card-header grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto_13px] items-center gap-1.5 border-0 bg-transparent p-0 text-left text-inherit [font-family:inherit] data-[state=open]:[&_.tool-card-chevron]:rotate-180";
const TOOL_HEADING_CLASS_NAME =
  "tool-card-heading grid min-w-0 grid-cols-[16px_minmax(0,1fr)] items-center gap-1.5";
const TOOL_ICON_CLASS_NAME =
  "tool-card-icon grid size-4 place-items-center rounded-[5px] bg-white/70 p-0.5 text-[#5a6472]";
const TOOL_COPY_CLASS_NAME = "tool-card-copy grid min-w-0 gap-px";
const TOOL_TITLE_CLASS_NAME = "truncate font-medium";
const TOOL_DESCRIPTION_CLASS_NAME =
  "tool-card-description run-meta run-text-muted truncate";
const TOOL_STATUS_BADGE_CLASS_NAME =
  "tool-status-badge run-meta run-text-muted inline-flex h-[18px] items-center gap-[3px] whitespace-nowrap border-0 bg-cuc-surface/66 px-[5px] py-0 font-medium leading-none [&_svg]:shrink-0";
const TOOL_CHEVRON_CLASS_NAME =
  "tool-card-chevron run-text-muted transition-transform duration-[140ms] ease-[ease]";
const TOOL_CONTENT_CLASS_NAME = "tool-card-content grid min-w-0 gap-[5px]";
const TOOL_IO_CLASS_NAME = "tool-card-io grid min-w-0 gap-[3px]";
const TOOL_IO_HEADING_CLASS_NAME =
  "run-meta run-text-muted m-0 font-medium";
const TOOL_CODE_CLASS_NAME =
  "tool-card-code grid min-w-0 [&>div[data-language]]:run-text [&>div[data-language]]:rounded-cuc-canvas [&>div[data-language]]:border-0 [&>div[data-language]]:bg-cuc-surface-warm/72 [&_code]:text-cuc-node-meta [&_pre]:max-h-28 [&_pre]:overflow-auto [&_pre]:break-words [&_pre]:!bg-transparent [&_pre]:p-1.5 [&_pre]:text-cuc-node-body [&_pre]:!text-inherit [&_pre]:whitespace-pre-wrap";
const TOOL_CODE_ERROR_CLASS_NAME =
  "error rounded-cuc-canvas bg-cuc-danger/9 p-1.5 text-cuc-danger-deep [font-family:inherit] text-cuc-node-body whitespace-pre-wrap break-words";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn(TOOL_CLASS_NAME, className)}
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
    "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
    "output-error": <XCircleIcon className="size-4 text-red-600" />,
  };

  return (
    <Badge
      className={cn(
        TOOL_STATUS_BADGE_CLASS_NAME,
        status === "output-error" && "text-cuc-danger-strong"
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
    className={cn(TOOL_HEADER_CLASS_NAME, className)}
    type={type}
    {...props}
  >
    <div className={TOOL_HEADING_CLASS_NAME}>
      <WrenchIcon className={TOOL_ICON_CLASS_NAME} size={12} />
      <span className={TOOL_COPY_CLASS_NAME}>
        <strong className={TOOL_TITLE_CLASS_NAME}>
          {title ?? toolType.split("-").slice(1).join("-")}
        </strong>
        {description && (
          <span className={TOOL_DESCRIPTION_CLASS_NAME}>{description}</span>
        )}
      </span>
    </div>
    {getStatusBadge(state, stateLabel)}
    <ChevronDownIcon className={TOOL_CHEVRON_CLASS_NAME} size={13} />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(TOOL_CONTENT_CLASS_NAME, className)}
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
          errorText && TOOL_CODE_ERROR_CLASS_NAME
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
