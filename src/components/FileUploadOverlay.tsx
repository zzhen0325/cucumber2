import { CircleAlert, UploadCloud, X } from "lucide-react";

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
      className={isError ? "file-drop-overlay error" : "file-drop-overlay active"}
      role="status"
    >
      <div className="file-drop-card">
        <span className="file-drop-icon">
          {isError ? <CircleAlert size={16} /> : <UploadCloud size={16} />}
        </span>
        <span>{error ?? "释放文件，创建预览节点"}</span>
        {isError && (
          <button
            aria-label="关闭上传提示"
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
