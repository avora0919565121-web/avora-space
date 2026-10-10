/**
 * AVORA-107 · PHẦN 2 — the countdown of a habit with a clock (ADR-077 · đặc tả mục 5 + 10). Pure
 * rules, no I/O.
 *
 * Time is counted from **marks**, never from ticks: a session keeps what it has already gathered
 * (`gatheredMs`) plus the moment it last started running (`runningSince`). A throttled tab, a slow
 * phone or a missed interval can therefore never add or lose a second. One session at a time, kept
 * on this device only (no syncing of sessions between devices — đặc tả mục 11).
 *
 * VMT 10/10 21:11 — "Khi rời Avora", per habit: `stop` keeps the PHẦN 2 rule (leaving = stopped);
 * `keep` lets the clock run on while the screen is locked, another app is open or the tab is gone.
 * Because time is marks, a `keep` session needs nothing running to stay right.
 */
import type { HabitWhenAway } from "@/lib/habits";

export type HabitTimerStopReason = "user" | "left" | "hidden";

export type HabitSession = {
  habitId: string;
  habitName: string;
  windowIndex: number;
  /** The window's time, shown on the screen (`08:00`). */
  windowTime: string;
  /** The device day the session belongs to (ranh giới 24:00 giờ máy). */
  localDate: string;
  targetSeconds: number;
  /** Time already gathered before the current run, in ms. */
  gatheredMs: number;
  /** Epoch ms of the current run's start; `null` while stopped. */
  runningSince: number | null;
  /** Why it stopped last, for the quiet line under the clock. */
  stoppedBy: HabitTimerStopReason | null;
  startedAt: string;
  whenAway: HabitWhenAway;
  /** `keep`: the moment the page was hidden while running (null while the person is here). */
  awaySince: number | null;
  /** `keep`: the moment the target was first reached while nobody was watching the full screen. */
  reachedAt: number | null;
};

export const HABIT_SESSION_PREFIX = "avora-habit-session:";

/** Everything gathered up to `now`. */
export function elapsedMs(session: HabitSession, now: number): number {
  const running = session.runningSince === null ? 0 : Math.max(0, now - session.runningSince);
  return Math.max(0, session.gatheredMs + running);
}

export function remainingMs(session: HabitSession, now: number): number {
  return Math.max(0, session.targetSeconds * 1000 - elapsedMs(session, now));
}

export function isRunningSession(session: HabitSession): boolean {
  return session.runningSince !== null;
}

/** The target is reached: the window is `Đã làm`. */
export function isFinished(session: HabitSession, now: number): boolean {
  return elapsedMs(session, now) >= session.targetSeconds * 1000;
}

export function startSession(
  input: { habitId: string; habitName: string; windowIndex: number; windowTime: string; localDate: string; targetMinutes: number; whenAway?: HabitWhenAway },
  now: number,
): HabitSession {
  return {
    habitId: input.habitId,
    habitName: input.habitName,
    windowIndex: input.windowIndex,
    windowTime: input.windowTime,
    localDate: input.localDate,
    targetSeconds: Math.max(60, Math.round(input.targetMinutes * 60)),
    gatheredMs: 0,
    runningSince: now,
    stoppedBy: null,
    startedAt: new Date(now).toISOString(),
    whenAway: input.whenAway ?? "keep",
    awaySince: null,
    reachedAt: null,
  };
}

/** Stops the clock and folds the current run into the gathered time. Stopping twice changes nothing. */
export function stopSession(session: HabitSession, now: number, reason: HabitTimerStopReason): HabitSession {
  if (session.runningSince === null) return session;
  return { ...session, gatheredMs: elapsedMs(session, now), runningSince: null, stoppedBy: reason, awaySince: null };
}

export function resumeSession(session: HabitSession, now: number): HabitSession {
  if (session.runningSince !== null) return session;
  return { ...session, runningSince: now, stoppedBy: null };
}

