"use client";

import {
  BrainIcon,
  ChevronDownIcon,
  DotIcon,
} from "@proicons/react";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { createContext, memo, useContext, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type ChainOfThoughtContextValue = {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
};

type ChainOfThoughtIcon = ComponentType<{
  className?: string;
  size?: number;
}>;

const ChainOfThoughtContext =
  createContext<ChainOfThoughtContextValue | null>(null);

function useChainOfThought() {
  const context = useContext(ChainOfThoughtContext);
  if (!context) {
    throw new Error(
      "ChainOfThought components must be used within ChainOfThought"
    );
  }
  return context;
}

export type ChainOfThoughtProps = ComponentProps<"div"> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const ChainOfThought = memo(function ChainOfThought({
  className,
  open,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: ChainOfThoughtProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = open ?? uncontrolledOpen;
  const contextValue = useMemo<ChainOfThoughtContextValue>(
    () => ({
      isOpen,
      setIsOpen: (nextOpen) => {
        if (open === undefined) {
          setUncontrolledOpen(nextOpen);
        }
        onOpenChange?.(nextOpen);
      },
    }),
    [isOpen, onOpenChange, open]
  );

  return (
    <ChainOfThoughtContext.Provider value={contextValue}>
      <div className={cn("chain-of-thought not-prose", className)} {...props}>
        {children}
      </div>
    </ChainOfThoughtContext.Provider>
  );
});

export type ChainOfThoughtHeaderProps = ComponentProps<"button">;

export const ChainOfThoughtHeader = memo(function ChainOfThoughtHeader({
  className,
  children,
  onClick,
  type = "button",
  ...props
}: ChainOfThoughtHeaderProps) {
  const { isOpen, setIsOpen } = useChainOfThought();

  return (
    <button
      aria-expanded={isOpen}
      className={cn("chain-of-thought-header", className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          setIsOpen(!isOpen);
        }
      }}
      type={type}
      {...props}
    >
      <BrainIcon size={13} />
      <span className="chain-of-thought-header-label">
        {children ?? "Chain of Thought"}
      </span>
      <ChevronDownIcon
        className={cn("chain-of-thought-header-chevron", isOpen && "open")}
        size={13}
      />
    </button>
  );
});

export type ChainOfThoughtStatus =
  | "complete"
  | "active"
  | "pending"
  | "error";

export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
  icon?: ChainOfThoughtIcon;
  label: ReactNode;
  description?: ReactNode;
  status?: ChainOfThoughtStatus;
};

export const ChainOfThoughtStep = memo(function ChainOfThoughtStep({
  className,
  icon: Icon = DotIcon,
  label,
  description,
  status = "complete",
  children,
  ...props
}: ChainOfThoughtStepProps) {
  return (
    <div
      className={cn("chain-of-thought-step", `status-${status}`, className)}
      {...props}
    >
      <div className="chain-of-thought-step-marker" aria-hidden="true">
        <Icon className="chain-of-thought-step-icon" size={13} />
        <span className="chain-of-thought-step-line" />
      </div>
      <div className="chain-of-thought-step-body">
        <div className="chain-of-thought-step-label">{label}</div>
        {description && (
          <div className="chain-of-thought-step-description">
            {description}
          </div>
        )}
        {children}
      </div>
    </div>
  );
});

export type ChainOfThoughtContentProps = ComponentProps<
  typeof CollapsibleContent
>;

export const ChainOfThoughtContent = memo(function ChainOfThoughtContent({
  className,
  children,
  ...props
}: ChainOfThoughtContentProps) {
  const { isOpen } = useChainOfThought();

  return (
    <Collapsible open={isOpen}>
      <CollapsibleContent
        className={cn("chain-of-thought-content", className)}
        {...props}
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
});

export type ChainOfThoughtSearchResultsProps = ComponentProps<"div">;

export const ChainOfThoughtSearchResults = memo(
  function ChainOfThoughtSearchResults({
    className,
    ...props
  }: ChainOfThoughtSearchResultsProps) {
    return (
      <div
        className={cn("chain-of-thought-search-results", className)}
        {...props}
      />
    );
  }
);

export type ChainOfThoughtSearchResultProps = ComponentProps<typeof Badge>;

export const ChainOfThoughtSearchResult = memo(
  function ChainOfThoughtSearchResult({
    className,
    children,
    ...props
  }: ChainOfThoughtSearchResultProps) {
    return (
      <Badge
        className={cn("chain-of-thought-search-result", className)}
        variant="secondary"
        {...props}
      >
        {children}
      </Badge>
    );
  }
);
