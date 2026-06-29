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
      className={cn("task not-prose", className)}
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
      className={cn("task-trigger", className)}
      type={type}
      {...props}
    >
      {children ?? (
        <>
          <ListTreeIcon size={13} />
          <span className="task-trigger-label">
            <span>{title}</span>
            {detail && <em>{detail}</em>}
          </span>
          <ChevronDownIcon className="task-trigger-chevron" size={13} />
        </>
      )}
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
    <CollapsibleContent className={cn("task-content", className)} {...props}>
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
    <div className={cn("task-item", `status-${status}`, className)} {...props}>
      <div className="task-item-marker" aria-hidden="true">
        <StatusIcon className="task-item-icon" size={13} />
        <span className="task-item-line" />
      </div>
      <div className="task-item-body">
        {title && <div className="task-item-title">{title}</div>}
        {children}
        {description && <div className="task-item-description">{description}</div>}
      </div>
    </div>
  );
});

export type TaskItemFileProps = ComponentProps<"div">;

export const TaskItemFile = memo(function TaskItemFile({
  className,
  ...props
}: TaskItemFileProps) {
  return <div className={cn("task-item-file", className)} {...props} />;
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
