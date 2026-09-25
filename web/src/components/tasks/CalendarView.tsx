import { CalendarDays, ChevronLeft, ChevronRight, Flag, Loader2, MapPin, MessagesSquare } from "lucide-react";
import { useMemo, useState } from "react";

import { FadeIn } from "@/components/tasks/FadeIn";
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
}: {
  day: CalendarDay;
  today: string;
  onOpenContext?: (task: TaskItem) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section aria-label={`Việc ngày ${longDayLabel(day.day, today)}`} className="rounded-[12px] border border-border bg-card">
      <p className={cn("border-b border-border px-4 py-2.5 text-[13px] font-semibold", day.day === today ? "text-primary" : "text-foreground")}>
        {longDayLabel(day.day, today)}
      </p>
      {day.entries.length === 0 ? (
        <p className="px-4 py-4 text-[13.5px] text-muted-foreground">Ngày này trống — không có hạn chót hay sự kiện nào.</p>
      ) : (
        <ul>
          {day.entries.map((entry) => {
            const isOpen = openId === entry.task.id;
            return (
              <li key={`${entry.kind}-${entry.task.id}`} className="border-t border-border first:border-t-0">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : entry.task.id)}
                  aria-expanded={isOpen}
                  data-calendar-kind={entry.kind}
                  className={cn(
                    "press flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/30",
                    entry.kind === "block" && "border-l-[3px] border-l-primary bg-primary/[0.06]",
                  )}
                >
                  <EntryIcon entry={entry} />
                  <span className="tabular w-[84px] shrink-0 text-[12px] text-muted-foreground">{entryTime(entry)}</span>
                  <span className={cn("min-w-0 flex-1 truncate text-[14px]", isDone(entry) ? "text-muted-foreground line-through" : "font-medium text-foreground")}>
                    {entry.task.title}
                  </span>
                </button>
                {isOpen ? (
                  <FadeIn className="space-y-2 bg-secondary/30 px-4 pb-3 pt-2">
                    <p className="text-[12px] text-muted-foreground">
                      {entry.kind === "block" ? "Sự kiện — cần bạn có mặt" : "Hạn chót"}
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
}: {
  anchor: string;
  today: string;
  byDay: Map<string, CalendarDay>;
  selected: string | null;
  isPickable: (day: string) => boolean;
  onSelect: (day: string) => void;
  compact?: boolean;
}) {
  const weeks = useMemo(() => monthGrid(anchor), [anchor]);
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
              <span key={day} role="gridcell" aria-selected={isSelected} className="p-0.5">
                <button
                  type="button"
                  disabled={!pickable}
                  onClick={() => onSelect(day)}
                  aria-label={`${longDayLabel(day, today)}${entries.length > 0 ? `, ${entries.length} mục` : ", trống"}`}
                  className={cn(
                    "press flex h-14 w-full flex-col items-center gap-1 rounded-[10px] pt-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-35 sm:h-16",
                    isSelected ? "bg-foreground/[0.07] ring-1 ring-foreground/25" : "hover:bg-accent/40",
                  )}
                >
                  <span
                    className={cn(
                      "tabular flex h-6 w-6 items-center justify-center rounded-full text-[13px]",
                      isToday ? "bg-foreground font-semibold text-background" : inMonth ? "text-foreground" : "text-task-idle",
                    )}
                  >
                    {dayNumber(day)}
                  </span>
                  <span className="flex flex-wrap items-center justify-center gap-0.5 px-1">
                    {entries.slice(0, 3).map((entry) => (
                      <CellMark key={`${entry.kind}-${entry.task.id}`} entry={entry} />
                    ))}
                    {entries.length > 3 ? <span className="text-[9px] leading-none text-muted-foreground">+{entries.length - 3}</span> : null}
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
}: {
  anchor: string;
  today: string;
  byDay: Map<string, CalendarDay>;
  isPickable: (day: string) => boolean;
  onSelect: (day: string) => void;
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
              "press flex min-h-[88px] flex-col items-center gap-1.5 rounded-[12px] border px-1 py-2 transition-colors disabled:opacity-35",
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
}: CalendarViewProps) {
  const { user } = useAuth();
  const range = useMemo(() => rangeFor(mode, anchor), [mode, anchor]);
  const { data: tasks, isLoading, isError, refetch } = useTasksInRange(range.from, range.to);

  const days = useMemo(() => {
    const span = daysBetween(range.from, range.to).length;
    return calendarProjection(tasks ?? [], user?.id, range.from, span, { includeDone: true });
  }, [tasks, user?.id, range.from, range.to]);
  const byDay = useMemo(() => new Map<string, CalendarDay>(days.map((day) => [day.day, day])), [days]);
  const selectedDay: CalendarDay = byDay.get(anchor) ?? { day: anchor, entries: [] };
  const offered = CALENDAR_MODES.filter((option) => modes === undefined || modes.includes(option.id));
  const isPicking = onPickDay !== undefined;
  const isPickable = (day: string): boolean => !isPicking || day >= today;

  const select = (day: string): void => {
    onAnchorChange(day);
    onPickDay?.(day);
  };

  return (
    <div className="space-y-3">
      {/* The selector stays put while the grid scrolls under it. */}
      <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 pb-2 pt-1 backdrop-blur-sm">
        {offered.length > 1 ? (
          <div role="tablist" aria-label="Chế độ xem lịch" className="grid rounded-[12px] border border-border bg-card p-1" style={{ gridTemplateColumns: `repeat(${offered.length}, minmax(0, 1fr))` }}>
            {offered.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={mode === option.id}
                onClick={() => onModeChange(option.id)}
                className={cn(
                  "press min-h-10 rounded-[9px] text-[13.5px] transition-colors",
                  mode === option.id ? "bg-foreground font-semibold text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          {isPicking ? "Chạm một ngày để điền vào ô hạn — từ hôm nay trở đi." : calendarModeOption(mode).description}
        </p>

        <div className="mt-2 flex items-center gap-1">
          <button type="button" onClick={() => onAnchorChange(shiftAnchor(mode, anchor, -1))} aria-label="Lùi lại" className="press flex h-10 w-10 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground">
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <h3 className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold text-foreground" aria-live="polite">
            {rangeLabel(mode, anchor, today)}
          </h3>
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

      <div className="flex items-center gap-4 text-[11.5px] text-muted-foreground" aria-hidden="true">
        <span className="flex items-center gap-1.5"><span className="h-1 w-3 rounded-full bg-primary" /> Sự kiện</span>
        <span className="flex items-center gap-1.5"><span className="h-1 w-2 rounded-full bg-task-due-soon" /> Hạn chót</span>
        {isLoading && tasks !== undefined ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" /> : null}
      </div>

      {/* One fixed height for every view: switching Ngày/Tuần/Tháng/Năm never makes the page jump;
          whatever does not fit scrolls inside. */}
      <div className="h-[min(560px,62vh)] overflow-y-auto overscroll-contain pr-0.5">
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
            <div className="rounded-[14px] border border-border bg-card p-2">
              <MonthGrid anchor={anchor} today={today} byDay={byDay} selected={anchor} isPickable={isPickable} onSelect={select} />
            </div>
          ) : null}

          {mode === "week" ? <WeekStrip anchor={anchor} today={today} byDay={byDay} isPickable={isPickable} onSelect={select} /> : null}

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

          {mode !== "year" ? <DayList key={anchor} day={selectedDay} today={today} onOpenContext={onOpenContext} /> : null}
        </FadeIn>
      )}
      </div>
    </div>
  );
}
