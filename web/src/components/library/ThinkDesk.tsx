import { BookOpen, ChevronRight, Hourglass, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { boardQuestion, DESK_LIMIT, openedAgo } from "@/lib/desk";
import { REMINDER_TILES, type ReminderLine, type ReminderTile } from "@/lib/think-hub-shelf";
import type { ThinkTable } from "@/lib/think-hub";
import { DeskFullError, useDesk } from "@/lib/use-desk";
import { cn } from "@/lib/utils";

export type DeskBook = { id: string; title: string; subtitle: string | null; percent: number | null };

/**
 * AVORA-81 · PHẦN 2 · B1 (ADR-050) — Bàn nghĩ: fixed at the top of Kế hoạch in every arrangement.
 * Mine only, at most five boards. A row of small chips (only those above 0) + `Dọn bàn cuối tuần ›`,
 * then the cards, then `Điều gì đang ở trong đầu bạn?`. A book to continue sits beside, not counted.
 */
export function ThinkDesk({
  boards,
  placeOf,
  tiles,
  book,
  canReview,
  onOpenBoard,
  onOpenBook,
  onPickTile,
  onReview,
  onCreate,
  onFull,
}: {
  boards: readonly ThinkTable[];
  placeOf: (table: ThinkTable) => string | null;
  tiles: Record<ReminderTile, ReminderLine[]>;
  book: DeskBook | null;
  canReview: boolean;
  onOpenBoard: (id: string) => void;
  onOpenBook: (id: string) => void;
  onPickTile: (tile: ReminderTile) => void;
  onReview: () => void;
  onCreate: (question: string) => Promise<ThinkTable | null>;
  onFull: (tableId: string) => void;
}) {
  const desk = useDesk();
  const [text, setText] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const byId = useMemo(() => new Map(boards.map((board) => [board.id, board] as const)), [boards]);
  const onDesk = useMemo(() => desk.ids.map((id) => byId.get(id)).filter((board): board is ThinkTable => board !== undefined), [desk.ids, byId]);
  const liveTiles = REMINDER_TILES.filter((tile) => tiles[tile.id].length > 0 && tile.id !== "starred");
  const isEmpty = onDesk.length === 0 && book === null;

  const place = async (tableId: string): Promise<void> => {
    try {
      await desk.place.mutateAsync(tableId);
    } catch (caught) {
      if (caught instanceof DeskFullError) onFull(tableId);
      else toast.error(caught instanceof Error ? caught.message : "Chưa đặt lên bàn được.");
    }
  };
  const submit = async (): Promise<void> => {
    const question = text.trim();
    if (question === "" || isSaving) return;
    setIsSaving(true);
    try {
      const created = await onCreate(question);
      if (created !== null) {
        setText("");
        await place(created.id);
      }
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <section aria-label="Bàn nghĩ" data-desk="" className="rounded-2xl border border-border bg-card/80 p-3 shadow-[0_1px_0_hsl(var(--border))] md:p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
          Bàn nghĩ <span className="tabular font-normal text-muted-foreground" data-desk-count="">{onDesk.length}/{DESK_LIMIT}</span>
        </h2>
        <div className="-mr-3 flex min-w-0 flex-1 gap-1.5 overflow-x-auto pr-3 [scrollbar-width:none] md:mr-0 md:flex-wrap md:overflow-visible md:pr-0">
          {liveTiles.map((tile) => (
            <button key={tile.id} type="button" data-tile={tile.id} onClick={() => onPickTile(tile.id)} className="press inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border bg-background px-2.5 text-[12.5px]">
              <span className="text-foreground">{tile.label}</span>
              <span className={cn("tabular font-semibold", tile.id === "overdue" ? "text-destructive" : "text-foreground")}>{tiles[tile.id].length}</span>
              <span className="text-muted-foreground">· {tile.ask}</span>
            </button>
          ))}
          {canReview ? (
            <button type="button" onClick={onReview} data-desk-review="" className="press inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border bg-background px-2.5 text-[12.5px] text-foreground">
              <Hourglass className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> Dọn bàn cuối tuần <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {isEmpty ? null : (
        <ul className="-mx-3 mt-3 flex snap-x gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0" data-desk-cards="">
          {onDesk.map((board) => (
            <li key={board.id} className="w-[64%] shrink-0 snap-start md:w-auto">
              <button type="button" onClick={() => onOpenBoard(board.id)} data-desk-card={board.id} className="press flex h-full min-h-[104px] w-full flex-col justify-between rounded-xl border border-border bg-background p-3 text-left transition-colors hover:border-personal/60">
                <span className="line-clamp-3 text-[15px] font-semibold leading-snug text-foreground">{boardQuestion(board)}</span>
                <span className="mt-2 truncate text-[12px] text-muted-foreground">{[placeOf(board) ?? "Của tôi", openedAgo(board.updatedAt)].filter((part) => part !== "").join(" · ")}</span>
              </button>
            </li>
          ))}
          {book !== null ? (
            <li className="w-[64%] shrink-0 snap-start md:w-auto">
              <button type="button" onClick={() => onOpenBook(book.id)} data-desk-book={book.id} className="press flex h-full min-h-[104px] w-full flex-col justify-between rounded-xl border border-dashed border-border bg-[hsl(var(--reader-paper,40_40%_96%))] p-3 text-left">
                <span className="flex items-start gap-2">
                  <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-[14.5px] font-semibold leading-snug text-foreground">{book.title}</span>
                    {book.subtitle !== null ? <span className="block truncate text-[11.5px] text-muted-foreground">{book.subtitle}</span> : null}
                  </span>
                </span>
                <span className="mt-2 text-[12px] text-muted-foreground">Đọc tiếp{book.percent !== null ? ` · ${Math.round(book.percent)}%` : ""}</span>
              </button>
            </li>
          ) : null}
        </ul>
      )}

      <form
        className={cn("flex items-center gap-2", isEmpty ? "mt-3" : "mt-2.5")}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          value={text}
          maxLength={200}
          onChange={(event) => setText(event.target.value)}
          placeholder="Điều gì đang ở trong đầu bạn?"
          aria-label="Điều gì đang ở trong đầu bạn?"
          data-desk-input=""
          className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-[16px] outline-none focus:border-personal md:text-[14.5px]"
        />
        <button type="submit" disabled={text.trim() === "" || isSaving} className="press inline-flex h-11 shrink-0 items-center gap-1 rounded-xl bg-personal px-3.5 text-[14px] font-semibold text-personal-foreground disabled:opacity-50">
          <Plus className="h-4 w-4" aria-hidden="true" /> Đặt lên bàn
        </button>
      </form>

    </section>
  );
}

/** `Bàn đã đủ 5` (V2-BanDay): choose one to put down; the wanted board takes its place. */
export function DeskFullSheet({ wanted, boards, placeOf, onClose }: { wanted: string | null; boards: readonly ThinkTable[]; placeOf: (table: ThinkTable) => string | null; onClose: () => void }) {
  const desk = useDesk();
  const byId = useMemo(() => new Map(boards.map((board) => [board.id, board] as const)), [boards]);
  const onDesk = desk.ids.map((id) => byId.get(id)).filter((board): board is ThinkTable => board !== undefined);
  const swap = async (out: ThinkTable): Promise<void> => {
    const next = wanted;
    onClose();
    try {
      await desk.remove.mutateAsync(out.id);
      if (next !== null) await desk.place.mutateAsync(next);
      toast.success("Đã đặt lên bàn.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Chưa đổi được.");
    }
  };
  return (
    <Sheet open={wanted !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-2xl" data-desk-full="">
        <SheetTitle className="text-[18px]">Bàn đã đủ 5</SheetTitle>
        <SheetDescription className="text-[13.5px]">Chọn một thứ đặt xuống. Bảng của bạn về Đang chờ; Bảng chung chỉ rời bàn của bạn.</SheetDescription>
        <ul className="mt-3">
          {onDesk.map((board) => (
            <li key={board.id} className="border-b border-border/60 last:border-b-0">
              <button type="button" onClick={() => void swap(board)} className="press flex min-h-14 w-full items-center gap-3 py-2 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{boardQuestion(board)}</span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">{placeOf(board) ?? "Của tôi"}</span>
                </span>
                <span className="shrink-0 text-[13px] font-medium text-personal">Đặt xuống</span>
              </button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
