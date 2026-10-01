import { CalendarDays, ChevronLeft, ChevronRight, Flag, Loader2, MapPin, MessagesSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";

import { FadeIn } from "@/components/tasks/FadeIn";
import { ownerStripeClass, TaskOwnerLine } from "@/components/tasks/TaskOwner";
import { useTaskOwnership } from "@/lib/use-task-owner";
import { useAuth } from "@/lib/auth";
import {
  CALENDAR_MODES,
  calendarModeOption,
  daysBetween,
  isSameMonth,
  longDayLabel,
  monthGrid,
  rangeContains,
  rangeFor,
  rangeLabel,
  shiftAnchor,
  startOfWeek,
  WEEKDAY_SHORT,
  yearMonths,
  type CalendarMode,
} from "@/lib/calendar-view";
import { hasExternalLayer, orderDayEntries, type CalendarLayerEntry } from "@/lib/calendar-layers";
import { isInRange } from "@/lib/date-field";
import { addDaysIso } from "@/lib/task-schedule";
import { calendarProjection, type CalendarDay, type CalendarEntry } from "@/lib/task-hub";
import type { TaskItem } from "@/lib/tasks";
import { useTasksInRange } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function dayNumber(iso: string): number {
  return Number.parseInt(iso.slice(8, 10), 10);
}

const isDone = (entry: CalendarEntry): boolean => entry.task.status === "done";

/** The two shapes, told apart by colour AND icon so neither depends on colour vision alone. */
function EntryIcon({ entry }: { entry: CalendarEntry }) {
  return entry.kind === "block" ? (
    <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={1.9} aria-hidden="true" />
  ) : (
    <Flag className="h-3.5 w-3.5 shrink-0 text-task-due-soon" strokeWidth={1.9} aria-hidden="true" />
  );
}

/** A tiny sign in a grid cell: a filled pill for an Event, a thin bar for a deadline. */
function CellMark({ entry }: { entry: CalendarEntry }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block h-1 rounded-full",
        entry.kind === "block" ? "w-3 bg-primary" : "w-2 bg-task-due-soon",
        isDone(entry) && "opacity-40",
      )}
    />
  );
}

/** One row of a day: who it belongs to at a glance (AVORA-59 · B) and a tap that opens it. */
function CalendarRow({
  entry,
  isCompact,
  isOpen,
  onTap,
}: {
  entry: CalendarEntry;
  isCompact: boolean;
  isOpen: boolean;
  onTap: () => void;
}) {
  const owner = useTaskOwnership(entry.task);
  return (
    <button
      type="button"
      onClick={onTap}
      aria-expanded={isOpen}
      data-calendar-kind={entry.kind}
      data-task-mine={owner.isMine ? "true" : "false"}
      className={cn(
        "press flex w-full items-center gap-3 text-left transition-colors hover:bg-accent/30",
        isCompact ? "min-h-10 px-3 py-1.5" : "min-h-12 px-4 py-2.5",
        ownerStripeClass(owner.isMine),
        entry.kind === "block" && "bg-primary/[0.06]",
      )}
    >
      <EntryIcon entry={entry} />
      <span className="tabular w-[84px] shrink-0 text-[12px] text-muted-foreground">{entryTime(entry)}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[14px]", isDone(entry) ? "text-muted-foreground line-through" : "font-medium text-foreground")}>
          {entry.task.title}
        </span>
        <TaskOwnerLine task={entry.task} ownership={owner} />
      </span>
    </button>
  );
}

function entryTime(entry: CalendarEntry): string {
  if (entry.kind === "block") return entry.endAt !== null ? `${clock(entry.startAt)} – ${clock(entry.endAt)}` : clock(entry.startAt);
  return entry.time ?? "Cả ngày";
}

/**
 * One day's list. Tapping a row opens its read-only card — the calendar never edits; the card
 * only points to where the work was agreed.
 */
