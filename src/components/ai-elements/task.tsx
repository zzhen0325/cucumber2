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

const TASK_CLASS_NAME = "task not-prose min-w-0";
const TASK_TRIGGER_CLASS_NAME =
  "task-trigger run-trigger flex";
const TASK_TRIGGER_LABEL_CLASS_NAME =
  "task-trigger-label run-trigger-label";
const TASK_TRIGGER_CHEVRON_CLASS_NAME =
  "task-trigger-chevron run-trigger-chevron";
const TASK_CONTENT_CLASS_NAME = "task-content grid min-w-0 gap-[5px] pt-[5px]";
const TASK_ITEM_CLASS_NAME =
  "task-item run-meta run-text-muted grid min-w-0 grid-cols-[16px_minmax(0,1fr)] gap-1.5 [&:last-child_.task-item-line]:hidden";
const TASK_ITEM_MARKER_CLASS_NAME =
  "task-item-marker relative grid justify-items-center";
const TASK_ITEM_ICON_CLASS_NAME =
  "task-item-icon z-[1] mt-px block rounded-cuc-round bg-cuc-accent text-current";
const TASK_ITEM_LINE_CLASS_NAME =
  "task-item-line absolute top-[18px] bottom-[-7px] w-px bg-cuc-node-border-hover";
const TASK_ITEM_BODY_CLASS_NAME = "task-item-body grid min-w-0 gap-[3px]";
const TASK_ITEM_TITLE_CLASS_NAME =
  "task-item-title min-w-0 overflow-hidden text-inherit [text-overflow:ellipsis]";
const TASK_ITEM_DESCRIPTION_CLASS_NAME =
  "task-item-description run-text-muted truncate";
const TASK_ITEM_FILE_CLASS_NAME =
  "task-item-file run-text-muted truncate";

export type TaskProps = ComponentProps<typeof Collapsible>;

export const Task = memo(function Task({
  className,
  defaultOpen = true,
  ...props
}: TaskProps) {
  return (
    <Collapsible
      className={cn(TASK_CLASS_NAME, className)}
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
      className={cn(TASK_TRIGGER_CLASS_NAME, className)}
      type={type}
      {...props}
    >
      {children ?? (
        <div className="flex items-center gap-1">
          <ListTreeIcon size={13} />
          <span className={TASK_TRIGGER_LABEL_CLASS_NAME}>
            <span>{title}</span>
            {detail && <em>{detail}</em>}
          </span>
        </div>
      )}
        <div>
          <ChevronDownIcon className={TASK_TRIGGER_CHEVRON_CLASS_NAME} size={13} />
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
    <CollapsibleContent className={cn(TASK_CONTENT_CLASS_NAME, className)} {...props}>
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
        TASK_ITEM_CLASS_NAME,
        `status-${status}`,
        (status === "completed" || status === "in_progress") &&
          "run-text",
        status === "error" && "text-cuc-danger-strong",
        className
      )}
      {...props}
    >
      <div className={TASK_ITEM_MARKER_CLASS_NAME} aria-hidden="true">
        <StatusIcon className={TASK_ITEM_ICON_CLASS_NAME} size={13} />
        <span className={TASK_ITEM_LINE_CLASS_NAME} />
      </div>
      <div className={TASK_ITEM_BODY_CLASS_NAME}>
        {title && <div className={TASK_ITEM_TITLE_CLASS_NAME}>{title}</div>}
        {children}
        {description && (
          <div className={TASK_ITEM_DESCRIPTION_CLASS_NAME}>{description}</div>
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
  return <div className={cn(TASK_ITEM_FILE_CLASS_NAME, className)} {...props} />;
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
