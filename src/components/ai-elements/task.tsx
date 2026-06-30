"use client";

import {
  AlertCircleIcon as CircleAlertIcon,
  BulletListTreeIcon as ListTreeIcon,
  CheckmarkCircleIcon as CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  DotIcon,
} from "@proicons/react";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { memo } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type TaskItemStatus = "completed" | "in_progress" | "pending" | "error";

type TaskIcon = ComponentType<{
  className?: string;
  size?: number;
}>;

export type TaskProps = ComponentProps<typeof Collapsible>;

export const Task = memo(function Task({
  className,
  defaultOpen = true,
  ...props
}: TaskProps) {
  return (
    <Collapsible
      className={cn("task not-prose min-w-0", className)}
      defaultOpen={defaultOpen}
      {...props}
    />
  );
});

export type TaskTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  detail?: ReactNode;
  title: ReactNode;
};

export const TaskTrigger = memo(function TaskTrigger({
  children,
  className,
  detail,
  title,
  type = "button",
  ...props
}: TaskTriggerProps) {
  return (
    <CollapsibleTrigger
      className={cn(
        "task-trigger flex w-full min-w-0 cursor-pointer items-center justify-between gap-1 rounded-cuc-card border-[0.5px] border-cuc-run-border p-1 text-left text-cuc-label-8 [color:var(--run-text-muted)] hover:bg-cuc-run-border",
        className
      )}
      type={type}
      {...props}
    >
      {children ?? (
        <div className="flex items-center gap-1">
          <ListTreeIcon size={13} />
          <span className="task-trigger-label flex min-w-0 items-center gap-[5px] [&_em]:shrink-0 [&_em]:whitespace-nowrap [&_em]:not-italic [&_em]:[color:var(--run-text-muted)] [&_em]:before:mr-[5px] [&_em]:before:text-cuc-ink/38 [&_em]:before:content-['·'] [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-nowrap [&_span]:font-medium [&_span]:[color:var(--run-text-muted)]">
            <span>{title}</span>
            {detail && <em>{detail}</em>}
          </span>
        </div>
      )}
      <div>
        <ChevronDownIcon
          className="task-trigger-chevron [color:var(--run-text-muted)] transition-transform duration-[140ms] ease-[ease]"
          size={13}
        />
      </div>
    </CollapsibleTrigger>
  );
});

export type TaskContentProps = ComponentProps<typeof CollapsibleContent>;

export const TaskContent = memo(function TaskContent({
  className,
  children,
  ...props
}: TaskContentProps) {
  return (
    <CollapsibleContent
      className={cn("task-content grid min-w-0 gap-[5px] pt-[5px]", className)}
      {...props}
    >
      {children}
    </CollapsibleContent>
  );
});

export type TaskItemProps = ComponentProps<"div"> & {
  description?: ReactNode;
  icon?: TaskIcon;
  status?: TaskItemStatus;
  title?: ReactNode;
};

export const TaskItem = memo(function TaskItem({
  children,
  className,
  description,
  icon: Icon,
  status = "completed",
  title,
  ...props
}: TaskItemProps) {
  const StatusIcon = Icon ?? getTaskStatusIcon(status);

  return (
    <div
      className={cn(
        "task-item grid min-w-0 grid-cols-[16px_minmax(0,1fr)] gap-1.5 text-[length:var(--canvas-node-meta-size)] leading-[var(--canvas-node-meta-line)] [color:var(--run-text-muted)] [&:last-child_.task-item-line]:hidden",
        `status-${status}`,
        (status === "completed" || status === "in_progress") &&
          "[color:var(--run-text)]",
        status === "error" && "text-cuc-danger-strong",
        className
      )}
      {...props}
    >
      <div className="task-item-marker relative grid justify-items-center" aria-hidden="true">
        <StatusIcon
          className="task-item-icon z-[1] mt-px block rounded-cuc-round bg-cuc-accent text-current"
          size={13}
        />
        <span className="task-item-line absolute top-[18px] bottom-[-7px] w-px bg-cuc-node-border-hover" />
      </div>
      <div className="task-item-body grid min-w-0 gap-[3px]">
        {title && (
          <div className="task-item-title min-w-0 overflow-hidden text-inherit [text-overflow:ellipsis]">
            {title}
          </div>
        )}
        {children}
        {description && (
          <div className="task-item-description truncate [color:var(--run-text-muted)]">
            {description}
          </div>
        )}
      </div>
    </div>
  );
});

export type TaskItemFileProps = ComponentProps<"div">;

export const TaskItemFile = memo(function TaskItemFile({
  className,
  ...props
}: TaskItemFileProps) {
  return (
    <div
      className={cn(
        "task-item-file truncate [color:var(--run-text-muted)]",
        className
      )}
      {...props}
    />
  );
});

function getTaskStatusIcon(status: TaskItemStatus) {
  if (status === "completed") {
    return CheckCircleIcon;
  }
  if (status === "error") {
    return CircleAlertIcon;
  }
  if (status === "in_progress") {
    return ClockIcon;
  }
  return DotIcon;
}

Task.displayName = "Task";
TaskTrigger.displayName = "TaskTrigger";
TaskContent.displayName = "TaskContent";
TaskItem.displayName = "TaskItem";
TaskItemFile.displayName = "TaskItemFile";
