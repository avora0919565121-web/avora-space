import { addMonthsIso } from "@/lib/task-schedule";

/**
 * Lịch Avora as a date picker — the pure half (AVORA-39 / Phần 2).
 *
 * Every form that asks for a day goes through these, so labels, limits, ranges and the
 * `datetime-local` string the forms already store are worked out in one tested place. Values stay
 * exactly what the forms saved before (`YYYY-MM-DD`, `YYYY-MM-DDTHH:MM`), so no saving logic moves.
 */

/** Which days a field accepts: a deadline looks forward, a birthday back, a transaction either way. */
export type DateAllow = "future" | "any" | "past";

const WEEKDAY_LONG: readonly string[] = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

function dateOf(iso: string): Date {
  const [year, month, day] = iso.split("-").map((piece) => Number.parseInt(piece, 10));
  return new Date(year, month - 1, day);
}

function isoOf(date: Date): string {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

export function isIsoDay(value: string | null | undefined): value is string {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return false;
  return isoOf(dateOf(value)) === value;
}

function shiftDay(iso: string, days: number): string {
  const date = dateOf(iso);
  date.setDate(date.getDate() + days);
  return isoOf(date);
}

/** `Hôm nay · 27/09`, `Ngày mai · 28/09`, else `Thứ Tư, 30/09/2026`. Empty for no value. */
export function dateFieldLabel(value: string | null | undefined, today: string): string {
  if (!isIsoDay(value)) return "";
  const dm = `${value.slice(8, 10)}/${value.slice(5, 7)}`;
  if (value === today) return `Hôm nay · ${dm}`;
  if (value === shiftDay(today, 1)) return `Ngày mai · ${dm}`;
  return `${WEEKDAY_LONG[dateOf(value).getDay()]}, ${dm}/${value.slice(0, 4)}`;
}

/** Whether a day may be tapped, from `allow` and optional `min`/`max` (both inclusive). */
export function isDayAllowed(
  day: string,
  rule: { allow: DateAllow; today: string; min?: string | null; max?: string | null },
): boolean {
  if (rule.allow === "future" && day < rule.today) return false;
  if (rule.allow === "past" && day > rule.today) return false;
  if (isIsoDay(rule.min) && day < rule.min) return false;
  if (isIsoDay(rule.max) && day > rule.max) return false;
  return true;
}

/** The guide line under the calendar — "from today on" only when that is actually the rule. */
export function pickHint(allow: DateAllow, range: "start" | "end" | null): string {
  if (range === "start") return "Chạm ngày bắt đầu.";
  if (range === "end") return "Chạm ngày kết thúc — chọn ngày sớm hơn cũng được, AVORA tự đảo lại.";
  if (allow === "future") return "Chạm một ngày để chọn — từ hôm nay trở đi.";
  if (allow === "past") return "Chạm một ngày để chọn — đến hôm nay.";
  return "Chạm một ngày để chọn.";
}

/** A range picked in either order comes back earliest first. */
export function orderRange(a: string, b: string): { from: string; to: string } {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export function isInRange(day: string, range: { from: string; to: string } | null): boolean {
  return range !== null && isIsoDay(range.from) && isIsoDay(range.to) && day >= range.from && day <= range.to;
}

/** `2026-09-30T14:35` → date and time; anything unreadable → both empty. */
export function splitLocalDateTime(value: string | null | undefined): { date: string; time: string } {
  const match = typeof value === "string" ? LOCAL_DATETIME.exec(value) : null;
  if (match === null || !isIsoDay(match[1])) return { date: "", time: "" };
  return { date: match[1], time: match[2] };
}

/**
 * Back to `YYYY-MM-DDTHH:MM`, the string the forms already store. No date means no value; a date
 * with no time yet takes `fallbackTime` so a chosen day is never silently thrown away.
 */
export function joinLocalDateTime(date: string, time: string, fallbackTime = "09:00"): string {
  if (!isIsoDay(date)) return "";
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : fallbackTime;
  return `${date}T${clock}`;
}

/** "Phút khác": a whole number 0–59, else null (the old value is kept). */
export function parseMinute(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const minute = Number.parseInt(trimmed, 10);
  return minute >= 0 && minute <= 59 ? minute : null;
}

/** The years the quick year grid offers for a rule, newest last. */
export function yearChoices(allow: DateAllow, today: string, anchor: string): number[] {
  const thisYear = Number.parseInt(today.slice(0, 4), 10);
  const anchorYear = Number.parseInt(anchor.slice(0, 4), 10);
  const from = allow === "future" ? thisYear : Math.min(1900, anchorYear);
  const to = allow === "past" ? thisYear : Math.max(thisYear + 30, anchorYear);
  const out: number[] = [];
  for (let year = from; year <= to; year += 1) out.push(year);
  return out;
}

export type QuickRange = { id: string; label: string; from: string; to: string };

/** Tháng này · Tháng trước · Quý này · Năm nay, worked out from `today`. */
export function quickRanges(today: string): QuickRange[] {
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = shiftDay(addMonthsIso(monthStart, 1), -1);
  const lastStart = addMonthsIso(monthStart, -1);
  const lastEnd = shiftDay(monthStart, -1);
  const month = Number.parseInt(today.slice(5, 7), 10);
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const quarterStart = `${today.slice(0, 4)}-${`${quarterStartMonth}`.padStart(2, "0")}-01`;
  const quarterEnd = shiftDay(addMonthsIso(quarterStart, 3), -1);
  return [
    { id: "this-month", label: "Tháng này", from: monthStart, to: monthEnd },
    { id: "last-month", label: "Tháng trước", from: lastStart, to: lastEnd },
    { id: "this-quarter", label: "Quý này", from: quarterStart, to: quarterEnd },
    { id: "this-year", label: "Năm nay", from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` },
  ];
}
