import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { normalizeSearch } from "@/lib/normalize-search";
import { fetchReceipts, groupReceipts, receiptKeys, receiptTime, ReceiptsOffError, setShareReadStatus, type Receipt } from "@/lib/receipts";
import { cn } from "@/lib/utils";

/**
 * AVORA-108 · 3.2 — `Ai đã xem` for one line, for every member (sender and readers alike).
 * Three folding groups — Đã xem (with times, newest first) · Đã nhận, chưa xem · Chưa nhận (a
 * technical fact: `Có thể đang ngoại tuyến.`) — and `n người không chia sẻ trạng thái`, never names.
 * When I do not share, I see nobody either: the sheet says so and offers `Bật` in one tap.
 */
export function ReceiptsSheet({ messageId, onOpenChange }: { messageId: string | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState<string>("");
  const receipts = useQuery({
    queryKey: receiptKeys.list(messageId ?? ""),
    queryFn: () => fetchReceipts(messageId ?? ""),
    enabled: messageId !== null,
    retry: false,
    staleTime: 10_000,
  });
  const isOff = receipts.error instanceof ReceiptsOffError;
  const rows = useMemo(() => receipts.data ?? [], [receipts.data]);
  const needle = normalizeSearch(query);
  const shown = useMemo(() => (needle === "" ? rows : rows.filter((r) => normalizeSearch(r.name).includes(needle))), [rows, needle]);
  const groups = groupReceipts(shown);

  const turnOn = async (): Promise<void> => {
    await setShareReadStatus(true);
    await queryClient.invalidateQueries({ queryKey: ["receipts"] });
  };

  return (
    <Sheet open={messageId !== null} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80dvh] scroll-y p-0 md:mx-auto md:max-w-md md:rounded-t-card" data-receipts-sheet="">
        <SheetHeader className="px-4 pt-4 text-left">
          <SheetTitle className="text-[17px]">Ai đã xem</SheetTitle>
          <SheetDescription className="sr-only">Trạng thái của tin này với từng thành viên</SheetDescription>
        </SheetHeader>
        {receipts.isPending && messageId !== null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Đang tải" />
          </div>
        ) : isOff ? (
          <div className="px-4 pb-6 pt-2" data-receipts-off="">
            <p className="text-[15px] leading-relaxed text-foreground">Tắt thì bạn cũng không thấy ai đã xem tin của bạn.</p>
            <button type="button" onClick={() => void turnOn()} className="press mt-3 min-h-11 rounded-control bg-primary px-5 text-[15px] font-semibold text-primary-foreground">
              Bật
            </button>
          </div>
        ) : receipts.isError ? (
          <p className="px-4 pb-6 pt-2 text-[14px] text-muted-foreground">{receipts.error.message}</p>
        ) : (
          <div className="pb-5">
            {rows.length > 20 ? (
              <label className="mx-4 mt-2 flex h-11 items-center gap-2 rounded-control border border-border bg-card px-3">
                <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm thành viên" aria-label="Tìm thành viên" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none md:text-[14px]" />
              </label>
            ) : null}
            <Group title="Đã xem" rows={groups.read} withTime data="read" />
            <Group title="Đã nhận, chưa xem" rows={groups.delivered} data="delivered" />
            <Group title="Chưa nhận" rows={groups.notDelivered} note="Có thể đang ngoại tuyến." data="not_delivered" />
            {groups.hidden > 0 ? (
              <p className="px-4 pt-3 text-[13.5px] text-muted-foreground" data-receipts-hidden="">
                {groups.hidden} người không chia sẻ trạng thái
              </p>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Group({ title, rows, withTime = false, note, data }: { title: string; rows: Receipt[]; withTime?: boolean; note?: string; data: string }) {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  if (rows.length === 0) return null;
  return (
    <section className="mt-2" data-receipts-group={data}>
      <button type="button" onClick={() => setIsOpen((v) => !v)} aria-expanded={isOpen} className="press flex min-h-11 w-full items-center justify-between px-4 text-left">
        <span className="text-[14px] font-semibold text-foreground">
          {title} ({rows.length})
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !isOpen && "-rotate-90")} aria-hidden="true" />
      </button>
      {isOpen ? (
        <>
          {note !== undefined ? <p className="px-4 pb-1 text-[12.5px] text-muted-foreground">{note}</p> : null}
          <ul>
            {rows.map((r) => (
              <li key={r.userId} className="flex min-h-11 items-center justify-between gap-3 px-4 text-[15px]">
                <span className="min-w-0 truncate text-foreground">{r.name}</span>
                {withTime && r.at !== null ? <span className="shrink-0 tabular-nums text-[13px] text-muted-foreground">{receiptTime(r.at)}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
