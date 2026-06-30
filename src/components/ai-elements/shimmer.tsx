import { cn } from "@/lib/utils";
import type { CSSProperties, ElementType, HTMLAttributes } from "react";

const SHIMMER_CLASS_NAME =
  "ai-shimmer inline-block bg-[linear-gradient(110deg,var(--ai-shimmer-text)_0%,var(--ai-shimmer-text)_38%,var(--semantic-color-run-shimmer-highlight)_48%,var(--ai-shimmer-text)_58%,var(--ai-shimmer-text)_100%)] text-transparent [--ai-shimmer-text:var(--semantic-color-ink)] [-webkit-background-clip:text] [animation:ai-shimmer_var(--ai-shimmer-duration)_linear_infinite] [background-clip:text] [background-position:0_0] [background-size:calc(var(--ai-shimmer-spread)*100%)_100%]";

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
      className={cn(SHIMMER_CLASS_NAME, className)}
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
