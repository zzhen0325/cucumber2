import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Handle, NodeResizer, Position } from "@xyflow/react";
import { forwardRef } from "react";
import type { ComponentProps } from "react";

const CANVAS_NODE_CLASS_NAME =
  "node-container relative w-node gap-0 overflow-visible rounded-node border-[0.5px] border-node-border bg-node p-0 text-text-strong shadow-none [--canvas-node-body-line:var(--component-text-node-body-line)] [--canvas-node-body-size:var(--component-text-node-body)] [--canvas-node-gap:var(--component-space-node-gap)] [--canvas-node-meta-line:var(--component-text-node-meta-line)] [--canvas-node-meta-size:var(--component-text-node-meta)] [--canvas-node-padding:var(--component-space-node-padding)] [--canvas-node-title-line:var(--component-text-node-title-line)] [--canvas-node-title-size:var(--component-text-node-title)] [&_.copyable-region]:cursor-text [&_.copyable-region]:select-text [&_.copyable-region_:is(p,span,strong,small,pre,code,li,h1,h2,h3,h4,h5,h6)]:cursor-text [&_.copyable-region_:is(p,span,strong,small,pre,code,li,h1,h2,h3,h4,h5,h6)]:select-text [&_.copyable-text]:cursor-text [&_.copyable-text]:select-text";
const CANVAS_NODE_SELECTED_CLASS_NAME =
  "border-primary-border-active shadow-node-selected";
const RESIZER_HANDLE_CLASS_NAME =
  "nodrag nopan !z-20 !size-4 !rounded-[2px] !border-0 !bg-transparent !text-transparent !shadow-none [&.bottom.left]:!rounded-bl-card [&.bottom.right]:!rounded-br-card [&.top.left]:!rounded-tl-card [&.top.right]:!rounded-tr-card";
const RESIZER_LINE_CLASS_NAME =
  "!z-20 !border-transparent !bg-transparent !opacity-0";

export type NodeProps = ComponentProps<typeof Card> & {
  handles: {
    target: boolean;
    source: boolean;
  };
  minHeight?: number;
  minWidth?: number;
  nodeId?: string;
  onResize?: ComponentProps<typeof NodeResizer>["onResize"];
  onResizeEnd?: ComponentProps<typeof NodeResizer>["onResizeEnd"];
  selected?: boolean;
};

export const Node = forwardRef<HTMLDivElement, NodeProps>(
  (
    {
      handles,
      className,
      minHeight = 72,
      minWidth = 160,
      nodeId,
      onResize,
      onResizeEnd,
      selected,
      ...props
    },
    ref
  ) => (
    <Card
      className={cn(
        CANVAS_NODE_CLASS_NAME,
        selected && CANVAS_NODE_SELECTED_CLASS_NAME,
        className
      )}
      ref={ref}
      {...props}
    >
      <NodeResizer
        color="var(--semantic-color-primary)"
        handleClassName={RESIZER_HANDLE_CLASS_NAME}
        isVisible={selected}
        lineClassName={RESIZER_LINE_CLASS_NAME}
        minHeight={minHeight}
        minWidth={minWidth}
        nodeId={nodeId}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />
      {handles.target && <Handle position={Position.Top} type="target" />}
      {handles.source && <Handle position={Position.Bottom} type="source" />}
      {props.children}
    </Card>
  )
);
Node.displayName = "Node";

export type NodeHeaderProps = ComponentProps<typeof CardHeader>;

export const NodeHeader = ({ className, ...props }: NodeHeaderProps) => (
  <CardHeader
    className={cn("gap-0.5 rounded-t-[8px] border-b bg-secondary p-3!", className)}
    {...props}
  />
);

export type NodeTitleProps = ComponentProps<typeof CardTitle>;

export const NodeTitle = (props: NodeTitleProps) => <CardTitle {...props} />;

export type NodeDescriptionProps = ComponentProps<typeof CardDescription>;

export const NodeDescription = (props: NodeDescriptionProps) => (
  <CardDescription {...props} />
);

export type NodeActionProps = ComponentProps<typeof CardAction>;

export const NodeAction = (props: NodeActionProps) => <CardAction {...props} />;

export type NodeContentProps = ComponentProps<typeof CardContent>;

export const NodeContent = ({ className, ...props }: NodeContentProps) => (
  <CardContent className={cn("p-3", className)} {...props} />
);

export type NodeFooterProps = ComponentProps<typeof CardFooter>;

export const NodeFooter = ({ className, ...props }: NodeFooterProps) => (
  <CardFooter
    className={cn("rounded-b-[8px] border-t bg-secondary p-3!", className)}
    {...props}
  />
);
