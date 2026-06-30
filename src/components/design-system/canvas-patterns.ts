import { cn } from "@/lib/utils";

export const SHELL_ICON_BUTTON_CLASS =
  "grid place-items-center border-0 bg-transparent text-cuc-text-tertiary cursor-pointer [&:hover:not(:disabled)]:bg-cuc-surface-warm [&:hover:not(:disabled)]:text-cuc-text disabled:cursor-default disabled:opacity-[0.38]";

export const TOP_ICON_BUTTON_CLASS =
  "grid h-cuc-control place-items-center border-0 bg-transparent text-cuc-text-heading cursor-pointer hover:bg-cuc-surface/72 hover:text-cuc-text-heading";

export const TOP_CONTROL_BUTTON_CLASS = cn(
  TOP_ICON_BUTTON_CLASS,
  "rounded-cuc-control"
);

export const STORAGE_CHIP_CLASS =
  "hidden h-cuc-icon-button items-center gap-1 bg-white/0 px-2 text-[11px] leading-none text-cuc-text-muted";

export const COMPOSER_WRAP_CLASS =
  "absolute bottom-8 left-1/2 z-30 flex w-[var(--cuc-width-composer)] -translate-x-1/2 flex-col items-start gap-1 max-[760px]:bottom-4 max-[760px]:w-[calc(100vw-24px)]";

export const COMPOSER_FORM_CLASS =
  "rounded-cuc-composer border-[0.5px] border-cuc-border bg-cuc-surface shadow-cuc-composer [&_[data-slot=input-group]]:min-h-[inherit] [&_[data-slot=input-group]]:items-stretch [&_[data-slot=input-group]]:overflow-hidden [&_[data-slot=input-group]]:rounded-cuc-composer [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none";

export const COMPOSER_AGENT_FORM_CLASS =
  "min-h-[168px] [&_[data-slot=input-group]]:flex [&_[data-slot=input-group]]:flex-col";

export const COMPOSER_IMAGE_FORM_CLASS =
  "min-h-cuc-composer-image-height [&_[data-slot=input-group]]:flex [&_[data-slot=input-group]]:flex-col [&_[data-slot=input-group]]:items-stretch [&_[data-slot=input-group]]:justify-between";

export const COMPOSER_HEADER_CLASS =
  "box-border w-full cursor-default items-start justify-start gap-2 border-0 px-3.5 pb-1.5 pt-3";

export const COMPOSER_MODE_SWITCH_CLASS =
  "inline-flex min-h-cuc-control items-center gap-1 rounded-cuc-control-lg border-[0.5px] border-cuc-control-border bg-cuc-control-surface p-1 shadow-none";

export const COMPOSER_MODE_BUTTON_CLASS =
  "inline-flex h-7 min-w-7 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border-0 bg-transparent px-2 text-[13px] leading-5 text-cuc-control-dark disabled:cursor-not-allowed disabled:opacity-[0.58]";

export const COMPOSER_SKILL_MENU_CLASS =
  "max-h-60 w-full overflow-auto rounded-cuc-floating border-[0.5px] border-cuc-border bg-cuc-surface p-1.5 shadow-cuc-menu";

export const COMPOSER_SKILL_OPTION_CLASS =
  "grid min-h-cuc-tool w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 rounded-cuc-image border-0 bg-transparent px-2.5 text-left text-[13px] leading-[18px] text-cuc-text outline-0 hover:bg-cuc-control-hover focus-visible:bg-cuc-control-hover";

export const COMPOSER_TOKEN_CLASS =
  "inline-flex max-w-44 min-w-0 items-center gap-[5px] rounded-cuc-pill border-[0.5px] border-cuc-control-border bg-cuc-control-token px-[7px] py-[3px] text-xs leading-4 text-cuc-control-dark";

export const COMPOSER_TOKEN_KIND_CLASS =
  "flex-none text-[11px] text-cuc-text-soft";

export const COMPOSER_TOKEN_LABEL_CLASS =
  "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap";

export const COMPOSER_BODY_CLASS = "flex min-w-0 flex-1 px-0";

export const COMPOSER_BODY_INNER_CLASS =
  "flex min-w-0 flex-1 flex-col";

export const COMPOSER_FOOTER_BASE_CLASS =
  "box-border h-[52px] w-full cursor-default border-0 px-3.5 pb-3 pt-1.5";

