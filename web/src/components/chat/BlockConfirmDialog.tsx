import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * One confirmation, one tap. Blocking is easy to undo and nobody else is told, so it gets a
 * single plain question rather than a warning ceremony (AGENTS.md §6).
 */
export function BlockConfirmDialog({
  name,
  open,
  onOpenChange,
  onConfirm,
  isWorking,
}: {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isWorking: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[420px] rounded-xl border-border bg-card">
        <AlertDialogTitle className="text-[18px] font-semibold tracking-tight text-foreground">
          Chặn {name}?
        </AlertDialogTitle>
        <AlertDialogDescription className="text-[13.5px] leading-6 text-muted-foreground">
          {name} sẽ không nhắn, gửi gợi ý việc hay tìm thấy bạn qua PIN/email được nữa. Họ không nhận
          thông báo nào. Trong Nhóm chung, hai bạn vẫn thấy tin của nhau.
        </AlertDialogDescription>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="press h-11 rounded-[10px]">Huỷ</AlertDialogCancel>
          <button
            type="button"
            disabled={isWorking}
            onClick={onConfirm}
            className="press flex h-11 items-center justify-center gap-2 rounded-[10px] bg-destructive px-5 text-[14px] font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
          >
            {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Chặn
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
