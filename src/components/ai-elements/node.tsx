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

export type NodeProps = ComponentProps<typeof Card> & {
  handles: {
    target: boolean;
    source: boolean;
  };
  minHeight?: number;
  minWidth?: number;
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
      onResize,
      onResizeEnd,
      selected,
      ...props
    },
    ref
  ) => (
    <Card
      className={cn(
        "node-container relative size-full gap-0 rounded-[8px] p-0",
        className
      )}
      ref={ref}
      {...props}
    >
      <NodeResizer
        color="#29bf4e"
        handleClassName="canvas-node-resizer-handle nodrag nopan"
        isVisible={selected}
        lineClassName="canvas-node-resizer-line"
        minHeight={minHeight}
        minWidth={minWidth}
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
