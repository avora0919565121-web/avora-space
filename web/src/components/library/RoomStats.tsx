import { BookOpen, MoreHorizontal, Table2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatMinutes, localDay, weekDays } from "@/lib/activity";
import type { Note } from "@/lib/notes";
import { ownWords, rankBookNotes, statName, useStatsPrefs } from "@/lib/room-stats";
import { useReadingDays, useRoomStats, type RoomStatItem, type RoomViewed } from "@/lib/use-activity";
import { coverColor } from "@/lib/library";
import { cn } from "@/lib/utils";

/**
 * AVORA-93 · PHẦN 2 (ADR-058) — kệ 2 numbers and kệ 5 reading time. Mine only, to look back:
 * no streaks, goals, badges, red/green arrows or reminders. Hidden with `⋯ › Ẩn số liệu`.
 */

const DAY_MS = 86_400_000;
const isUuid = (key: string): boolean => /^[0-9a-f]{8}-/.test(key);

/** `⋯` beside a shelf's title: `Ẩn số liệu` / `Hiện số liệu`. */
export function StatsMenu() {
  const { hidden, setHidden } = useStatsPrefs();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Tuỳ chọn số liệu" data-stats-menu="" className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/40">
        <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => setHidden(!hidden)} className="min-h-11">
          {hidden ? "Hiện số liệu" : "Ẩn số liệu"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & Record<`data-${string}`, string>) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card px-4 py-3", className)} {...rest}>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</h3>;
}

