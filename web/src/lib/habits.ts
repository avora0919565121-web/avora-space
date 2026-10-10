import { normalizeSearch } from "@/lib/normalize-search";

/**
 * AVORA-107 · PHẦN 1 — Thói quen (ADR-077). Pure rules, no I/O.
 *
 * Thói quen là kỷ luật, nhiệm vụ là trách nhiệm: nothing here touches `tasks`. There is no streak,
 * no score, no badge. A day ends at 24:00 on this device; a window not done by then reads
 * `Chưa làm` in the history and never rolls over into the next day.
 */
export type HabitKind = "timed" | "check";
export type HabitWindow = { time: string; remind: boolean };

export type Habit = {
  id: string;
  name: string;
  kind: HabitKind;
  targetMinutes: number | null;
  /** ISO weekdays, 1 = Thứ Hai … 7 = Chủ nhật. */
  weekdays: number[];
  windows: HabitWindow[];
  remindersOn: boolean;
  pausedAt: string | null;
  archivedAt: string | null;
  version: number;
  createdAt: string;
};

export type HabitLog = {
  id: string;
  habitId: string;
  localDate: string;
  windowIndex: number;
  status: "done" | "abandoned";
  doneAt: string;
  source: "manual" | "timer";
  durationSeconds: number | null;
  note: string | null;
};

export type HabitDraft = {
  name: string;
  kind: HabitKind;
  targetMinutes: number | null;
  weekdays: number[];
  windows: HabitWindow[];
  remindersOn: boolean;
};

/** `?thoi-quen=<id>` opens one habit's detail in Nhiệm vụ › Thói quen (search, Avora Space, bảng). */
export const HABIT_PARAM = "thoi-quen";

export const HABIT_KIND_LABEL: Readonly<Record<HabitKind, string>> = { timed: "Có đồng hồ", check: "Chỉ đánh dấu" };
export const ALL_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
export const WEEKDAY_SHORT: Readonly<Record<number, string>> = { 1: "T2", 2: "T3", 3: "T4", 4: "T5", 5: "T6", 6: "T7", 7: "CN" };
export const MAX_WINDOWS = 12;
export const HABIT_NAME_MAX = 80;

/** Neutral suggestions only (no religious wording — the person types their own). */
export type HabitSuggestion = { id: string; draft: HabitDraft; hint: string };

export const HABIT_SUGGESTIONS: readonly HabitSuggestion[] = [
  { id: "day-som", hint: "Đúng giờ là đủ", draft: { name: "Dậy sớm", kind: "check", targetMinutes: null, weekdays: [...ALL_WEEKDAYS], windows: [{ time: "06:00", remind: true }], remindersOn: true } },
  {
    id: "uong-nuoc",
    hint: "Nhiều khung trong ngày",
    draft: {
      name: "Uống đủ nước",
      kind: "check",
      targetMinutes: null,
      weekdays: [...ALL_WEEKDAYS],
      windows: [{ time: "08:00", remind: true }, { time: "11:00", remind: true }, { time: "14:00", remind: true }, { time: "17:00", remind: true }],
      remindersOn: true,
    },
  },
  { id: "van-dong", hint: "Bắt đầu nhỏ: 15 phút", draft: { name: "Vận động", kind: "timed", targetMinutes: 15, weekdays: [...ALL_WEEKDAYS], windows: [{ time: "06:30", remind: true }], remindersOn: true } },
  { id: "doc-sach", hint: "Bắt đầu nhỏ: 15 phút", draft: { name: "Đọc sách", kind: "timed", targetMinutes: 15, weekdays: [...ALL_WEEKDAYS], windows: [{ time: "21:00", remind: true }], remindersOn: true } },
  { id: "ngu-dung-gio", hint: "Đúng giờ là đủ", draft: { name: "Ngủ đúng giờ", kind: "check", targetMinutes: null, weekdays: [...ALL_WEEKDAYS], windows: [{ time: "22:30", remind: true }], remindersOn: true } },
];

export const CUSTOM_DRAFT: HabitDraft = { name: "", kind: "check", targetMinutes: null, weekdays: [...ALL_WEEKDAYS], windows: [{ time: "08:00", remind: true }], remindersOn: true };

