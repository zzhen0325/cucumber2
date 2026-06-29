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

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("tool-card not-prose group w-full", className)}
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
    <Badge className="tool-status-badge" variant="secondary">
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
    className={cn("tool-card-header", className)}
    type={type}
    {...props}
  >
    <div className="tool-card-heading">
      <WrenchIcon className="tool-card-icon" size={12} />
      <span className="tool-card-copy">
        <strong>{title ?? toolType.split("-").slice(1).join("-")}</strong>
        {description && <span className="tool-card-description">{description}</span>}
      </span>
    </div>
    {getStatusBadge(state, stateLabel)}
    <ChevronDownIcon className="tool-card-chevron" size={13} />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn("tool-card-content", className)}
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
  <div className={cn("tool-card-io", className)} {...props}>
    <h4>{label}</h4>
    <div className="tool-card-code">
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
    <div className={cn("tool-card-io", className)} {...props}>
      <h4>{errorText ? errorLabel : outputLabel}</h4>
      <div className={cn("tool-card-code", errorText && "error")}>
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
