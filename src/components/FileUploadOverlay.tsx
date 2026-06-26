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
          : "bg-cuc-ink/6 before:absolute before:inset-3.5 before:rounded-cuc-node before:border before:border-dashed before:border-black/50 before:content-['']"
      )}
      role="status"
    >
      <div
        className={cn(
          "pointer-events-none relative inline-flex min-h-[38px] max-w-[min(360px,calc(100vw-32px))] items-center gap-2 overflow-hidden rounded-cuc-pill border border-cuc-ink/30 bg-cuc-surface/96 px-3 text-xs leading-4 text-cuc-ink shadow-[0_8px_24px_rgba(0,0,0,0.05)]",
          isError &&
            "pointer-events-auto border-cuc-danger-border bg-white/98 text-cuc-danger-strong"
        )}
      >
        <span
          className={cn(
            "grid size-cuc-icon-button flex-none place-items-center rounded-cuc-round bg-cuc-accent text-cuc-ink",
            isError && "bg-cuc-danger-surface text-cuc-danger-strong"
          )}
        >
          {isError ? <CircleAlert size={16} /> : <UploadCloud size={16} />}
        </span>
        <span className="truncate">{error ?? "释放文件，创建预览节点"}</span>
        {isError && (
          <button
            aria-label="关闭上传提示"
            className="grid size-cuc-icon-button flex-none cursor-pointer place-items-center rounded-cuc-round border-0 bg-transparent text-current hover:bg-cuc-surface-warm"
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
