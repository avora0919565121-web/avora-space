import { ChevronDown, ChevronLeft, ChevronRight, Maximize2, Trash2, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { useLongPress } from "@/hooks/use-long-press";
import { formatClock } from "@/lib/chat";
import { DAY_ROW_PX, groupByDay, LINE_ROW_PX, readFoldedDays, writeFoldedDays } from "@/lib/journal-lines";
import { cn } from "@/lib/utils";
import { BackClosesBinding } from "@/lib/use-back-closes";

/** One line of a notebook-style list (AVORA-70). */
export type DayLine = {
  id: string;
  at: string;
  /** Null = plain words, no icon. */
  icon: LucideIcon | null;
  title: string;
  /** Small words after the title: `1,2 MB`, `Đang làm`. */
  meta?: string;
  /** A square thumbnail exactly as tall as the text — never a taller row. */
  thumbUrl?: string | null;
  /** The Nhật ký entry this line deletes; null = nothing here can be deleted. */
  entryId: string | null;
  /** Long words, an image or a PDF: offers `⤢ Xem toàn màn`. */
  isLong?: boolean;
  isDone?: boolean;
};

const SWIPE_OPEN_PX = 84;

/**
 * The notebook frame shared by Nhật ký của tôi, File của tôi, Liên kết and Nguồn tạo việc
 * (AVORA-70): days as low sticky rows (warm clay wash) that fold, one line per entry — all the
 * same height as a row of the conversation list — hairlines edge to edge, the time at the right.
 * A tap opens the line in place (one at a time); long ones also open full screen. Holding a line
 * opens the message menu; on a phone, sliding a line left offers `Xoá`.
 */
export function DayLineList({
  lines,
  foldKey,
  label,
  openId,
  onOpenChange,
  renderDetail,
  renderFull,
  flashId = null,
  menuFor,
  isSelecting = false,
  selected,
  onSelect,
  onSwipeDelete,
  idPrefix = "line-",
  empty,
}: {
  lines: readonly DayLine[];
  /** localStorage key for the days folded on this device. */
  foldKey: string;
  label: string;
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  renderDetail: (line: DayLine) => ReactNode;
  renderFull?: (line: DayLine) => ReactNode;
  /** A search result / jump target: opened and lightly lit. */
  flashId?: string | null;
  /** The message menu for a line, opened by holding it (or its `…`). */
  menuFor?: (line: DayLine, open: boolean, onOpenChange: (open: boolean) => void) => ReactNode;
  isSelecting?: boolean;
  selected?: ReadonlySet<string>;
  onSelect?: (entryIds: readonly string[], on: boolean) => void;
  onSwipeDelete?: (line: DayLine) => void;
  /** `message-` in Nhật ký so search and `Tới tin gốc` land on the line. */
  idPrefix?: string;
  empty?: ReactNode;
}) {
  const [folded, setFolded] = useState<Set<string>>(() => readFoldedDays(foldKey));
  const [fullId, setFullId] = useState<string | null>(null);
  const groups = groupByDay(lines);

  useEffect(() => {
    if (flashId === null || !lines.some((line) => line.id === flashId)) return;
    const day = groups.find((group) => group.items.some((line) => line.id === flashId))?.key;
    if (day !== undefined && folded.has(day)) {
      setFolded((current) => {
        const next = new Set(current);
        next.delete(day);
        writeFoldedDays(foldKey, next);
        return next;
      });
    }
    onOpenChange(flashId);
    // Only when a new target arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashId]);

  const toggleDay = (key: string): void => {
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeFoldedDays(foldKey, next);
      return next;
    });
  };

  const fullLine = fullId === null ? undefined : lines.find((line) => line.id === fullId);
  const closeFull = (): void => {
    const id = fullId;
    setFullId(null);
    // `‹` comes back to exactly the line being read.
    window.setTimeout(() => document.getElementById(`${idPrefix}${id ?? ""}`)?.scrollIntoView({ block: "nearest" }), 30);
  };

  if (lines.length === 0) return <>{empty ?? null}</>;

  return (
    <div aria-label={label} data-day-lines="">
      {groups.map((group) => {
        const isFolded = folded.has(group.key);
        const dayEntries = group.items.map((line) => line.entryId).filter((id): id is string => id !== null);
        const allPicked = dayEntries.length > 0 && dayEntries.every((id) => selected?.has(id) === true);
        return (
          <section key={group.key} data-day={group.key}>
            <div
              style={{ height: DAY_ROW_PX }}
              className="sticky top-0 z-10 flex items-center gap-2 border-b border-personal/30 bg-personal-soft px-3 text-[13px] font-semibold text-personal-soft-foreground backdrop-blur-sm"
              data-day-row={group.key}
            >
              {isSelecting && dayEntries.length > 0 ? (
                <input
                  type="checkbox"
                  checked={allPicked}
                  onChange={(event) => onSelect?.(dayEntries, event.target.checked)}
                  aria-label={`Chọn cả ngày ${group.label}`}
                  className="h-[18px] w-[18px] accent-personal"
                />
              ) : null}
              <button
                type="button"
                onClick={() => toggleDay(group.key)}
                aria-expanded={!isFolded}
                className="press flex min-h-10 min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                {isFolded ? <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />}
                <span className="truncate">{group.label}</span>
                <span className="shrink-0 font-normal opacity-80">· {group.items.length} mục</span>
              </button>
            </div>
            {isFolded ? null : (
              <ul>
                {group.items.map((line) => (
                  <LineRow
                    key={line.id}
                    line={line}
                    domId={`${idPrefix}${line.id}`}
                    isOpen={openId === line.id}
                    isFlashed={flashId === line.id}
                    onToggle={() => onOpenChange(openId === line.id ? null : line.id)}
                    onFull={() => setFullId(line.id)}
                    detail={openId === line.id ? renderDetail(line) : null}
                    menuFor={menuFor}
                    isSelecting={isSelecting}
                    isPicked={line.entryId !== null && selected?.has(line.entryId) === true}
                    onPick={(on) => line.entryId !== null && onSelect?.([line.entryId], on)}
                    onSwipeDelete={onSwipeDelete}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {fullLine !== undefined ? (
        <div role="dialog" aria-modal="true" aria-label={fullLine.title} className="fixed inset-0 z-50 flex flex-col bg-background md:bg-black/30 md:p-8">
          <BackClosesBinding close={closeFull} />
          <div className="flex min-h-0 flex-1 flex-col bg-background md:mx-auto md:w-full md:max-w-3xl md:rounded-xl md:border md:border-border md:shadow-xl">
            <header className="flex items-center gap-2 border-b border-border px-2 pb-2 pt-[max(env(safe-area-inset-top),0.5rem)] md:pt-2">
              <button type="button" onClick={closeFull} aria-label="Quay lại" className="icon-btn h-11 w-11">
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">{fullLine.title}</p>
              <span className="tabular pr-2 text-[12.5px] text-muted-foreground">{formatClock(fullLine.at)}</span>
              <button type="button" onClick={closeFull} aria-label="Đóng" className="icon-btn hidden h-10 w-10 md:flex">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>
            <div className="min-h-0 flex-1 scroll-y px-4 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]">{(renderFull ?? renderDetail)(fullLine)}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LineRow({
  line,
  domId,
  isOpen,
  isFlashed,
  onToggle,
  onFull,
  detail,
  menuFor,
  isSelecting,
  isPicked,
  onPick,
  onSwipeDelete,
}: {
  line: DayLine;
  domId: string;
  isOpen: boolean;
  isFlashed: boolean;
  onToggle: () => void;
  onFull: () => void;
  detail: ReactNode;
  menuFor?: (line: DayLine, open: boolean, onOpenChange: (open: boolean) => void) => ReactNode;
  isSelecting: boolean;
  isPicked: boolean;
  onPick: (on: boolean) => void;
  onSwipeDelete?: (line: DayLine) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [offset, setOffset] = useState<number>(0);
  const swipeRef = useRef<{ x: number; y: number; decided: "swipe" | "scroll" | null; base: number } | null>(null);
  const canSwipe = onSwipeDelete !== undefined && line.entryId !== null && !isSelecting;
  const { onClick: _tap, ...hold } = useLongPress({
    onHold: () => setIsMenuOpen(true),
    pointerTypes: ["touch", "pen"],
    contextMenu: "after-hold",
    isEnabled: () => menuFor !== undefined && !isSelecting,
  });
  void _tap;

  const down = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      hold.onPointerDown(event);
      // K4 · 5: a start within 24 px of the left edge is the system's back swipe (ADR-062).
      if (canSwipe && event.pointerType === "touch" && event.clientX > 24) swipeRef.current = { x: event.clientX, y: event.clientY, decided: null, base: offset };
    },
    [hold, canSwipe, offset],
  );
  const move = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      hold.onPointerMove(event);
      const start = swipeRef.current;
      if (start === null) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (start.decided === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) start.decided = Math.abs(dx) > Math.abs(dy) * 1.5 ? "swipe" : "scroll";
      if (start.decided === "swipe") setOffset(Math.max(-SWIPE_OPEN_PX - 12, Math.min(0, start.base + dx)));
    },
    [hold],
  );
  const up = useCallback((): void => {
    hold.onPointerUp();
    const start = swipeRef.current;
    swipeRef.current = null;
    if (start?.decided === "swipe") setOffset((current) => (current < -SWIPE_OPEN_PX / 2 ? -SWIPE_OPEN_PX : 0));
  }, [hold]);

  return (
    <li id={domId} data-line={line.id} className={cn("relative scroll-mt-12 overflow-hidden border-b border-border", isFlashed && "bg-personal-soft")}>
      {canSwipe ? (
        <button
          type="button"
          tabIndex={offset === 0 ? -1 : 0}
          onClick={() => {
            setOffset(0);
            onSwipeDelete?.(line);
          }}
          style={{ width: SWIPE_OPEN_PX, height: LINE_ROW_PX }}
          className="absolute right-0 top-0 flex items-center justify-center bg-destructive text-[13.5px] font-semibold text-destructive-foreground"
        >
          Xoá
        </button>
      ) : null}
      <div
        {...hold}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{ transform: offset === 0 ? undefined : `translateX(${offset}px)`, minHeight: LINE_ROW_PX }}
        className={cn("no-callout group relative flex items-center gap-3 bg-background px-3 transition-transform", isOpen && "bg-secondary/40")}
      >
        {isSelecting ? (
          <input
            type="checkbox"
            checked={isPicked}
            disabled={line.entryId === null}
            onChange={(event) => onPick(event.target.checked)}
            aria-label={`Chọn: ${line.title}`}
            className="h-[18px] w-[18px] shrink-0 accent-personal disabled:opacity-30"
          />
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (offset !== 0) {
              setOffset(0);
              return;
            }
            if (isSelecting) {
              if (line.entryId !== null) onPick(!isPicked);
              return;
            }
            onToggle();
          }}
          aria-expanded={isOpen}
          data-line-toggle=""
          className="press flex min-h-[68px] min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          {line.thumbUrl != null ? (
            <img src={line.thumbUrl} alt="" className="h-[22px] w-[22px] shrink-0 rounded object-cover" />
          ) : line.icon !== null ? (
            <line.icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
          ) : null}
          <span className={cn("min-w-0 flex-1 truncate text-[15px]", line.isDone ? "text-muted-foreground line-through" : "text-foreground")}>{line.title}</span>
          {line.meta !== undefined ? <span className="shrink-0 text-[12.5px] text-muted-foreground">{line.meta}</span> : null}
          <span className="tabular shrink-0 text-[12.5px] text-muted-foreground">{formatClock(line.at)}</span>
        </button>
        {menuFor !== undefined && !isSelecting ? <span className="shrink-0">{menuFor(line, isMenuOpen, setIsMenuOpen)}</span> : null}
      </div>
      {isOpen && !isSelecting ? (
        <div className="border-t border-border/60 bg-secondary/20 px-4 pb-3 pt-3" data-line-detail={line.id}>
          {detail}
          {line.isLong === true ? (
            <button type="button" onClick={onFull} className="press mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-personal">
              <Maximize2 className="h-4 w-4" aria-hidden="true" /> Xem toàn màn
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** `Chọn` mode's bar: `Đã chọn N` · `Dọn dẹp (N)` · `Huỷ` (AVORA-70 · C). */
export function CleanupBar({ count, onCleanup, onCancel, isWorking }: { count: number; onCleanup: () => void; onCancel: () => void; isWorking: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4" data-cleanup-bar="">
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-2 py-2 shadow-lg backdrop-blur-sm">
        <span className="px-2 text-[13.5px] font-medium tabular-nums" aria-live="polite">
          Đã chọn {count}
        </span>
        <button
          type="button"
          disabled={count === 0 || isWorking}
          onClick={onCleanup}
          className="press flex h-10 items-center gap-1.5 rounded-full bg-destructive px-3.5 text-[13.5px] font-semibold text-destructive-foreground disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Dọn dẹp ({count})
        </button>
        <button type="button" onClick={onCancel} className="press flex h-10 items-center rounded-full px-3.5 text-[13.5px] font-medium text-muted-foreground hover:bg-accent/50">
          Huỷ
        </button>
      </div>
    </div>
  );
}
