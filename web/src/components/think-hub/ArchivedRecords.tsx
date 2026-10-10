import { Archive, Loader2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useArchivedRecords, useSetRecordsArchived } from "@/lib/cleanup";
import type { ThinkRecord } from "@/lib/think-hub";
import { cn } from "@/lib/utils";

/** AVORA-100 · V·3.2: `Đã cất n mục · Xem` at the foot of a board; inside, `Lấy ra`. */
export function ArchivedRecordsRow({ tableId, canEdit }: { tableId: string; canEdit: boolean }) {
  const archived = useArchivedRecords(tableId);
  const setArchived = useSetRecordsArchived();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const list = archived.data ?? [];
  if (list.length === 0) return null;
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} data-archived-row="" className="press mt-3 flex min-h-11 w-full items-center gap-2 rounded-card border border-dashed border-border px-3 text-left text-[13.5px] text-muted-foreground">
        <Archive className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">Đã cất <span className="tabular">{list.length}</span> mục</span>
        <span className="font-semibold text-personal">Xem</span>
      </button>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="bottom" className="mx-auto max-h-[80dvh] max-w-lg overflow-y-auto rounded-t-card" data-archived-sheet="">
          <SheetTitle className="text-[18px]">Đã cất</SheetTitle>
          <SheetDescription className="text-[13px]">Ẩn khỏi bảng và số đếm. Vẫn tìm thấy trong tìm kiếm.</SheetDescription>
          <ul className="mt-2">
            {list.map((record) => (
              <li key={record.id} className="flex min-h-12 items-center gap-2 border-b border-border/60 py-2 last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-[14.5px]">{record.title}</span>
                {canEdit ? (
                  <button
                    type="button"
                    disabled={setArchived.isPending}
                    onClick={() => setArchived.mutate({ ids: [record.id], archived: false }, { onSuccess: () => toast.success("Đã lấy ra."), onError: (error) => toast.error(error.message) })}
                    className="press h-10 shrink-0 rounded-md px-3 text-[13.5px] font-semibold text-personal disabled:opacity-50"
                  >
                    Lấy ra
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * AVORA-100 · V·3.3: hold a Hạng mục in a board → choose several → `Cất · Xoá · Huỷ`. The server checks
 * each one again (the creator of the item or the owner of the board).
 */
export function RecordSelectSheet({
  records,
  startId,
  onClose,
  onDelete,
}: {
  records: readonly ThinkRecord[];
  startId: string | null;
  onClose: () => void;
  onDelete: (ids: readonly string[]) => Promise<void>;
}) {
  const setArchived = useSetRecordsArchived();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  if (startId !== shownFor) {
    setShownFor(startId);
    setPicked(new Set(startId === null ? [] : [startId]));
  }
  const ids = [...picked];
  const toggle = (id: string): void =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Sheet open={startId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-h-[85dvh] max-w-lg overflow-y-auto rounded-t-card" data-record-select="">
        <SheetTitle className="text-[18px]">Chọn <span className="tabular">{ids.length}</span> mục</SheetTitle>
        <SheetDescription className="text-[13px]">Cất: ẩn khỏi bảng, vẫn tìm thấy. Xoá: vào Thùng rác 30 ngày.</SheetDescription>
        <ul className="mt-2">
          {records.map((record) => {
            const on = picked.has(record.id);
            return (
              <li key={record.id}>
                <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(record.id)} className="press flex min-h-12 w-full items-center gap-3 border-b border-border/60 py-2 text-left">
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[12px]", on ? "border-personal bg-personal text-personal-foreground" : "border-border")}>{on ? "✓" : ""}</span>
                  <span className="min-w-0 flex-1 truncate text-[14.5px]">{record.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="sticky bottom-0 mt-3 grid grid-cols-3 gap-2 bg-background pb-1 pt-2">
          <button
            type="button"
            disabled={ids.length === 0 || isBusy}
            onClick={() =>
              setArchived.mutate(
                { ids, archived: true },
                {
                  onSuccess: (n) => {
                    toast.success(`Đã cất ${n} mục`, { action: { label: "Hoàn tác", onClick: () => setArchived.mutate({ ids, archived: false }) } });
                    onClose();
                  },
                  onError: (error) => toast.error(error.message),
                },
              )
            }
            className="press inline-flex h-11 items-center justify-center gap-1.5 rounded-control bg-personal text-[14px] font-semibold text-personal-foreground disabled:opacity-50"
          >
            {setArchived.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />} Cất
          </button>
          <button
            type="button"
            disabled={ids.length === 0 || isBusy}
            onClick={() => {
              setIsBusy(true);
              void onDelete(ids)
                .then(onClose)
                .finally(() => setIsBusy(false));
            }}
            className="press inline-flex h-11 items-center justify-center gap-1.5 rounded-control border border-border text-[14px] disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> Xoá
          </button>
          <button type="button" onClick={onClose} className="press inline-flex h-11 items-center justify-center gap-1.5 rounded-control border border-border text-[14px]">
            <X className="h-4 w-4" /> Huỷ
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
