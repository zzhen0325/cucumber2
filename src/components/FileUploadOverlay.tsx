import { AlertCircleIcon as CircleAlert, CloudArrowUpIcon as UploadCloud, CancelIcon as X } from "@proicons/react";

import { cn } from "@/lib/utils";

type FileUploadOverlayProps = {
  active: boolean;
  error: string | null;
  onDismiss: () => void;
};

export function FileUploadOverlay({
  active,
  error,
  onDismiss,
}: FileUploadOverlayProps) {
  if (!active && !error) {
    return null;
  }

  const isError = Boolean(error);

  return (
    <div
      aria-live="polite"
      className={cn(
        "pointer-events-none absolute inset-0 z-[35] grid place-items-center",
        isError
          ? "items-start pt-[66px]"
          : "bg-ink/6 before:absolute before:inset-3.5 before:rounded-node before:border before:border-dashed before:border-ink/50 before:content-['']"
      )}
      role="status"
    >
      <div
        className={cn(
          "pointer-events-none relative inline-flex min-h-[38px] max-w-[min(360px,calc(100vw-32px))] items-center gap-2 overflow-hidden rounded-pill border border-ink/30 bg-surface/96 px-3 text-xs leading-4 text-ink shadow-popover",
          isError &&
            "pointer-events-auto border-danger-border bg-surface/98 text-danger-strong"
        )}
      >
        <span
          className={cn(
            "grid size-icon-button flex-none place-items-center rounded-round bg-accent text-ink",
            isError && "bg-danger-surface text-danger-strong"
          )}
        >
          {isError ? <CircleAlert size={16} /> : <UploadCloud size={16} />}
        </span>
        <span className="truncate">{error ?? "释放文件，创建预览节点"}</span>
        {isError && (
          <button
            aria-label="关闭上传提示"
            className="grid size-icon-button flex-none cursor-pointer place-items-center rounded-round border-0 bg-transparent text-current hover:bg-surface-warm"
            onClick={onDismiss}
            title="关闭"
            type="button"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
