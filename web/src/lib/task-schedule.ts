/**
 * Phase 3B task scheduling: clocks, reminders and repeats. Everything here is pure — no
 * Supabase, no React — and mirrors the database triggers exactly, so an optimistic render
 * and the row that comes back agree.
 */

export type TaskRecurrence = "none" | "daily" | "weekly" | "monthly" | "custom";

export const TASK_RECURRENCES: readonly TaskRecurrence[] = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "custom",
] as const;

export const RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  none: "Không lặp",
  daily: "Hàng ngày",
  weekly: "Hàng tuần",
  monthly: "Hàng tháng",
  custom: "Tuỳ chỉnh",
};

/** A custom repeat is "every N days/weeks/months"; anything richer is out of scope. */
export type RecurrencePattern = {
  interval: number;
  frequency: "daily" | "weekly" | "monthly";
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Empty means "no particular time that day", which is a real answer, not a broken one. */
export function normalizeDeadlineTime(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // <input type="time"> can hand back seconds; Postgres `time` hands back HH:MM:SS.
  const short = trimmed.length > 5 ? trimmed.slice(0, 5) : trimmed;
  return HH_MM.test(short) ? short : null;
}

export function validateDeadlineTime(raw: string): { time: string | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed === "") return { time: null, error: null };
  const time = normalizeDeadlineTime(trimmed);
  if (time === null) return { time: null, error: "Giờ không hợp lệ. Dùng dạng 14:00." };
  return { time, error: null };
}

/** `09:00`, or nothing at all when the task is due merely "that day". */
export function formatDeadlineTime(time: string | null): string | null {
  return normalizeDeadlineTime(time);
}

/**
 * Minutes are offered in five-minute steps and nothing finer.
 *
 * A deadline is an intention, not a stopwatch: "16:05" and "16:07" mean the same thing to the
 * person reading it, and the browser's own time control makes you pick between them anyway —
 * sixty choices per hour, typed digit by digit. Twelve marks fit on one screen and can be hit
 * with a thumb.
 */
export const MINUTE_STEP = 5;

/** `0 … 23`, the rows of the picker. */
export const HOUR_OPTIONS: readonly number[] = Array.from({ length: 24 }, (_, hour) => hour);

/** `00, 05, … 55` — every mark the picker will ever offer. */
export const MINUTE_OPTIONS: readonly number[] = Array.from(
  { length: 60 / MINUTE_STEP },
  (_, index) => index * MINUTE_STEP,
);

export function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}

