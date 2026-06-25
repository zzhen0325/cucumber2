import { LoadingIndicator } from "@/components/LoadingIndicator";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

type DeleteProjectDialogProps = {
  open: boolean;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeleteProjectDialog({
  open,
  deleting,
  onConfirm,
  onCancel,
}: DeleteProjectDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          onCancel();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <p className="text-sm font-medium text-foreground">
          确定删除此项目？此操作无法撤销。
        </p>
        <div className="mt-4 flex items-center justify-end gap-3">
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-xl"
          >
            取消
          </Button>
          <Button
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-xl bg-destructive text-white hover:bg-destructive/90"
          >
            {deleting ? (
              <LoadingIndicator ariaLabel="删除中" size={16} />
            ) : (
              "永久删除"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
