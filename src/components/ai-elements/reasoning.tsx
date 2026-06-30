"use client";

import {
  BrainIcon,
  ChevronDownIcon,
} from "@proicons/react";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { ComponentProps, ReactNode } from "react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Streamdown } from "streamdown";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type ReasoningContextValue = {
  duration?: number;
  isOpen: boolean;
  isStreaming: boolean;
  setIsOpen: (open: boolean) => void;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export function useReasoning() {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
}

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  duration?: number;
  isStreaming?: boolean;
};

export const Reasoning = memo(function Reasoning({
  className,
  defaultOpen = true,
  duration,
  isStreaming = false,
  onOpenChange,
  open,
  children,
  ...props
}: ReasoningProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const [computedDuration, setComputedDuration] = useState<number | undefined>(
    duration
  );
  const startedAt = useRef<number | null>(isStreaming ? Date.now() : null);
  const isOpen = open ?? uncontrolledOpen;

  const setIsOpen = useMemo(
    () => (nextOpen: boolean) => {
      if (open === undefined) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, open]
  );

  useEffect(() => {
    if (duration !== undefined) {
      setComputedDuration(duration);
    }
  }, [duration]);

  useEffect(() => {
    if (isStreaming) {
      startedAt.current ??= Date.now();
      setComputedDuration(undefined);
      setIsOpen(true);
      return;
    }

    if (startedAt.current) {
      const elapsedSeconds = Math.max(
        1,
        Math.round((Date.now() - startedAt.current) / 1000)
      );
      startedAt.current = null;
      setComputedDuration(duration ?? elapsedSeconds);
      setIsOpen(false);
    }
  }, [duration, isStreaming, setIsOpen]);

  const contextValue = useMemo<ReasoningContextValue>(
    () => ({
      duration: duration ?? computedDuration,
      isOpen,
      isStreaming,
      setIsOpen,
    }),
    [computedDuration, duration, isOpen, isStreaming, setIsOpen]
  );

  return (
    <ReasoningContext.Provider value={contextValue}>
      <Collapsible
        className={cn("reasoning not-prose min-w-0", className)}
        onOpenChange={setIsOpen}
        open={isOpen}
        {...props}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
});

export type ReasoningTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  getThinkingMessage?: (
    isStreaming: boolean,
    duration?: number
  ) => ReactNode;
};

const defaultGetThinkingMessage = (
  isStreaming: boolean,
  duration?: number
) => (
  <>
    <span>推理过程</span>
    {isStreaming ? "in progress" : duration ? `${duration}s` : "DONE"}
  </>
);

export const ReasoningTrigger = memo(function ReasoningTrigger({
  className,
  children,
  getThinkingMessage = defaultGetThinkingMessage,
  ...props
}: ReasoningTriggerProps) {
  const { duration, isOpen, isStreaming } = useReasoning();

  return (
    <CollapsibleTrigger
      className={cn(
        "reasoning-trigger flex w-full min-w-0 cursor-pointer items-center justify-between gap-1 rounded-card border-[0.5px] border-run-border p-1 text-left text-label-8 [color:var(--run-text-muted)] hover:bg-run-border",
        className
      )}
      {...props}
    >
      {children ?? (
        <div className="flex items-center gap-1">
          <BrainIcon size={10} />
          <span className="reasoning-trigger-label flex min-w-0 items-center gap-[5px] [&_em]:shrink-0 [&_em]:whitespace-nowrap [&_em]:not-italic [&_em]:[color:var(--run-text-muted)] [&_em]:before:mr-[5px] [&_em]:before:text-ink/38 [&_em]:before:content-['·'] [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-nowrap [&_span]:font-medium [&_span]:[color:var(--run-text-muted)]">
            {getThinkingMessage(isStreaming, duration)}
          </span>
        </div>
      )}
      <div>
        <ChevronDownIcon
          className={cn(
            "reasoning-trigger-chevron [color:var(--run-text-muted)] transition-transform duration-[140ms] ease-[ease]",
            isOpen && "open rotate-180"
          )}
          size={10}
        />
      </div>
    </CollapsibleTrigger>
  );
});

export type ReasoningContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  children: string;
};

const streamdownPlugins = { cjk, code, math, mermaid };

export const ReasoningContent = memo(function ReasoningContent({
  className,
  children,
  ...props
}: ReasoningContentProps) {
  return (
    <CollapsibleContent
      className={cn(
        "reasoning-content min-w-0 pt-1 text-[length:var(--canvas-node-body-size)] leading-[var(--canvas-node-body-line)] [color:var(--run-text-muted)] [overflow-wrap:anywhere] [&_p]:m-0 [&_p+p]:mt-1",
        className
      )}
      {...props}
    >
      <Streamdown plugins={streamdownPlugins}>{children}</Streamdown>
    </CollapsibleContent>
  );
});

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