export const COMPOSER_FOOTER_AGENT_CLASS = "justify-between";

export const COMPOSER_FOOTER_IMAGE_CLASS = "justify-between";

export const COMPOSER_TOOLS_CLASS = "min-w-0 flex-wrap gap-1.5";

export const COMPOSER_TEXTAREA_BASE_CLASS =
  "resize-none px-4 text-sm leading-5 text-cuc-text placeholder:text-cuc-text-soft";

export const COMPOSER_SUBMIT_BUTTON_CLASS =
  "size-cuc-control min-w-cuc-control rounded-cuc-control bg-cuc-control-dark text-cuc-surface";

export const COMPOSER_SELECT_CONTENT_CLASS =
  "border-cuc-border bg-cuc-surface text-cuc-text";

export const COMPOSER_SELECT_TRIGGER_CLASS =
  "h-cuc-control rounded-cuc-control border-[0.5px] border-cuc-border bg-cuc-control-surface text-xs font-medium text-cuc-control-text shadow-none hover:bg-cuc-control-hover disabled:opacity-[0.58] data-[disabled]:opacity-[0.58] aria-disabled:opacity-[0.58]";

export const ARTIFACT_CARD_BASE_CLASS =
  "overflow-hidden !rounded-cuc-card border border-cuc-border-muted bg-cuc-surface";

export const ARTIFACT_CARD_CLASS = cn(
  ARTIFACT_CARD_BASE_CLASS,
  "h-[240px] min-h-[160px] w-[240px]"
);

export const MARKDOWN_CARD_CLASS = cn(
  ARTIFACT_CARD_BASE_CLASS,
  "h-[450px] w-[360px]"
);

export const CODE_CARD_CLASS = cn(
  ARTIFACT_CARD_BASE_CLASS,
  "h-[450px] w-[360px]"
);

export const HTML_PAGE_CARD_CLASS = cn(
  ARTIFACT_CARD_BASE_CLASS,
  "h-[720px] w-[1280px]"
);

export const ARTIFACT_FRAME_CLASS =
  "relative grid h-full min-h-0 grid-rows-[32px_minmax(0,1fr)] p-0";

export const ARTIFACT_FRAME_HEADER_CLASS =
  "flex h-8 min-w-0 items-center justify-between gap-2 border-b border-cuc-border-soft bg-cuc-surface-subtle py-0 pl-3 pr-2.5";

export const ARTIFACT_FRAME_TITLE_CLASS =
  "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-normal leading-4 text-cuc-ink";

export const ARTIFACT_FRAME_ACTIONS_CLASS =
  "inline-flex flex-none items-center gap-2";

export const ARTIFACT_FRAME_ACTION_BUTTON_CLASS =
  "inline-grid size-5 cursor-pointer place-items-center rounded-cuc-canvas border-0 bg-transparent p-0 text-cuc-ink hover:bg-cuc-ink/8 focus-visible:bg-cuc-ink/8 focus-visible:outline-none disabled:cursor-default disabled:opacity-[0.32]";

export const ARTIFACT_CONTENT_CLASS =
  "grid min-h-0 content-start gap-2 overflow-hidden px-3 pb-3 pt-2.5";

export const ARTIFACT_HEADING_CLASS =
  "flex min-w-0 items-center gap-[5px] text-cuc-node-meta text-cuc-text-muted";

export const ARTIFACT_ICON_CLASS =
  "grid size-5 flex-none place-items-center rounded-cuc-round bg-cuc-surface-warm text-cuc-ink";

export const ARTIFACT_BODY_TEXT_CLASS =
  "copyable-text nodrag nopan m-0 line-clamp-3 overflow-hidden text-cuc-node-body text-cuc-text-muted [overflow-wrap:anywhere]";

export const ARTIFACT_META_CLASS =
  "copyable-text nodrag nopan overflow-hidden text-ellipsis whitespace-nowrap text-cuc-node-meta text-cuc-text-subtle";

export const ARTIFACT_NODE_TOOLBAR_CLASS =
  "pointer-events-auto inline-flex items-center gap-1 rounded-cuc-pill border border-cuc-border-muted bg-cuc-surface/96 p-1 shadow-cuc-popover";