// ------------------------------------------------------------------ days

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The day on this device's clock — the habit day ends at 24:00 here. */
export function localDateOf(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12);
}

export function addDays(day: string, delta: number): string {
  const date = parseDay(day);
  date.setDate(date.getDate() + delta);
  return localDateOf(date);
}

/** 1 = Thứ Hai … 7 = Chủ nhật. */
export function isoWeekday(day: string): number {
  const js = parseDay(day).getDay();
  return js === 0 ? 7 : js;
}

export function mondayOf(day: string): string {
  return addDays(day, 1 - isoWeekday(day));
}

/** Whether a habit is still running: not resting, not archived. */
export function isRunning(habit: Pick<Habit, "pausedAt" | "archivedAt">): boolean {
  return habit.pausedAt === null && habit.archivedAt === null;
}

/** A day the habit asks for: its weekday, from the day it was made. */
export function isScheduledOn(habit: Pick<Habit, "weekdays" | "createdAt">, day: string): boolean {
  if (!habit.weekdays.includes(isoWeekday(day))) return false;
  const born = localDateOf(new Date(habit.createdAt));
  return day >= born;
}

/** Habits of today: running and asked for today, earliest first window first. */
export function habitsForDay(habits: readonly Habit[], day: string): Habit[] {
  return habits
    .filter((habit) => isRunning(habit) && isScheduledOn(habit, day))
    .sort((a, b) => (a.windows[0]?.time ?? "").localeCompare(b.windows[0]?.time ?? "") || a.name.localeCompare(b.name, "vi"));
}

// ------------------------------------------------------------------ logs

export type DoneIndex = ReadonlySet<string>;

export function doneKey(habitId: string, day: string, windowIndex: number): string {
  return `${habitId}|${day}|${windowIndex}`;
}

export function doneIndexOf(logs: readonly HabitLog[]): DoneIndex {
  const set = new Set<string>();
  for (const log of logs) if (log.status === "done") set.add(doneKey(log.habitId, log.localDate, log.windowIndex));
  return set;
}

export type Tally = { done: number; total: number };

/** `Hôm nay 2/4`: windows done on one day. */
export function dayTally(habit: Pick<Habit, "id" | "windows">, done: DoneIndex, day: string): Tally {
  let count = 0;
  habit.windows.forEach((_, index) => {
    if (done.has(doneKey(habit.id, day, index))) count += 1;
  });
  return { done: count, total: habit.windows.length };
}

/** A day is kept when every window of it is done. */
export function isDayKept(habit: Pick<Habit, "id" | "windows">, done: DoneIndex, day: string): boolean {
  const tally = dayTally(habit, done, day);
  return tally.total > 0 && tally.done === tally.total;
}

/** `Tuần này 5/7`: kept days over the days this week asks for (Thứ Hai → Chủ nhật). */
export function weekTally(habit: Habit, done: DoneIndex, today: string, weekStart: string = mondayOf(today)): Tally {
  let kept = 0;
  let total = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const day = addDays(weekStart, offset);
    if (!isScheduledOn(habit, day)) continue;
    total += 1;
    if (isDayKept(habit, done, day)) kept += 1;
  }
  return { done: kept, total };
}

/** `4 tuần gần nhất`: oldest week first, this week last. */
export function fourWeeks(habit: Habit, done: DoneIndex, today: string): Tally[] {
  const monday = mondayOf(today);
  return [3, 2, 1, 0].map((back) => weekTally(habit, done, today, addDays(monday, -7 * back)));
}

/** `Thói quen hôm nay 2/5`: habits fully done today over today's habits. */
export function todaySummary(habits: readonly Habit[], done: DoneIndex, today: string): Tally {
  const list = habitsForDay(habits, today);
  return { done: list.filter((habit) => isDayKept(habit, done, today)).length, total: list.length };
}

export function tallyText(tally: Tally): string {
  return `${tally.done}/${tally.total}`;
}

/** What still hangs in Hôm nay: today's windows not done yet — kept until 24:00 even past their time. */
export function pendingWindows(habit: Habit, done: DoneIndex, today: string): number[] {
  return habit.windows.map((_, index) => index).filter((index) => !done.has(doneKey(habit.id, today, index)));
}

