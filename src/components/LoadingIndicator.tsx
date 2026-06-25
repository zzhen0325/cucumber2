import { DotmSquare11, type DotmSquare11Props } from "@/components/ui/dotm-square-11";
import { cn } from "@/lib/utils";

type LoadingIndicatorProps = Omit<
  DotmSquare11Props,
  | "animated"
  | "color"
  | "dotShape"
  | "opacityBase"
  | "opacityMid"
  | "opacityPeak"
  | "pattern"
  | "speed"
> & {
  ariaLabel?: string;
};

const DOT_SIZE_RATIO = 4.5 / 35;

export function LoadingIndicator({
  ariaLabel = "加载中",
  className,
  dotSize,
  size = 35,
  ...props
}: LoadingIndicatorProps) {
  return (
    <DotmSquare11
      size={size}
      dotSize={dotSize ?? size * DOT_SIZE_RATIO}
      speed={1.25}
      pattern="full"
      dotShape="square"
      color="#42e236"
      animated
      opacityBase={0.12}
      opacityMid={0.42}
      opacityPeak={1}
      ariaLabel={ariaLabel}
      className={cn("shrink-0", className)}
      {...props}
    />
  );
}
