import { useQueryClient } from "@tanstack/react-query";

import { BookCover } from "@/components/library/BookCover";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { sourceOf } from "@/lib/book-catalog";
import { MAX_ON_DEVICE, removeFromDevice } from "@/lib/reading-state";
import { useOnDeviceBooks, useShelfCovers } from "@/components/library/use-bookshelf";

/** One row per kept book: cover, title, % read, `Bỏ khỏi máy`. Notes and the reading place stay. */
export function OnDeviceList({ onRemoved }: { onRemoved?: (key: string) => void }) {
  const { items } = useOnDeviceBooks();
  const { coverOf } = useShelfCovers();
  const queryClient = useQueryClient();
  return (
    <ul className="overflow-hidden rounded-card border border-border bg-card" data-on-device-list="">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0" data-on-device-item={item.key}>
          <BookCover {...(item.recordId === null ? { title: item.title } : coverOf({ id: item.recordId, title: item.title }))} size="mini" className="w-7" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px]">{item.title}</span>
            <span className="block text-[12px] text-muted-foreground">
              {item.finished ? (
                <span className="font-semibold text-personal" data-finished-badge="">
                  Đã đọc xong
                </span>
              ) : item.percent === null ? (
                "Chưa đọc"
              ) : (
                `Đã đọc ${Math.round(item.percent)}%`
              )}
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              const [source, ...rest] = item.key.split(":");
              void removeFromDevice(sourceOf(source), rest.join(":")).then(() => {
                void queryClient.invalidateQueries({ queryKey: ["books-on-device"] });
                onRemoved?.(item.key);
              });
            }}
            className="press min-h-10 shrink-0 rounded-md px-2 text-[13px] font-medium text-destructive"
          >
            Bỏ khỏi máy
          </button>
        </li>
      ))}
    </ul>
  );
}

/** `Tải về` with five books already here: say why, and let one go. */
export function DeviceFullSheet({ open, onOpenChange, onRoom }: { open: boolean; onOpenChange: (open: boolean) => void; onRoom: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]" data-device-full-sheet="">
        <DialogTitle className="text-[18px]">{MAX_ON_DEVICE} cuốn trên máy</DialogTitle>
        <DialogDescription className="text-[14px] leading-relaxed">
          Bạn đang có {MAX_ON_DEVICE} cuốn trên máy. Đọc xong một cuốn, hoặc bỏ một cuốn khỏi máy để tải cuốn này.
        </DialogDescription>
        <OnDeviceList
          onRemoved={() => {
            onOpenChange(false);
            onRoom();
          }}
        />
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Sách tải về nằm trên máy của bạn, không chiếm chỗ ở Avora. Giới hạn {MAX_ON_DEVICE} cuốn để đọc tập trung và để máy không đầy. Đọc trực tuyến không giới hạn.
        </p>
      </DialogContent>
    </Dialog>
  );
}