export const ARTIFACT_NODE_TOOLBAR_BUTTON_CLASS =
  "inline-grid size-cuc-toolbar-button min-w-cuc-toolbar-button cursor-pointer place-items-center rounded-cuc-round border-0 bg-transparent text-cuc-text hover:bg-cuc-accent hover:text-cuc-ink focus-visible:bg-cuc-accent focus-visible:text-cuc-ink focus-visible:outline-none disabled:cursor-default disabled:opacity-[0.36]";

export const UPLOAD_STATE_CLASS =
  "w-fit rounded-cuc-pill bg-cuc-ink/12 px-[7px] py-0.5 text-cuc-node-meta font-semibold text-cuc-ink";

export const UPLOAD_STATE_ERROR_CLASS =
  "bg-cuc-danger-surface text-cuc-danger-deep";

export const ARTIFACT_UPLOAD_STATE_POSITION_CLASS =
  "absolute bottom-2.5 left-2.5";

export const IMAGE_UPLOAD_STATE_POSITION_CLASS =
  "absolute left-[9px] top-[9px] shadow-[0_4px_16px_rgb(0_0_0_/_8%)]";

export const IMAGE_NODE_TOOLBAR_CLASS =
  "pointer-events-auto inline-flex items-center gap-1 rounded-cuc-control border border-cuc-border-muted bg-cuc-surface/96 p-1 shadow-cuc-popover";

export const IMAGE_NODE_TOOLBAR_BUTTON_CLASS =
  "inline-grid size-cuc-toolbar-button min-w-cuc-toolbar-button cursor-pointer place-items-center rounded-cuc-round border-0 bg-transparent text-cuc-text hover:bg-cuc-accent hover:text-cuc-ink focus-visible:bg-cuc-accent focus-visible:text-cuc-ink focus-visible:outline-none";

export const IMAGE_RESULT_CARD_CLASS =
  "relative size-full min-h-cuc-icon-button overflow-visible !rounded-cuc-image bg-transparent";

export const IMAGE_RESULT_FRAME_CLASS =
  "size-full overflow-hidden rounded-[inherit]";

export const IMAGE_RESULT_FRAME_READY_CLASS = "cuc-checkerboard";

export const IMAGE_RESULT_FRAME_LOADING_CLASS =
  "grid place-items-center border border-cuc-border-muted bg-cuc-surface";

export const IMAGE_RESULT_FRAME_ERROR_CLASS =
  "grid place-items-center border border-cuc-danger-border bg-cuc-surface";

export const IMAGE_RESULT_IMAGE_CLASS = "block size-full object-cover";

export const IMAGE_RESULT_PLACEHOLDER_CLASS =
  "pointer-events-none grid justify-items-center gap-1 text-cuc-node-body text-cuc-text";

export const IMAGE_RESULT_PLACEHOLDER_META_CLASS =
  "max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap text-cuc-node-meta text-cuc-text-muted";

export const IMAGE_PREVIEW_DIALOG_CLASS =
  "image-preview-dialog w-[min(1120px,calc(100vw-40px))] max-w-[min(1120px,calc(100vw-40px))] max-h-[calc(100vh-40px)] gap-2.5 overflow-hidden rounded-cuc-control border border-cuc-border-muted bg-cuc-surface p-3.5 shadow-cuc-dialog";

export const IMAGE_PREVIEW_STAGE_CLASS =
  "cuc-checkerboard grid min-h-[220px] max-h-[calc(100vh-154px)] place-items-center overflow-auto rounded-cuc-popover";

export const IMAGE_PREVIEW_IMAGE_CLASS =
  "block max-h-[calc(100vh-170px)] max-w-full object-contain";

export const IMAGE_RESULT_FOOTER_CLASS =
  "pointer-events-none absolute bottom-[-44px] right-[72px] flex h-[31px] w-[95.5px] items-center justify-center gap-[7px] rounded-cuc-panel border border-cuc-border-muted bg-cuc-ink text-cuc-node-body text-cuc-surface shadow-cuc-popover";

export const CODE_CONTENT_CLASS =
  "grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2 overflow-hidden p-2.5";

export const MARKDOWN_CONTENT_CLASS =
  "grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2 overflow-hidden p-2.5";

export const HTML_PAGE_CONTENT_CLASS =
  "grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2 overflow-hidden p-2.5";
