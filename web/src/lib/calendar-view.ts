import { addDaysIso, addMonthsIso } from "@/lib/task-schedule";

/**
 * Lịch — the pure half: which days a view covers, how a month is laid out, and what the header
 * says. No Supabase and no React, so every view and the tests read the same arithmetic.
 *
 * Weeks start on Monday, the way a Vietnamese wall calendar is printed.
 */
export type CalendarMode = "day" | "week" | "month" | "year";

export type CalendarModeOption = {
  id: CalendarMode;
  /** What the address bar says: `/nhiem-vu?muc=lich&xem=<slug>`. */
  slug: string;
  label: string;
  /** The one line under the selector, saying what this view is for. */
  description: string;
};

export const CALENDAR_MODE_PARAM = "xem";
export const CALENDAR_DAY_PARAM = "ngay";

export const CALENDAR_MODES: readonly CalendarModeOption[] = [
  { id: "day", slug: "ngay", label: "Ngày", description: "Một ngày theo giờ: sự kiện trước, hạn chót sau." },
  { id: "week", slug: "tuan", label: "Tuần", description: "Bảy ngày từ thứ Hai — chạm một ngày để xem chi tiết." },
  { id: "month", slug: "thang", label: "Tháng", description: "Cả tháng trên một trang — chạm một ngày để xem chi tiết." },
  { id: "year", slug: "nam", label: "Năm", description: "Mười hai tháng nhìn một lượt — chạm một tháng để mở tháng đó." },
];

export const DEFAULT_CALENDAR_MODE: CalendarMode = "month";

/** Monday first. */
export const WEEKDAY_SHORT: readonly string[] = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const WEEKDAY_LONG: readonly string[] = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseCalendarMode(slug: string | null): CalendarMode {
  return CALENDAR_MODES.find((option) => option.slug === slug)?.id ?? DEFAULT_CALENDAR_MODE;
}

export function calendarModeSlug(mode: CalendarMode): string {
  return CALENDAR_MODES.find((option) => option.id === mode)?.slug ?? "thang";
}

export function calendarModeOption(mode: CalendarMode): CalendarModeOption {
  return CALENDAR_MODES.find((option) => option.id === mode) ?? CALENDAR_MODES[2];
}

/** A `YYYY-MM-DD` that is a real date, or null. `2026-02-30` is not a day. */
export function parseIsoDay(raw: string | null): string | null {
  if (raw === null || !ISO_DAY.test(raw)) return null;
  const [year, month, day] = raw.split("-").map((piece) => Number.parseInt(piece, 10));
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return raw;
}

function dateOf(iso: string): Date {
  const [year, month, day] = iso.split("-").map((piece) => Number.parseInt(piece, 10));
  return new Date(year, month - 1, day);
}

function isoOf(date: Date): string {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(iso: string): number {
  return (dateOf(iso).getDay() + 6) % 7;
}

export function startOfWeek(iso: string): string {
  return addDaysIso(iso, -weekdayIndex(iso));
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  return addDaysIso(addMonthsIso(startOfMonth(iso), 1), -1);
}

/** Every day from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to && out.length < 400; day = addDaysIso(day, 1)) out.push(day);
  return out;
}

/**
 * The days a view has to ask the database about, both ends included.
 *
 * A month asks for its whole grid — the trailing days of last month and the leading days of
 * next month are drawn too, and an empty cell there would be a lie about that day.
 */
export function rangeFor(mode: CalendarMode, anchor: string): { from: string; to: string } {
  switch (mode) {
    case "day":
      return { from: anchor, to: anchor };
    case "week": {
      const from = startOfWeek(anchor);
      return { from, to: addDaysIso(from, 6) };
    }
    case "month": {
      const from = startOfWeek(startOfMonth(anchor));
      const last = endOfMonth(anchor);
      return { from, to: addDaysIso(last, 6 - weekdayIndex(last)) };
    }
    case "year":
      return { from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` };
  }
}

/**
 * One step backwards or forwards in the unit the view is read in.
 *
 * The anchor is also the selected day, so it travels with the step: the 24th of this month
 * becomes the 24th of next month (clamped to month end), and its list stays on screen.
 */
export function shiftAnchor(mode: CalendarMode, anchor: string, delta: number): string {
  switch (mode) {
    case "day":
      return addDaysIso(anchor, delta);
    case "week":
      return addDaysIso(anchor, 7 * delta);
    case "month":
      return addMonthsIso(anchor, delta);
    case "year":
      return addMonthsIso(anchor, 12 * delta);
  }
}

/** The month as rows of seven days, Monday first, padded with the neighbouring months. */
export function monthGrid(anchor: string): string[][] {
  const { from, to } = rangeFor("month", anchor);
  const days = daysBetween(from, to);
  const weeks: string[][] = [];
  for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7));
  return weeks;
}

export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export function monthLabel(iso: string): string {
  const date = dateOf(iso);
  return `Tháng ${date.getMonth() + 1}, ${date.getFullYear()}`;
}

/** `Thứ Năm, 24 tháng 9` — with the year only when it is not this year. */
export function longDayLabel(iso: string, today: string): string {
  const date = dateOf(iso);
  const base = `${WEEKDAY_LONG[date.getDay()]}, ${date.getDate()} tháng ${date.getMonth() + 1}`;
  const prefix = iso === today ? "Hôm nay · " : "";
  return iso.slice(0, 4) === today.slice(0, 4) ? `${prefix}${base}` : `${prefix}${base}, ${date.getFullYear()}`;
}

/** What the header says for the range on screen. */
export function rangeLabel(mode: CalendarMode, anchor: string, today: string): string {
  switch (mode) {
    case "day":
      return longDayLabel(anchor, today);
    case "week": {
      const { from, to } = rangeFor("week", anchor);
      const a = dateOf(from);
      const b = dateOf(to);
      const sameMonth = a.getMonth() === b.getMonth();
      const left = sameMonth ? `${a.getDate()}` : `${a.getDate()} thg ${a.getMonth() + 1}`;
      return `${left} – ${b.getDate()} thg ${b.getMonth() + 1}, ${b.getFullYear()}`;
    }
    case "month":
      return monthLabel(anchor);
    case "year":
      return anchor.slice(0, 4);
  }
}

/** Whether a view already contains today — the "Hôm nay" button hides when it would do nothing. */
export function rangeContains(mode: CalendarMode, anchor: string, day: string): boolean {
  if (mode === "month") return isSameMonth(anchor, day);
  const { from, to } = rangeFor(mode, anchor);
  return day >= from && day <= to;
}

/** The twelve month starts of the anchor's year. */
export function yearMonths(anchor: string): string[] {
  const year = anchor.slice(0, 4);
  return Array.from({ length: 12 }, (_, index) => `${year}-${`${index + 1}`.padStart(2, "0")}-01`);
}

/** Local midnight at the start of `from` and the start of the day after `to`, as UTC instants. */
export function instantBounds(from: string, to: string): { startIso: string; endIso: string } {
  return {
    startIso: dateOf(from).toISOString(),
    endIso: dateOf(addDaysIso(to, 1)).toISOString(),
  };
}

export { isoOf as calendarIsoOf };
