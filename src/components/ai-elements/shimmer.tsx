import { cn } from "@/lib/utils";
import type { CSSProperties, ElementType, HTMLAttributes } from "react";

export type ShimmerProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  duration?: number;
  spread?: number;
};

export function Shimmer({
  as: Component = "span",
  className,
  duration = 2,
  spread = 2,
  style,
  ...props
}: ShimmerProps) {
  return (
    <Component
      className={cn("ai-shimmer", className)}
      style={
        {
          "--ai-shimmer-duration": `${duration}s`,
          "--ai-shimmer-spread": spread,
          ...style,
        } as CSSProperties
      }
      {...props}
    />
  );
}