// ------------------------------------------------------------------ history

export type HistoryLine =
  | { kind: "done"; day: string; time: string; durationSeconds: number | null; at: string }
  | { kind: "missed"; day: string; time: string }
  | { kind: "abandoned"; day: string; time: string; minutes: number; note: string | null; at: string };

/**
 * The detail history, newest day first. A past window with no `done` reads `Chưa làm` — quietly,
 * no colour. Today is never `Chưa làm`: it still hangs until 24:00.
 */
export function historyOf(habit: Habit, logs: readonly HabitLog[], today: string, days: number = 28): { day: string; lines: HistoryLine[] }[] {
  const mine = logs.filter((log) => log.habitId === habit.id);
  const out: { day: string; lines: HistoryLine[] }[] = [];
  for (let back = 0; back < days; back += 1) {
    const day = addDays(today, -back);
    const lines: HistoryLine[] = [];
    const ofDay = mine.filter((log) => log.localDate === day);
    const scheduled = isScheduledOn(habit, day);
    habit.windows.forEach((window, index) => {
      const done = ofDay.find((log) => log.windowIndex === index && log.status === "done");
      if (done !== undefined) lines.push({ kind: "done", day, time: window.time, durationSeconds: done.durationSeconds, at: done.doneAt });
      else if (scheduled && day < today) lines.push({ kind: "missed", day, time: window.time });
    });
    for (const log of ofDay.filter((item) => item.status === "abandoned")) {
      lines.push({
        kind: "abandoned",
        day,
        time: habit.windows[log.windowIndex]?.time ?? "",
        minutes: Math.round((log.durationSeconds ?? 0) / 60),
        note: log.note,
        at: log.doneAt,
      });
    }
    if (lines.length > 0) out.push({ day, lines });
  }
  return out;
}

export function historyLineText(line: HistoryLine): string {
  if (line.kind === "done") {
    const minutes = line.durationSeconds === null ? null : Math.max(1, Math.round(line.durationSeconds / 60));
    return minutes === null ? "Đã làm" : `Đã làm · ${minutes} phút`;
  }
  if (line.kind === "missed") return "Chưa làm";
  return ["Đã bỏ phiên", `${line.minutes} phút`, line.note ?? ""].filter((part) => part !== "").join(" · ");
}

// ------------------------------------------------------------------ words

export function scheduleText(habit: Pick<Habit, "weekdays" | "windows">): string {
  const days = habit.weekdays.length === 7 ? "Mỗi ngày" : [...habit.weekdays].sort((a, b) => a - b).map((day) => WEEKDAY_SHORT[day]).join(", ");
  return `${days} · ${habit.windows.map((window) => window.time).join(", ")}`;
}

export function kindText(habit: Pick<Habit, "kind" | "targetMinutes">): string {
  return habit.kind === "timed" ? `${HABIT_KIND_LABEL.timed} · ${habit.targetMinutes ?? 0} phút` : HABIT_KIND_LABEL.check;
}

/** Search like Hạng mục: accents optional. */
export function matchesHabit(habit: Pick<Habit, "name">, query: string): boolean {
  const q = normalizeSearch(query.trim());
  return q === "" || normalizeSearch(habit.name).includes(q);
}

// ------------------------------------------------------------------ draft

export function validateDraft(draft: HabitDraft): string | null {
  const name = draft.name.trim();
  if (name === "") return "Đặt tên cho thói quen.";
  if (name.length > HABIT_NAME_MAX) return `Tên tối đa ${HABIT_NAME_MAX} ký tự.`;
  if (draft.weekdays.length === 0) return "Chọn ít nhất một ngày.";
  if (draft.windows.length === 0) return "Thêm ít nhất một khung giờ.";
  if (draft.windows.length > MAX_WINDOWS) return `Tối đa ${MAX_WINDOWS} khung giờ.`;
  if (draft.windows.some((window) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.time))) return "Giờ chưa đúng dạng HH:MM.";
  if (draft.kind === "timed" && (draft.targetMinutes === null || draft.targetMinutes < 1 || draft.targetMinutes > 600)) return "Số phút từ 1 đến 600.";
  return null;
}