function TopList({ items, format, onOpen }: { items: readonly RoomStatItem[]; format: (value: number) => string; onOpen: (key: string) => void }) {
  if (items.length === 0) return <p className="py-2 text-[13px] text-muted-foreground">Chưa có.</p>;
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <ul>
      {items.map((item) => (
        <li key={item.board_key}>
          <button type="button" onClick={() => onOpen(item.board_key)} className="press block w-full py-1.5 text-left">
            <span className="flex items-baseline justify-between gap-2 text-[13.5px]">
              <span className="min-w-0 truncate text-foreground">{statName(item)}</span>
              <span className="tabular shrink-0 text-muted-foreground">{format(item.value)}</span>
            </span>
            <span className="mt-1 block h-1 rounded-full bg-muted">
              <span className="block h-1 rounded-full bg-personal/70" style={{ width: `${Math.max(6, (item.value / max) * 100)}%` }} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Kệ 2's numbers, above "Còn chưa thông suốt". Returns `null` while there is no activity yet
 * (a new person sees only the open questions — no rows of zeros).
 */
export function RoomNumbers({
  onOpenBoard,
  onOpenBook,
  onOpenLane,
  onOpenTasks,
  isWide,
}: {
  onOpenBoard: (key: string) => void;
  onOpenBook: (id: string) => void;
  onOpenLane: (lane: "waiting" | "thinking" | "concluded") => void;
  onOpenTasks: () => void;
  isWide: boolean;
}) {
  const { hidden, range, setRange } = useStatsPrefs();
  const since = range === "today" ? localDay() : localDay(Date.now() - 6 * DAY_MS);
  const stats = useRoomStats(since, !hidden);
  const [tab, setTab] = useState<"items" | "opens" | "time">("items");
  const [showAll, setShowAll] = useState<boolean>(false);
  if (hidden || stats.data === undefined) return null;
  const data = stats.data;
  // Any open at all (in the last week) before numbers show.
  if (data.viewed.length === 0 && range === "week") return null;
  const status = data.boards_by_status;
  const total = status.waiting + status.thinking + status.concluded;
  const books = data.viewed.filter((item) => item.kind === "book").length;
  const boards = data.viewed.length - books;
  const limit = showAll ? data.viewed.length : isWide ? 5 : 2;
  const lanes: { id: "thinking" | "waiting" | "concluded"; label: string; tone: string; n: number }[] = [
    { id: "thinking", label: "đang nghĩ", tone: "bg-personal", n: status.thinking },
    { id: "waiting", label: "đang chờ", tone: "bg-muted-foreground/40", n: status.waiting },
    { id: "concluded", label: "đã chốt", tone: "bg-foreground/70", n: status.concluded },
  ];
  const open = (item: RoomViewed): void => (item.kind === "book" ? onOpenBook(item.item_key) : onOpenBoard(item.item_key));
  const rangeLabel = range === "today" ? "HÔM NAY" : "7 NGÀY";

  return (
    <div data-room-numbers="" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[17px] font-semibold tracking-tight text-foreground">Kế hoạch của bạn</h2>
        <div role="tablist" aria-label="Khoảng thời gian" className="flex rounded-full bg-muted p-0.5 text-[12.5px]">
          {(["today", "week"] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={range === id} onClick={() => setRange(id)} className={cn("press h-8 rounded-full px-3", range === id ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground")}>
              {id === "today" ? "Hôm nay" : "7 ngày"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card className="col-span-2 md:col-span-1" data-stat="boards">
          <Label>Bảng</Label>
          <p className="tabular text-[30px] font-semibold leading-tight text-foreground">{total}</p>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted">
            {lanes.map((lane) => (lane.n > 0 ? <button key={lane.id} type="button" aria-label={`${lane.n} ${lane.label}`} onClick={() => onOpenLane(lane.id)} className={lane.tone} style={{ width: `${(lane.n / Math.max(total, 1)) * 100}%` }} /> : null))}
          </div>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">{lanes.map((lane) => `${lane.n} ${lane.label}`).join(" · ")}</p>
        </Card>
        <Card data-stat="records">
          <Label>Hạng mục</Label>
          <p className="tabular text-[30px] font-semibold leading-tight text-foreground">{data.records_total}</p>
          <p className="text-[12.5px] text-muted-foreground">+{data.records_new} {range === "today" ? "hôm nay" : "trong 7 ngày"}</p>
        </Card>
        <Card data-stat="tasks">
          <Label>Việc đang mở từ bảng</Label>
          <p className="tabular text-[30px] font-semibold leading-tight text-foreground">{data.open_tasks}</p>
          <button type="button" onClick={onOpenTasks} className="press text-[12.5px] font-medium text-personal">Xem ở Nhiệm vụ ›</button>
        </Card>
      </div>

      <Card data-stat="top">
        <Label>Bảng nổi bật</Label>
        {isWide ? (
          <div className="mt-2 grid grid-cols-3 gap-5">
            <div><p className="text-[12.5px] font-medium text-foreground">Nhiều hạng mục nhất</p><TopList items={data.top_items} format={(v) => `${v} mục`} onOpen={onOpenBoard} /></div>
            <div><p className="text-[12.5px] font-medium text-foreground">Mở nhiều nhất</p><TopList items={data.top_opens} format={(v) => `${v} lần`} onOpen={onOpenBoard} /></div>
            <div><p className="text-[12.5px] font-medium text-foreground">Ở lâu nhất</p><TopList items={data.top_time} format={formatMinutes} onOpen={onOpenBoard} /></div>
          </div>
        ) : (
          <>
            <div role="tablist" className="mt-2 flex border-b border-border text-[13px]">
              {([["items", "Nhiều mục"], ["opens", "Mở nhiều"], ["time", "Ở lâu"]] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("press relative h-10 flex-1", tab === id ? "font-semibold text-foreground" : "text-muted-foreground")}>
                  {label}
                  {tab === id ? <span aria-hidden="true" className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-personal" /> : null}
                </button>
              ))}
            </div>
            <TopList
              items={tab === "items" ? data.top_items : tab === "opens" ? data.top_opens : data.top_time}
              format={tab === "items" ? (v) => `${v} mục` : tab === "opens" ? (v) => `${v} lần` : formatMinutes}
              onOpen={onOpenBoard}
            />
          </>
        )}
      </Card>

      <Card data-stat="viewed">
        <div className="flex items-baseline justify-between gap-2">
          <Label>Bạn đã xem · {rangeLabel}</Label>
          <span className="text-[12px] text-muted-foreground">{boards} bảng · {books} sách</span>
        </div>
        {data.viewed.length === 0 ? (
          <p className="py-2 text-[13.5px] text-muted-foreground">Hôm nay bạn chưa mở bảng hay sách nào.</p>
        ) : (
          <ul className="mt-1">
            {data.viewed.slice(0, limit).map((item) => (
              <li key={`${item.kind}:${item.item_key}`}>
                <button type="button" onClick={() => open(item)} className="press flex min-h-11 w-full items-center gap-2.5 text-left">
                  {item.kind === "book" ? <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Table2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{statName(item)}</span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {item.kind === "book" ? "Sách" : isUuid(item.item_key) ? "Bảng" : "Bảng Avora"} · {item.opens} lần{item.seconds > 0 ? ` · ${formatMinutes(item.seconds)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!showAll && data.viewed.length > limit ? (
          <button type="button" onClick={() => setShowAll(true)} className="press py-1.5 text-[13px] font-medium text-personal">Xem cả {data.viewed.length} ›</button>
        ) : null}
      </Card>
    </div>
  );
}

const WEEKDAY = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const;

/** Kệ 5 · Thời gian đọc — today, 7 days, this week's bars and the books read. No goal line. */
export function ReadingTime({ books, onOpenBook, continueBook }: { books: readonly { id: string; title: string; percent: number | null }[]; onOpenBook: (id: string) => void; continueBook: { id: string; title: string } | null }) {
  const { hidden } = useStatsPrefs();
  const today = localDay();
  const week = useMemo(() => weekDays(today), [today]);
  const from = [week[0], localDay(Date.now() - 6 * DAY_MS)].sort()[0];
  const rows = useReadingDays(from, !hidden);
  if (hidden || rows.data === undefined) return null;
  const sevenFrom = localDay(Date.now() - 6 * DAY_MS);
  const todaySec = rows.data.filter((row) => row.day === today).reduce((sum, row) => sum + row.active_seconds, 0);
  const lastSeven = rows.data.filter((row) => row.day >= sevenFrom);
  const weekSec = lastSeven.reduce((sum, row) => sum + row.active_seconds, 0);
  const perDay = week.map((day) => rows.data.filter((row) => row.day === day).reduce((sum, row) => sum + row.active_seconds, 0));
  const max = Math.max(...perDay, 1);
  const byBook = new Map<string, number>();
  for (const row of lastSeven) byBook.set(row.item_key, (byBook.get(row.item_key) ?? 0) + row.active_seconds);
  const top = [...byBook.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <Card data-reading-time="">
      <Label>Thời gian đọc</Label>
      {weekSec === 0 ? (
        <p className="py-2 text-[14px] text-muted-foreground">
          Chưa đọc trong 7 ngày qua.
          {continueBook !== null ? (
            <button type="button" onClick={() => onOpenBook(continueBook.id)} className="press ml-1 font-medium text-personal">Đọc tiếp {continueBook.title} ›</button>
          ) : null}
        </p>
      ) : (
        <>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <span><span className="text-[12.5px] text-muted-foreground">Hôm nay </span><span className="text-[24px] font-semibold text-foreground">{formatMinutes(todaySec)}</span></span>
            <span><span className="text-[12.5px] text-muted-foreground">7 ngày </span><span className="text-[24px] font-semibold text-foreground">{formatMinutes(weekSec)}</span></span>
          </p>
          <div className="mt-3 flex h-16 items-end gap-2" aria-label="Tuần này">
            {perDay.map((seconds, index) => (
              <div key={week[index]} className="flex flex-1 flex-col items-center gap-1">
                <span className={cn("w-full rounded-sm", week[index] === today ? "bg-personal" : "bg-personal/30")} style={{ height: `${Math.max(3, (seconds / max) * 48)}px` }} />
                <span className={cn("text-[10.5px]", week[index] === today ? "font-semibold text-foreground" : "text-muted-foreground")}>{WEEKDAY[index]}</span>
              </div>
            ))}
          </div>
          <ul className="mt-2">
            {top.map(([id, seconds]) => {
              const book = books.find((item) => item.id === id);
              if (book === undefined) return null;
              return (
                <li key={id}>
                  <button type="button" onClick={() => onOpenBook(id)} className="press flex min-h-10 w-full items-center gap-2 text-left text-[13.5px]">
                    <span className="min-w-0 flex-1 truncate text-foreground">{book.title}{book.percent !== null ? <span className="text-muted-foreground"> · {Math.round(book.percent)}%</span> : null}</span>
                    <span className="shrink-0 text-muted-foreground">{formatMinutes(seconds)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

/** Kệ 5 · Ghi chú sách đáng quan tâm. */
export function BookNotes({ notes, onShelf, isWide, onOpenAt, onOpenAll }: { notes: readonly Note[]; onShelf: ReadonlySet<string>; isWide: boolean; onOpenAt: (note: Note) => void; onOpenAll: () => void }) {
  const ranked = useMemo(() => rankBookNotes(notes), [notes]);
  if (ranked.length === 0) return null;
  const shown = ranked.slice(0, isWide ? 3 : 2);
  return (
    <Card data-book-notes="">
      <Label>Ghi chú sách đáng quan tâm</Label>
      <ul className="mt-2 space-y-3">
        {shown.map((note) => {
          const excerpt = note.blocks[0]?.text.trim() ?? note.title;
          const mine = ownWords(note);
          const gone = note.bookRecordId === null || !onShelf.has(note.bookRecordId);
          return (
            <li key={note.id} data-book-note={note.id}>
              <p className="border-l-2 border-personal/50 pl-3 text-[14px] italic leading-snug text-foreground line-clamp-3">{excerpt}</p>
              {mine !== "" ? <p className="mt-1 text-[13.5px] leading-snug text-foreground line-clamp-2">{mine}</p> : null}
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground">
                {note.pinnedAt !== null ? <span aria-label="Đã ghim">📌</span> : null}
                <span className="truncate">{note.bookTitle ?? "Sách"}{note.title !== "" && note.title !== excerpt ? ` · ${note.title}` : ""}</span>
                {gone ? <span>· Sách đã bỏ khỏi kệ</span> : (
                  <button type="button" onClick={() => onOpenAt(note)} className="press font-medium text-personal">· Mở lại đoạn này ›</button>
                )}
              </p>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={onOpenAll} className="press mt-2 text-[13px] font-medium text-personal">Mọi ghi chú sách ›</button>
    </Card>
  );
}

/**
 * AVORA-94B · D2 — kệ 5 on a computer: the books as one compact card (`SÁCH n` + small covers),
 * as in Ke2-Ke5-So-Lieu.png. The full shelf with Thư viện mở opens from `Kệ sách · Thư viện mở ›`.
 */
export function BooksCard({ books, onOpenBook, onOpenShelf }: { books: readonly { id: string; title: string }[]; onOpenBook: (id: string) => void; onOpenShelf: () => void }) {
  return (
    <Card data-books-card="">
      <div className="flex items-baseline justify-between gap-3">
        <Label>Sách {books.length}</Label>
        <button type="button" onClick={onOpenShelf} className="press text-[12.5px] font-semibold text-personal">Kệ sách · Thư viện mở ›</button>
      </div>
      {books.length === 0 ? (
        <p className="py-2 text-[13.5px] text-muted-foreground">Kệ còn trống — chọn một cuốn ở Thư viện mở.</p>
      ) : (
        <ul className="mt-2.5 flex flex-wrap gap-2.5">
          {books.slice(0, 12).map((book) => (
            <li key={book.id}>
              <button
                type="button"
                onClick={() => onOpenBook(book.id)}
                aria-label={`Đọc ${book.title}`}
                title={book.title}
                className="press block h-[58px] w-[40px] rounded-[3px] shadow-sm ring-1 ring-black/10"
                style={{ backgroundColor: coverColor(book.title) }}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
