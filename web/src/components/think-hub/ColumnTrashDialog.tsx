import { RotateCcw } from "lucide-react";

import { ColumnTypeIcon } from "@/components/think-hub/ColumnTypeIcon";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { TrashedColumn } from "@/lib/think-hub";

/** Thùng rác của Bảng (AVORA-61 · E): deleted columns, back with their values within 30 days. */
export function ColumnTrashDialog({
  open,
  onOpenChange,
  trash,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trash: readonly TrashedColumn[];
  onRestore: (columnId: string) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogTitle className="text-[18px]">Cột đã xoá</DialogTitle>
        <DialogDescription className="text-[13px]">Giữ 30 ngày. Khôi phục là có lại cả dữ liệu trong cột.</DialogDescription>
        {trash.length === 0 ? <p className="text-[13.5px] text-muted-foreground">Trống.</p> : null}
        <ul>
          {trash.map((entry) => {
            const left = Math.max(0, 30 - Math.floor((Date.now() - new Date(entry.deletedAt).getTime()) / 86_400_000));
            return (
              <li key={entry.column.id} className="flex items-center gap-2 border-b border-border/60 py-2.5 last:border-b-0">
                <ColumnTypeIcon type={entry.column.type} className="text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px]">{entry.column.label}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {entry.filledCount} Hạng mục có dữ liệu · còn {left} ngày
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void onRestore(entry.column.id)}
                  className="press inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-[13px] font-medium"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" /> Khôi phục
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