/** Windows sorted by time, one per time — the same order the server keeps. */
export function cleanWindows(windows: readonly HabitWindow[]): HabitWindow[] {
  const byTime = new Map<string, HabitWindow>();
  for (const window of windows) if (!byTime.has(window.time)) byTime.set(window.time, window);
  return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export function draftOf(habit: Habit): HabitDraft {
  return { name: habit.name, kind: habit.kind, targetMinutes: habit.targetMinutes, weekdays: [...habit.weekdays], windows: habit.windows.map((window) => ({ ...window })), remindersOn: habit.remindersOn };
}

// ------------------------------------------------------------------ reminders (this device)

/** The moment a window rings today, on this device's clock. */
export function windowMoment(day: string, time: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
}

export type HabitAlarm = { key: string; habitId: string; title: string; at: string };

/** Windows of today with a reminder, not done yet — what the in-app chime may ring for. */
export function habitAlarms(habits: readonly Habit[], done: DoneIndex, today: string): HabitAlarm[] {
  const out: HabitAlarm[] = [];
  for (const habit of habitsForDay(habits, today)) {
    if (!habit.remindersOn) continue;
    habit.windows.forEach((window, index) => {
      if (!window.remind || done.has(doneKey(habit.id, today, index))) return;
      out.push({ key: `hb:${habit.id}:${today}:${index}`, habitId: habit.id, title: habit.name, at: windowMoment(today, window.time).toISOString() });
    });
  }
  return out;
}

/**
 * Quiet wins for habits (VMT 23:13): Chế độ tập trung, Tắt toàn AVORA and the rest day all
 * silence the chime. Nothing is lost — the habit still hangs in Hôm nay until 24:00.
 */
export function habitChimeAllowed(input: { focusActive: boolean; avoraMuted: boolean; restWeekday: number; now: Date; soundOn: boolean }): boolean {
  if (!input.soundOn || input.focusActive || input.avoraMuted) return false;
  return input.now.getDay() !== ((input.restWeekday % 7) + 7) % 7;
}

// ------------------------------------------------------------------ Nhìn lại (read-only)

export type HabitReviewLine = { habitId: string; name: string; kept: number; missed: number };

/**
 * Nhìn lại tuần / hôm nay: per habit, windows `Đã giữ` and `Chưa làm` between two days (both
 * included). Only habits that were asked for in the range; no question, no score.
 */
export function habitReview(habits: readonly Habit[], done: DoneIndex, fromDay: string, toDay: string): HabitReviewLine[] {
  const out: HabitReviewLine[] = [];
  for (const habit of habits) {
    if (habit.archivedAt !== null && localDateOf(new Date(habit.archivedAt)) < fromDay) continue;
    if (habit.pausedAt !== null && localDateOf(new Date(habit.pausedAt)) < fromDay) continue;
    let kept = 0;
    let missed = 0;
    for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
      if (!isScheduledOn(habit, day)) continue;
      const tally = dayTally(habit, done, day);
      kept += tally.done;
      missed += tally.total - tally.done;
    }
    if (kept + missed > 0) out.push({ habitId: habit.id, name: habit.name, kept, missed });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

// ------------------------------------------------------------------ AVORA-77 D6 → Thói quen

/**
 * D6 used a repeating task for reading. Now reading is a habit; an old repeating task is never
 * removed — Thói quen only offers to start a `Đọc sách` habit while no reading habit exists.
 */
export function readingRepeatTask<T extends { id: string; title: string; type: string; status: string; recurrence: string }>(tasks: readonly T[], habits: readonly Habit[]): T | null {
  const hasReadingHabit = habits.some((habit) => habit.archivedAt === null && /\bdoc\b/.test(normalizeSearch(habit.name)));
  if (hasReadingHabit) return null;
  return (
    tasks.find((task) => task.type === "personal" && task.recurrence !== "none" && task.status !== "done" && task.status !== "skipped" && /\bdoc\b/.test(normalizeSearch(task.title))) ?? null
  );
}
