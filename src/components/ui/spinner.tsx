import type { ComponentProps } from "react";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import { cn } from "@/lib/utils";

type SpinnerProps = ComponentProps<typeof LoadingIndicator> & {
  "aria-label"?: string;
};

function Spinner({
  "aria-label": ariaLabelAttribute,
  ariaLabel,
  className,
  size = 16,
  ...props
}: SpinnerProps) {
  return (
    <LoadingIndicator
      ariaLabel={ariaLabel ?? ariaLabelAttribute ?? "Loading"}
      className={cn("text-primary", className)}
      size={size}
      {...props}
    />
  );
}

export { Spinner };