function DayList({
  day,
  today,
  onOpenContext,
  external,
  limit,
  moreHref,
}: {
  day: CalendarDay;
  today: string;
  onOpenContext?: (task: TaskItem) => void;
  /** Lịch khác for this day — read-only, listed after Avora's own work. */
  external: readonly CalendarLayerEntry[];
  /** Compact calendar: at most this many rows, then "+N việc khác". */
  limit?: number;
  /** Compact calendar: where "Mở ngày này trong Lịch" goes (already carrying the way back). */
  moreHref?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const allOthers = orderDayEntries(external.filter((entry) => entry.layer === "external" && entry.day === day.day));
  const shownEntries = limit === undefined ? day.entries : day.entries.slice(0, limit);
  const others = limit === undefined ? allOthers : allOthers.slice(0, Math.max(0, limit - shownEntries.length));
  const hidden = day.entries.length + allOthers.length - shownEntries.length - others.length;
  const isCompact = limit !== undefined;

  return (
    <section aria-label={`Việc ngày ${longDayLabel(day.day, today)}`} className="rounded-[12px] border border-border bg-card">
      <p className={cn("border-b border-border font-semibold", isCompact ? "px-3 py-2 text-[12.5px]" : "px-4 py-2.5 text-[13px]", day.day === today ? "text-primary" : "text-foreground")}>
        {longDayLabel(day.day, today)}
      </p>
      {day.entries.length === 0 && others.length === 0 ? (
        <p className={cn("text-muted-foreground", isCompact ? "px-3 py-2.5 text-[12.5px]" : "px-4 py-4 text-[13.5px]")}>
          {isCompact ? "Ngày này trống." : "Ngày này trống — không có hạn chót hay sự kiện nào."}
        </p>
      ) : shownEntries.length === 0 ? null : (
        <ul>
          {shownEntries.map((entry) => {
            const isOpen = openId === entry.task.id;
            return (
              <li key={`${entry.kind}-${entry.task.id}`} className="border-t border-border first:border-t-0">
                <CalendarRow
                  entry={entry}
                  isCompact={isCompact}
                  isOpen={isOpen}
                  // ADR-038: a tap opens the task itself, where its owner can act on it.
                  onTap={() => (onOpenContext !== undefined ? onOpenContext(entry.task) : setOpenId(isOpen ? null : entry.task.id))}
                />
                {isOpen && onOpenContext === undefined ? (
                  <FadeIn className="space-y-2 bg-secondary/30 px-4 pb-3 pt-2">
                    <p className="text-[12px] text-muted-foreground">
                      {entry.kind === "block" ? (entry.task.requiresPresence ? "Sự kiện — cần bạn có mặt" : "Sự kiện") : "Hạn chót"}
                      {isDone(entry) ? " · Đã xong" : ""}
                      {entry.kind === "block" && entry.task.location !== null ? ` · ${entry.task.location}` : ""}
                    </p>
                    {entry.task.description.trim() !== "" ? (
                      <p className="line-clamp-3 whitespace-pre-wrap text-[13px] leading-5 text-foreground/85">{entry.task.description}</p>
                    ) : null}
                    {onOpenContext !== undefined ? (
                      <button
                        type="button"
                        onClick={() => onOpenContext(entry.task)}
                        className="press flex h-10 items-center gap-1.5 rounded-[10px] border border-border bg-card px-3 text-[13px] font-medium text-foreground hover:bg-secondary"
                      >
                        <MessagesSquare className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                        {entry.task.conversationId !== null || entry.task.contextSnapshot !== null ? "Xem trong ngữ cảnh" : "Mở trong Nhiệm vụ"}
                      </button>
                    ) : (
                      <p className="text-[12px] text-task-idle">Chỉ xem — muốn sửa, mở việc này ở Nhiệm vụ.</p>
                    )}
                  </FadeIn>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {others.length > 0 ? (
        <div className="border-t border-border">
          <p className="px-4 pb-1 pt-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Lịch khác</p>
          <ul>
            {others.map((entry) => (
              <li key={entry.id} className="flex min-h-11 items-start gap-3 px-4 py-2 text-muted-foreground">
                <span className="tabular w-[84px] shrink-0 text-[12px]">
                  {entry.startTime === null ? "Cả ngày" : entry.endTime !== null ? `${entry.startTime} – ${entry.endTime}` : entry.startTime}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px]">{entry.title}</span>
                  <span className="block truncate text-[12px]">
                    {entry.where !== null ? `${entry.where} · ` : ""}
                    {entry.sourceName}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {isCompact && (hidden > 0 || moreHref !== undefined) ? (
        <p className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-[12.5px] text-muted-foreground">
          {hidden > 0 ? <span className="tabular">+{hidden} việc khác</span> : null}
          {hidden > 0 && moreHref !== undefined ? <span aria-hidden="true">·</span> : null}
          {moreHref !== undefined ? (
            <Link to={moreHref} className="font-medium text-foreground underline-offset-2 hover:underline">
              Mở ngày này trong Lịch
            </Link>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

function MonthGrid({
  anchor,
  today,
  byDay,
  selected,
  isPickable,
  onSelect,
  compact = false,
  dense = false,
  range = null,
  external = [],
  onKeyMove,
}: {
  /** The compact Lịch (Đợt gộp 2 · A3): 40px cells (44px under a finger), number + up to 3 dots. */
  dense?: boolean;
  anchor: string;
  today: string;
  byDay: Map<string, CalendarDay>;
  selected: string | null;
  isPickable: (day: string) => boolean;
  onSelect: (day: string) => void;
  compact?: boolean;
  /** A range being picked: the days between are tinted. */
  range?: { from: string; to: string } | null;
  external?: readonly CalendarLayerEntry[];
  onKeyMove?: (event: KeyboardEvent<HTMLButtonElement>, day: string) => void;
}) {
  const weeks = useMemo(() => monthGrid(anchor), [anchor]);
  const externalCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of external) if (entry.layer === "external") counts.set(entry.day, (counts.get(entry.day) ?? 0) + 1);
    return counts;
  }, [external]);
  return (
    <div role="grid" aria-label={rangeLabel("month", anchor, today)}>
      <div role="row" className="grid grid-cols-7">
        {WEEKDAY_SHORT.map((label) => (
          <span key={label} role="columnheader" className={cn("text-center font-medium text-muted-foreground", compact ? "pb-0.5 text-[9.5px]" : "pb-1.5 text-[11.5px]")}>
            {compact ? label.slice(-1) : label}
          </span>
        ))}
      </div>
      {weeks.map((week) => (
        <div role="row" key={week[0]} className="grid grid-cols-7">
          {week.map((day) => {
            const entries = byDay.get(day)?.entries ?? [];
            const inMonth = isSameMonth(day, anchor);
            const isToday = day === today;
            const isSelected = day === selected;
            const pickable = isPickable(day);
            const inRange = isInRange(day, range);
            const outside = externalCount.get(day) ?? 0;
            if (compact) {
              return (
                <span key={day} role="gridcell" className="flex h-5 items-center justify-center">
                  {inMonth ? (
                    <span
                      className={cn(
                        "tabular flex h-4 w-4 items-center justify-center rounded-full text-[9.5px]",
                        isToday ? "bg-foreground font-semibold text-background" : entries.length > 0 ? "font-semibold text-primary" : "text-muted-foreground",
                      )}
                    >
                      {dayNumber(day)}
                    </span>
                  ) : null}
                </span>
              );
            }
            return (
              <span key={day} role="gridcell" aria-selected={isSelected} className={cn("p-0.5", inRange && "bg-primary/[0.08]")}>
                <button
                  type="button"
                  data-day={day}
                  tabIndex={day === anchor ? 0 : -1}
                  disabled={!pickable}
                  onClick={() => onSelect(day)}
                  onKeyDown={onKeyMove === undefined ? undefined : (event) => onKeyMove(event, day)}
                  aria-label={`${longDayLabel(day, today)}${entries.length > 0 ? `, ${entries.length} mục` : ", trống"}`}
                  className={cn(
                    "press flex w-full flex-col items-center rounded-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-35",
                    dense ? "h-10 gap-0.5 pt-1 [@media(pointer:coarse)]:h-11" : "h-14 gap-1 pt-1.5 sm:h-16",
                    isSelected ? "bg-foreground/[0.07] ring-1 ring-foreground/25" : "hover:bg-accent/40",
                  )}
                >
                  <span
                    className={cn(
                      "tabular flex items-center justify-center rounded-full",
                      dense ? "h-6 w-6 text-[12.5px]" : "h-6 w-6 text-[13px]",
                      isToday ? "bg-foreground font-semibold text-background" : inMonth ? "text-foreground" : "text-task-idle",
                    )}
                  >
                    {dayNumber(day)}
                  </span>
                  <span className="flex flex-wrap items-center justify-center gap-0.5 px-1">
                    {entries.slice(0, 3).map((entry) => (
                      <CellMark key={`${entry.kind}-${entry.task.id}`} entry={entry} />
                    ))}
                    {entries.length > 3 && !dense ? <span className="text-[9px] leading-none text-muted-foreground">+{entries.length - 3}</span> : null}
                    {/* Lịch khác: one faint neutral ring, drawn after (under) Avora's marks. */}
                    {outside > 0 ? <span aria-hidden="true" className="block h-1.5 w-1.5 rounded-full border border-muted-foreground/50 opacity-55" /> : null}
                  </span>
                </button>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function WeekStrip({
  anchor,
  today,
  byDay,
  isPickable,
  onSelect,
  dense = false,
}: {
  anchor: string;
  today: string;
  byDay: Map<string, CalendarDay>;
  isPickable: (day: string) => boolean;
  onSelect: (day: string) => void;
  dense?: boolean;
}) {
  const from = startOfWeek(anchor);
  const days = daysBetween(from, rangeFor("week", anchor).to);
  return (
    <div className="grid grid-cols-7 gap-1">
      {days.map((day, index) => {
        const entries = byDay.get(day)?.entries ?? [];
        const blocks = entries.filter((entry) => entry.kind === "block").length;
        const markers = entries.length - blocks;
        const isSelected = day === anchor;
        return (
          <button
            key={day}
            type="button"
            disabled={!isPickable(day)}
            onClick={() => onSelect(day)}
            aria-pressed={isSelected}
            aria-label={`${longDayLabel(day, today)}${entries.length > 0 ? `, ${blocks} sự kiện, ${markers} hạn chót` : ", trống"}`}
            className={cn(
              "press flex flex-col items-center rounded-[12px] border px-1 transition-colors disabled:opacity-35",
              dense ? "min-h-[64px] gap-1 py-1.5" : "min-h-[88px] gap-1.5 py-2",
              isSelected ? "border-foreground/30 bg-foreground/[0.06]" : "border-border bg-card hover:bg-accent/30",
            )}
          >
            <span className="text-[11px] font-medium text-muted-foreground">{WEEKDAY_SHORT[index]}</span>
            <span className={cn("tabular flex h-7 w-7 items-center justify-center rounded-full text-[14px]", day === today ? "bg-foreground font-semibold text-background" : "text-foreground")}>
              {dayNumber(day)}
            </span>
            {blocks > 0 ? <span className="tabular rounded-full bg-primary/15 px-1.5 text-[10.5px] font-semibold text-primary">{blocks}</span> : null}
            {markers > 0 ? <span className="tabular rounded-full bg-task-due-soon/15 px-1.5 text-[10.5px] font-semibold text-task-due-soon">{markers}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export type CalendarViewProps = {
  mode: CalendarMode;
  /** The day in focus. Month/week/year are drawn around it; its own list sits underneath. */
  anchor: string;
  today: string;
  onModeChange: (mode: CalendarMode) => void;
  onAnchorChange: (day: string) => void;
  /** Present on the full Lịch screen only. Absent means a pure view with no way out of it. */
  onOpenContext?: (task: TaskItem) => void;
  /**
   * Picking a deadline for a task form. When set, tapping a day hands it back instead of only
   * selecting it, and days before today cannot be picked — a deadline cannot be in the past.
   */
  onPickDay?: (day: string) => void;
  /** Which of the four views to offer. Defaults to all four. */
  modes?: readonly CalendarMode[];
  /** Which days a picker accepts (AVORA-39 / Phần 2). Defaults to "today onwards" while picking. */
  canPickDay?: (day: string) => boolean;
  /** The guide line while picking, when the default "từ hôm nay trở đi" is not the rule. */
  pickHint?: string;
  /** A range being picked, tinted in the month grid. */
  highlightRange?: { from: string; to: string } | null;
  /** Tapping the month title opens the quick year → month choice. */
  onTitleClick?: () => void;
  /** Other calendars the person chose to show. None exist yet; always read-only. */
  externalEntries?: readonly CalendarLayerEntry[];
  /**
   * "compact" (Đợt gộp 2 · A3): the quick-look and date-picker Lịch — height follows content,
   * small cells, at most 4 rows for the chosen day. The full Lịch screen keeps "full".
   */
  density?: "full" | "compact";
  /** Compact: where "Mở ngày này trong Lịch" goes for a given day. */
  dayHref?: (day: string) => string;
  /** AVORA-60 · B: keep only some tasks (e.g. those shared with one person). */
  taskFilter?: (task: TaskItem) => boolean;
};

/**
 * Lịch — Calendar = Projection. Every mark is a task read from `tasks` for the days on screen;
 * nothing here is stored and nothing here edits. An Event (`requires_presence`) is a primary
 * block with a pin; a deadline is an amber marker with a flag.
 */
export function CalendarView({
  mode,
  anchor,
  today,
  onModeChange,
  onAnchorChange,
  onOpenContext,
  onPickDay,
  modes,
  canPickDay,
  pickHint,
  highlightRange = null,
  onTitleClick,
  externalEntries = [],
  density = "full",
  dayHref,
  taskFilter,
}: CalendarViewProps) {
  const isCompact = density === "compact";
  const { user } = useAuth();
  const range = useMemo(() => rangeFor(mode, anchor), [mode, anchor]);
  const { data: tasks, isLoading, isError, refetch } = useTasksInRange(range.from, range.to);

  const days = useMemo(() => {
    const span = daysBetween(range.from, range.to).length;
    const shown = taskFilter === undefined ? (tasks ?? []) : (tasks ?? []).filter(taskFilter);
    return calendarProjection(shown, user?.id, range.from, span, { includeDone: true });
  }, [tasks, user?.id, range.from, range.to, taskFilter]);
  const byDay = useMemo(() => new Map<string, CalendarDay>(days.map((day) => [day.day, day])), [days]);
  const selectedDay: CalendarDay = byDay.get(anchor) ?? { day: anchor, entries: [] };
  const offered = CALENDAR_MODES.filter((option) => modes === undefined || modes.includes(option.id));
  const isPicking = onPickDay !== undefined;
  const isPickable = (day: string): boolean => (canPickDay !== undefined ? canPickDay(day) : !isPicking || day >= today);

  const select = (day: string): void => {
    onAnchorChange(day);
    onPickDay?.(day);
  };

  /*
   * Keyboard: arrows walk the days, Home/End the week, Enter/Space pick (native button click).
   * Focus follows the anchor once the grid has redrawn around it.
   */
  const gridRef = useRef<HTMLDivElement | null>(null);
  const wantsFocusRef = useRef<boolean>(false);
  useEffect(() => {
    if (!wantsFocusRef.current) return;
    wantsFocusRef.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${anchor}"]`)?.focus();
  }, [anchor, tasks]);
  const moveByKey = (event: KeyboardEvent<HTMLButtonElement>, day: string): void => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    wantsFocusRef.current = true;
    onAnchorChange(addDaysIso(day, step));
  };

  return (
    <div className={isCompact ? "space-y-2" : "space-y-3"}>
      {/* The selector stays put while the grid scrolls under it. */}
      <div className={cn("sticky top-0 z-10 -mx-1 bg-background/95 px-1 backdrop-blur-sm", isCompact ? "pb-1" : "pb-2 pt-1")}>
        {offered.length > 1 ? (
          <div
            role="tablist"
            aria-label="Chế độ xem lịch"
            className={cn("grid border border-border bg-card p-0.5", isCompact ? "mx-auto w-40 rounded-[10px]" : "rounded-[12px] p-1")}
            style={{ gridTemplateColumns: `repeat(${offered.length}, minmax(0, 1fr))` }}
          >
            {offered.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={mode === option.id}
                onClick={() => onModeChange(option.id)}
                className={cn(
                  "press rounded-[9px] transition-colors",
                  isCompact ? "min-h-8 text-[12.5px]" : "min-h-10 text-[13.5px]",
                  mode === option.id ? "bg-foreground font-semibold text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        {isCompact ? null : (
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            {isPicking ? (pickHint ?? "Chạm một ngày để điền vào ô hạn — từ hôm nay trở đi.") : calendarModeOption(mode).description}
          </p>
        )}

        <div className={cn("flex items-center gap-1", isCompact ? "mt-1" : "mt-2")}>
          <button type="button" onClick={() => onAnchorChange(shiftAnchor(mode, anchor, -1))} aria-label="Lùi lại" className="press flex h-10 w-10 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground">
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          </button>
          {onTitleClick !== undefined ? (
            <button
              type="button"
              onClick={onTitleClick}
              aria-label={`${rangeLabel(mode, anchor, today)} — chọn năm và tháng`}
              className="press min-h-10 min-w-0 flex-1 truncate rounded-[10px] text-center text-[15px] font-semibold text-foreground hover:bg-secondary"
              aria-live="polite"
            >
              {rangeLabel(mode, anchor, today)}
            </button>
          ) : (
            <h3 className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold text-foreground" aria-live="polite">
              {rangeLabel(mode, anchor, today)}
            </h3>
          )}
          <button type="button" onClick={() => onAnchorChange(shiftAnchor(mode, anchor, 1))} aria-label="Tới trước" className="press flex h-10 w-10 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground">
            <ChevronRight className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          </button>
          {!rangeContains(mode, anchor, today) || anchor !== today ? (
            <button type="button" onClick={() => onAnchorChange(today)} className="press ml-1 flex h-10 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[12.5px] font-medium text-foreground hover:bg-secondary">
              <CalendarDays className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              Hôm nay
            </button>
          ) : null}
        </div>
      </div>

      <div className={cn("flex items-center gap-4 text-[11.5px] text-muted-foreground", isCompact && "hidden")} aria-hidden="true">
        <span className="flex items-center gap-1.5"><span className="h-1 w-3 rounded-full bg-primary" /> Sự kiện</span>
        <span className="flex items-center gap-1.5"><span className="h-1 w-2 rounded-full bg-task-due-soon" /> Hạn chót</span>
        {hasExternalLayer(externalEntries) ? (
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full border border-muted-foreground/50 opacity-55" /> Lịch khác</span>
        ) : null}
        {isLoading && tasks !== undefined ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" /> : null}
      </div>

      {/* One fixed height for every view: switching Ngày/Tuần/Tháng/Năm never makes the page jump;
          whatever does not fit scrolls inside. */}
      <div className={isCompact ? "" : "h-[min(560px,62vh)] overflow-y-auto overscroll-contain pr-0.5"}>
      {isError ? (
        <div className="rounded-[12px] border border-border bg-card px-4 py-4 text-[13.5px] text-muted-foreground">
          Chưa tải được lịch.{" "}
          <button type="button" onClick={() => void refetch()} className="font-medium text-foreground underline underline-offset-2">
            Thử lại
          </button>
        </div>
      ) : tasks === undefined ? (
        <div className="flex justify-center py-12" role="status" aria-label="Đang tải lịch">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <FadeIn key={`${mode}-${range.from}`} className="space-y-3">
          {mode === "month" ? (
            <div ref={gridRef} className={cn("rounded-[14px] border border-border bg-card", isCompact ? "p-1" : "p-2")}>
              <MonthGrid
                dense={isCompact}
                anchor={anchor}
                today={today}
                byDay={byDay}
                selected={anchor}
                isPickable={isPickable}
                onSelect={select}
                range={highlightRange}
                external={externalEntries}
                onKeyMove={moveByKey}
              />
            </div>
          ) : null}

          {mode === "week" ? <WeekStrip anchor={anchor} today={today} byDay={byDay} isPickable={isPickable} onSelect={select} dense={isCompact} /> : null}

          {mode === "year" ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {yearMonths(anchor).map((month) => {
                const count = daysBetween(month, rangeFor("month", month).to)
                  .filter((day) => isSameMonth(day, month))
                  .reduce((sum, day) => sum + (byDay.get(day)?.entries.length ?? 0), 0);
                return (
                  <button
                    key={month}
                    type="button"
                    onClick={() => {
                      onAnchorChange(isSameMonth(month, today) ? today : month);
                      onModeChange("month");
                    }}
                    aria-label={`${rangeLabel("month", month, today)}, ${count} mục`}
                    className={cn(
                      "press rounded-[12px] border bg-card p-2 text-left transition-colors hover:bg-accent/30",
                      isSameMonth(month, today) ? "border-foreground/30" : "border-border",
                    )}
                  >
                    <span className="flex items-baseline justify-between px-0.5 pb-1">
                      <span className="text-[12.5px] font-semibold text-foreground">Tháng {dayNumber(`0000-00-${month.slice(5, 7)}`)}</span>
                      {count > 0 ? <span className="tabular text-[11px] text-muted-foreground">{count}</span> : null}
                    </span>
                    <MonthGrid anchor={month} today={today} byDay={byDay} selected={null} isPickable={() => false} onSelect={() => undefined} compact />
                  </button>
                );
              })}
            </div>
          ) : null}

          {mode !== "year" ? (
            <DayList
              key={anchor}
              day={selectedDay}
              today={today}
              onOpenContext={onOpenContext}
              external={externalEntries}
              limit={isCompact ? 4 : undefined}
              moreHref={isCompact && !isPicking && dayHref !== undefined ? dayHref(anchor) : undefined}
            />
          ) : null}
        </FadeIn>
      )}
      </div>
    </div>
  );
}
