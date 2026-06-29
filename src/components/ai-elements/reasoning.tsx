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
        className={cn("reasoning not-prose", className)}
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
    <em>{isStreaming ? "进行中" : duration ? `${duration}s` : "完成"}</em>
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
      className={cn("reasoning-trigger", className)}
      {...props}
    >
      {children ?? (
        <>
          <BrainIcon size={13} />
          <span className="reasoning-trigger-label">
            {getThinkingMessage(isStreaming, duration)}
          </span>
          <ChevronDownIcon
            className={cn("reasoning-trigger-chevron", isOpen && "open")}
            size={13}
          />
        </>
      )}
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
      className={cn("reasoning-content", className)}
      {...props}
    >
      <Streamdown plugins={streamdownPlugins}>{children}</Streamdown>
    </CollapsibleContent>
  );
});

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
