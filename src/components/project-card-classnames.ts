import { cn } from "@/lib/utils";

export const PROJECT_CARD_CLASS_NAME =
  "grid aspect-[286/208] min-w-0 grid-rows-[minmax(0,1fr)_auto_auto] gap-1.5 rounded-card border-[0.5px] border-border bg-surface p-2 text-left text-text shadow-none hover:border-node-border-strong max-[760px]:p-[7px]";

export const PROJECT_CREATE_CARD_CLASS_NAME = cn(
  PROJECT_CARD_CLASS_NAME,
  "grid-rows-[auto_auto_auto] place-content-center justify-items-center text-center"
);

export const PROJECT_CARD_TITLE_CLASS_NAME =
  "truncate text-xs font-medium leading-4 text-text max-[760px]:text-[11px] max-[760px]:leading-[15px]";

export const PROJECT_CARD_META_CLASS_NAME =
  "truncate text-[10px] leading-[13px] text-text-muted max-[760px]:text-[9px] max-[760px]:leading-3";