/**
 * A session that has crossed 24:00 cancels itself — nothing is written, it simply ends. A `stop`
 * session only runs while its screen is in front of the person, so a running one finishes on its
 * own day; a `keep` session runs unwatched, so it ends at 24:00 whether running or not.
 */
export function isExpired(session: HabitSession, today: string): boolean {
  if (session.localDate === today) return false;
  return session.runningSince === null || session.whenAway === "keep";
}

/**
 * The seconds a log records. `stop`: the real time gathered, never more than the target (the clock
 * ends there in front of the person). `keep`: the real time, no ceiling — "Ghi n thật" (VMT 21:11),
 * within the server's one-day bound.
 */
export function recordedSeconds(session: HabitSession, now: number): number {
  const seconds = Math.round(elapsedMs(session, now) / 1000);
  return session.whenAway === "keep" ? Math.min(86_400, seconds) : Math.min(session.targetSeconds, seconds);
}

/** `keep`: the page went away while the clock ran. Marks once; the clock itself is untouched. */
export function markAway(session: HabitSession, now: number): HabitSession {
  if (session.whenAway !== "keep" || session.runningSince === null || session.awaySince !== null) return session;
  return { ...session, awaySince: now };
}

/** The epoch ms at which a running session reaches its target (null while stopped or already past). */
export function finishesAt(session: HabitSession, now: number): number | null {
  if (session.runningSince === null) return null;
  const left = remainingMs(session, now);
  return left <= 0 ? null : now + left;
}

/** `Đủ 15 phút` once the target is reached, else `Đã trôi qua 6 phút`. */
export function passedLine(session: HabitSession, now: number): string {
  const seconds = Math.round(elapsedMs(session, now) / 1000);
  const target = Math.round(session.targetSeconds / 60);
  return seconds >= session.targetSeconds ? `Đủ ${target} phút` : `Đã trôi qua ${minutesText(seconds)}`;
}

/** `14:59` — minutes and seconds left (or gathered), rounded up so 0:00 only shows at the end. */
export function clockText(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** `3 phút` for the abandoned line: whole minutes gathered (never below 0). */
export function minutesText(seconds: number): string {
  return `${Math.max(0, Math.round(seconds / 60))} phút`;
}

/** The quiet line under a stopped clock. */
export function stoppedLine(reason: HabitTimerStopReason | null): string {
  if (reason === "left") return "Đã dừng khi bạn rời màn đồng hồ.";
  if (reason === "hidden") return "Đã dừng khi màn hình tắt hoặc bạn chuyển ứng dụng.";
  return "Đang dừng.";
}

/** Reads a stored session; anything malformed is dropped (a session is only a convenience). */
export function parseSession(raw: string | null): HabitSession | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<HabitSession>;
    if (
      typeof value.habitId !== "string" ||
      typeof value.habitName !== "string" ||
      typeof value.windowIndex !== "number" ||
      typeof value.localDate !== "string" ||
      typeof value.targetSeconds !== "number" ||
      typeof value.gatheredMs !== "number"
    ) {
      return null;
    }
    return {
      habitId: value.habitId,
      habitName: value.habitName,
      windowIndex: value.windowIndex,
      windowTime: typeof value.windowTime === "string" ? value.windowTime : "",
      localDate: value.localDate,
      targetSeconds: value.targetSeconds,
      gatheredMs: value.gatheredMs,
      runningSince: typeof value.runningSince === "number" ? value.runningSince : null,
      stoppedBy: value.stoppedBy === "user" || value.stoppedBy === "left" || value.stoppedBy === "hidden" ? value.stoppedBy : null,
      startedAt: typeof value.startedAt === "string" ? value.startedAt : new Date().toISOString(),
      // A session stored before "Khi rời Avora" was a PHẦN 2 session: it keeps the old rule.
      whenAway: value.whenAway === "keep" ? "keep" : "stop",
      awaySince: typeof value.awaySince === "number" ? value.awaySince : null,
      reachedAt: typeof value.reachedAt === "number" ? value.reachedAt : null,
    };
  } catch {
    return null;
  }
}