/** Builds `HH:MM` from grid coordinates, refusing anything outside a real clock. */
export function composeTime(hour: number, minute: number): string | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${padTwo(hour)}:${padTwo(minute)}`;
}

/**
 * Reads an existing value back into the grid. A stored time that predates the five-minute
 * rule (or arrived from the database at `16:07`) still has to highlight something, so it is
 * snapped down to the mark at or before it rather than being dropped.
 */
export function splitTime(time: string | null): { hour: number; minute: number } | null {
  const normalized = normalizeDeadlineTime(time);
  if (normalized === null) return null;
  const [hour, minute] = normalized.split(":").map((piece) => Number.parseInt(piece, 10));
  return { hour, minute: minute - (minute % MINUTE_STEP) };
}

/** The same snap, expressed as a time string. Used before a value leaves the picker. */
export function snapToMinuteStep(time: string | null): string | null {
  const parts = splitTime(time);
  if (parts === null) return null;
  return composeTime(parts.hour, parts.minute);
}

function parts(dateIso: string): { year: number; month: number; day: number } | null {
  if (!ISO_DATE.test(dateIso)) return null;
  const [year, month, day] = dateIso.split("-").map((piece) => Number.parseInt(piece, 10));
  if (year === undefined || month === undefined || day === undefined) return null;
  return { year, month, day };
}

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * The exact moment a deadline falls due, in the reader's own zone.
 *
 * A task due "Sep 12" with no clock is due at the END of that day. Treating it as midnight —
 * or as 09:00, which the spec proposed backfilling — would make work promised for today read
 * as already late.
 */
export function deadlineInstant(dateIso: string, time: string | null): Date | null {
  const p = parts(dateIso);
  if (p === null) return null;
  const clock = normalizeDeadlineTime(time);
  if (clock === null) return new Date(p.year, p.month - 1, p.day, 23, 59, 59, 999);
  const [hours, minutes] = clock.split(":").map((piece) => Number.parseInt(piece, 10));
  return new Date(p.year, p.month - 1, p.day, hours ?? 0, minutes ?? 0, 0, 0);
}

/** Whether a deadline has actually passed, to the minute when a clock is set. */
export function isDeadlinePast(dateIso: string, time: string | null, now: Date = new Date()): boolean {
  const due = deadlineInstant(dateIso, time);
  return due === null ? false : due.getTime() < now.getTime();
}

export function addDaysIso(dateIso: string, days: number): string {
  const p = parts(dateIso);
  if (p === null) return dateIso;
  const shifted = new Date(p.year, p.month - 1, p.day + days);
  return iso(shifted.getFullYear(), shifted.getMonth() + 1, shifted.getDate());
}

/**
 * Adds whole months, clamping to the end of a short month the way Postgres does:
 * 31 Jan + 1 month is 28 Feb, not 3 March.
 */
export function addMonthsIso(dateIso: string, months: number): string {
  const p = parts(dateIso);
  if (p === null) return dateIso;
  const total = p.month - 1 + months;
  const year = p.year + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12 + 1;
  return iso(year, month, Math.min(p.day, daysInMonth(year, month)));
}

function stepIso(dateIso: string, recurrence: TaskRecurrence, pattern: RecurrencePattern | null, n: number): string {
  if (recurrence === "daily") return addDaysIso(dateIso, n);
  if (recurrence === "weekly") return addDaysIso(dateIso, 7 * n);
  if (recurrence === "monthly") return addMonthsIso(dateIso, n);
  const every = Math.max(pattern?.interval ?? 1, 1);
  const frequency = pattern?.frequency ?? "weekly";
  if (frequency === "daily") return addDaysIso(dateIso, every * n);
  if (frequency === "monthly") return addMonthsIso(dateIso, every * n);
  return addDaysIso(dateIso, 7 * every * n);
}

/**
 * Where the next occurrence lands after finishing one.
 *
 * Steps are counted from the ORIGINAL date rather than added one at a time, so a month-end
 * task stays at month-end (31 Jan + 2 months is 31 Mar, where repeated addition would have
 * drifted to 28 Mar). The result is then walked forward until it is genuinely in the future:
 * a weekly task finished three weeks late must not produce a successor that is born overdue —
 * and the database refuses a past deadline outright, so a naive "+1 interval" would make
 * completing that task fail altogether.
 */
export function nextOccurrence(
  dateIso: string,
  recurrence: TaskRecurrence,
  pattern: RecurrencePattern | null,
  todayIso: string,
): string | null {
  if (recurrence === "none") return null;
  if (!ISO_DATE.test(dateIso) || !ISO_DATE.test(todayIso)) return null;
  for (let n = 1; n <= 500; n += 1) {
    const candidate = stepIso(dateIso, recurrence, pattern, n);
    if (candidate > todayIso) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------- reminders

export type ReminderPresetId = "m15" | "m30" | "h1" | "morning" | "d1";

export type ReminderPreset = {
  id: ReminderPresetId;
  label: string;
  /** Fixed distance before the deadline, or null when the preset is an absolute time of day. */
  minutesBefore: number | null;
};

/** 30 minutes is the suggested default: long enough to react, short enough to still be relevant. */
export const REMINDER_PRESETS: readonly ReminderPreset[] = [
  { id: "m15", label: "15 phút trước", minutesBefore: 15 },
  { id: "m30", label: "30 phút trước", minutesBefore: 30 },
  { id: "h1", label: "1 giờ trước", minutesBefore: 60 },
  { id: "morning", label: "Sáng cùng ngày (09:00)", minutesBefore: null },
  { id: "d1", label: "1 ngày trước", minutesBefore: 24 * 60 },
] as const;

export const DEFAULT_REMINDER_PRESET: ReminderPresetId = "m30";

/** When a given preset would actually fire for a given deadline. */
export function reminderInstant(
  preset: ReminderPreset,
  dateIso: string,
  time: string | null,
): Date | null {
  const due = deadlineInstant(dateIso, time);
  if (due === null) return null;
  if (preset.minutesBefore === null) {
    const p = parts(dateIso);
    if (p === null) return null;
    return new Date(p.year, p.month - 1, p.day, 9, 0, 0, 0);
  }
  return new Date(due.getTime() - preset.minutesBefore * 60_000);
}

/**
 * Distance from the deadline in minutes — what gets stored, so that a repeat can place the
 * same reminder against the next occurrence.
 */
export function reminderOffsetMinutes(
  preset: ReminderPreset,
  dateIso: string,
  time: string | null,
): number | null {
  const due = deadlineInstant(dateIso, time);
  const at = reminderInstant(preset, dateIso, time);
  if (due === null || at === null) return null;
  return Math.round((due.getTime() - at.getTime()) / 60_000);
}

/**
 * Only the presets that can still happen. "Same morning" on a task due at 08:00, or "1 day
 * before" on a task due tomorrow, would fire after the deadline or in the past — the server
 * refuses both, so the picker must not offer them in the first place.
 */
export function feasibleReminderPresets(
  dateIso: string,
  time: string | null,
  now: Date = new Date(),
): ReminderPreset[] {
  const due = deadlineInstant(dateIso, time);
  if (due === null) return [];
  return REMINDER_PRESETS.filter((preset) => {
    const at = reminderInstant(preset, dateIso, time);
    if (at === null) return false;
    return at.getTime() > now.getTime() && at.getTime() <= due.getTime();
  });
}

export function reminderPresetById(id: ReminderPresetId): ReminderPreset | null {
  return REMINDER_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** `08:30, 9 thg 9` — enough to check a reminder without opening the task. */
export function formatReminderAt(at: Date): string {
  const clock = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  return `${clock}, ${at.getDate()} thg ${at.getMonth() + 1}`;
}

/**
 * The zone the browser is in. Deadlines are wall-clock times, so a task typed as "09:00" in
 * Vietnam has to keep meaning 09:00 there; the zone is recorded rather than assumed to be UTC.
 */
export function browserTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone !== "" ? zone : "Asia/Ho_Chi_Minh";
  } catch {
    return "Asia/Ho_Chi_Minh";
  }
}
