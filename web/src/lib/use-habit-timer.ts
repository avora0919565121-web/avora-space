import { useSyncExternalStore } from "react";

import { setHabitAlarm } from "@/lib/habit-alarm";
import type { Habit } from "@/lib/habits";
import {
  HABIT_SESSION_PREFIX,
  finishesAt,
  isExpired,
  isFinished,
  markAway,
  parseSession,
  recordedSeconds,
  resumeSession,
  startSession,
  stopSession,
  type HabitSession,
  type HabitTimerStopReason,
} from "@/lib/habit-timer";
import { abandonHabitSession, logHabit } from "@/lib/use-habits";

/**
 * AVORA-107 · PHẦN 2 — the one countdown of this device (ADR-077). A module store like the habit
 * store: the session lives in localStorage under the person's id so it survives a reload and works
 * with no network; what it writes (`Đã làm`, `Đã bỏ phiên`) goes through the habit store's queue.
 *
 * `screen` is what the layer shows: `ready` (a habit chosen, clock not started), `session` (the
 * running / stopped session), `done` (the window just became `Đã làm`) or `back` (a `Cứ chạy`
 * session that ran while the person was away: "Đã trôi qua n phút" — never written on its own).
 */
export type HabitTimerScreen =
  | { mode: "ready"; habitId: string; habitName: string; windowIndex: number; windowTime: string; localDate: string; targetMinutes: number; whenAway: Habit["whenAway"] }
  | { mode: "session" }
  | { mode: "back" }
  | { mode: "done"; habitName: string; seconds: number; byClock: boolean };

type TimerState = { userId: string | null; session: HabitSession | null; screen: HabitTimerScreen | null; notice: string | null };

let state: TimerState = { userId: null, session: null, screen: null, notice: null };
const listeners = new Set<() => void>();

function keyOf(userId: string): string {
  return `${HABIT_SESSION_PREFIX}${userId}`;
}

function persist(): void {
  if (state.userId === null || typeof window === "undefined") return;
  try {
    if (state.session === null) window.localStorage.removeItem(keyOf(state.userId));
    else window.localStorage.setItem(keyOf(state.userId), JSON.stringify(state.session));
  } catch {
    // Private mode / full storage: the session still runs in memory.
  }
}

function setState(patch: Partial<TimerState>): void {
  const touchesSession = "session" in patch;
  state = { ...state, ...patch };
  if (touchesSession) persist();
  listeners.forEach((listener) => listener());
}

/** `Cứ chạy`: the server rings at the end when Avora is closed. Any other session: nothing waits. */
function syncAlarm(session: HabitSession | null, previous: HabitSession | null, now: number): void {
  const at = session !== null && session.whenAway === "keep" ? finishesAt(session, now) : null;
  const target = session ?? previous;
  if (target === null || target.whenAway !== "keep") return;
  setHabitAlarm({ habitId: target.habitId, localDate: target.localDate, windowIndex: target.windowIndex, at });
}

/**
 * Loads this person's session. `Dừng khi rời`: one that was running when the app went away is kept
 * but stopped without the unseen run. `Cứ chạy`: it ran on — the person is asked what to write
 * (`back`), nothing is written by itself. Either past 24:00 cancels itself.
 */
export function loadHabitTimer(userId: string, today: string, now: number = Date.now()): void {
  if (state.userId === userId) return;
  let session: HabitSession | null = null;
  try {
    session = parseSession(window.localStorage.getItem(keyOf(userId)));
  } catch {
    session = null;
  }
  let screen: HabitTimerScreen | null = null;
  if (session !== null && session.runningSince !== null) {
    if (session.whenAway === "keep") screen = { mode: "back" };
    else session = { ...session, runningSince: null, stoppedBy: "hidden" };
  }
  state = { userId, session: session === null ? null : { ...session, awaySince: null }, screen, notice: null };
  if (session !== null && isExpired(session, today)) {
    syncAlarm(null, session, now);
    state = { ...state, session: null, screen: null, notice: `Phiên ${session.habitName} đã tự huỷ khi qua ngày.` };
  }
  persist();
  listeners.forEach((listener) => listener());
}

/** Test seam: forget everything (memory only). */
export function resetHabitTimer(): void {
  state = { userId: null, session: null, screen: null, notice: null };
  listeners.forEach((listener) => listener());
}

/**
 * Opens the clock for one window. One session at a time: while another one exists, its own screen
 * opens instead and the person is told which one.
 */
export function openHabitTimer(habit: Pick<Habit, "id" | "name" | "targetMinutes" | "windows"> & { whenAway?: Habit["whenAway"] }, windowIndex: number, localDate: string): void {
  const current = state.session;
  if (current !== null) {
    const isSame = current.habitId === habit.id && current.windowIndex === windowIndex;
    setState({ screen: { mode: "session" }, notice: isSame ? null : `Đang có một phiên: ${current.habitName}. Xong hoặc bỏ phiên đó trước.` });
    return;
  }
  setState({
    screen: {
      mode: "ready",
      habitId: habit.id,
      habitName: habit.name,
      windowIndex,
      windowTime: habit.windows[windowIndex]?.time ?? "",
      localDate,
      targetMinutes: habit.targetMinutes ?? 15,
      whenAway: habit.whenAway ?? "keep",
    },
  });
}

/** Opens the existing session's screen (the corner chip). */
export function showHabitTimer(): void {
  if (state.session !== null) setState({ screen: { mode: "session" } });
}

export function beginHabitTimer(now: number = Date.now()): void {
  const screen = state.screen;
  if (screen === null || screen.mode !== "ready" || state.session !== null) return;
  const session = startSession(screen, now);
  setState({ session, screen: { mode: "session" } });
  syncAlarm(session, null, now);
}

export function stopHabitTimer(reason: HabitTimerStopReason, now: number = Date.now()): void {
  if (state.session === null || state.session.runningSince === null) return;
  const previous = state.session;
  const session = stopSession(previous, now, reason);
  setState({ session });
  syncAlarm(session, previous, now);
}

export function resumeHabitTimer(now: number = Date.now()): void {
  if (state.session === null) return;
  const session = resumeSession(state.session, now);
  setState({ session, screen: { mode: "session" } });
  syncAlarm(session, null, now);
}

/**
 * The page is hidden / the window lost focus / another screen opened. `Dừng khi rời`: the clock
 * stops (PHẦN 2). `Cứ chạy`: it runs on; a hidden page is remembered so the return can ask.
 */
export function leaveHabitTimer(how: "left" | "hidden" | "blur", now: number = Date.now()): void {
  const session = state.session;
  if (session === null || session.runningSince === null) return;
  if (session.whenAway === "keep") {
    if (how === "hidden") setState({ session: markAway(session, now) });
    return;
  }
  stopHabitTimer(how === "left" ? "left" : "hidden", now);
}

/** Back in Avora after a hidden page: a `Cứ chạy` session that kept running asks what to write. */
export function returnToHabitTimer(): void {
  const session = state.session;
  if (session === null || session.awaySince === null) return;
  setState({ session: { ...session, awaySince: null }, screen: { mode: "back" } });
}

/** Leaving the full screen: `Dừng khi rời` stops the clock; `Cứ chạy` lets it run in the chip. */
export function closeHabitTimer(now: number = Date.now()): void {
  const session = state.session;
  if (session !== null && session.whenAway === "keep") {
    if (state.screen !== null) setState({ screen: null });
    return;
  }
  const stopped = session === null ? null : stopSession(session, now, "left");
  setState({ session: stopped, screen: null });
}

/** `Hoàn thành` (or the clock reaching its end): the window is `Đã làm` with the real time gathered. */
export function completeHabitTimer(now: number = Date.now()): void {
  const session = state.session;
  if (session === null) return;
  const seconds = recordedSeconds(session, now);
  logHabit(session.habitId, session.localDate, session.windowIndex, { source: "timer", durationSeconds: seconds });
  setState({ session: null, screen: { mode: "done", habitName: session.habitName, seconds, byClock: seconds >= session.targetSeconds } });
  syncAlarm(null, session, now);
}

/** `Bỏ phiên`: written as `Đã bỏ phiên · n phút` with the optional note; the window stays open. */
export function abandonHabitTimer(note: string | null, now: number = Date.now()): void {
  const session = state.session;
  if (session === null) return;
  abandonHabitSession(session.habitId, session.localDate, session.windowIndex, recordedSeconds(session, now), note);
  setState({ session: null, screen: null, notice: "Đã bỏ phiên. Lịch sử có ghi lại." });
  syncAlarm(null, session, now);
}

export function dismissHabitTimerScreen(): void {
  setState({ screen: null });
}

export function clearHabitTimerNotice(): void {
  if (state.notice !== null) setState({ notice: null });
}

/**
 * One look at the clock. A session past 24:00 cancels itself. Reaching the target in front of the
 * full screen completes the window (`finished`); a `Cứ chạy` session reaching it while nobody
 * watches the full screen is only marked (`reached`, once) — the person decides what to write.
 */
export function checkHabitTimer(today: string, now: number = Date.now()): "finished" | "reached" | "expired" | null {
  const session = state.session;
  if (session === null) return null;
  if (isExpired(session, today)) {
    setState({
      session: null,
      screen: state.screen?.mode === "session" || state.screen?.mode === "back" ? null : state.screen,
      notice: `Phiên ${session.habitName} đã tự huỷ khi qua ngày.`,
    });
    syncAlarm(null, session, now);
    return "expired";
  }
  if (session.runningSince === null || !isFinished(session, now)) return null;
  const isWatched = state.screen?.mode === "session" && session.awaySince === null;
  if (session.whenAway === "stop" || (isWatched && session.reachedAt === null)) {
    completeHabitTimer(now);
    return "finished";
  }
  if (session.reachedAt === null) {
    setState({ session: { ...session, reachedAt: now } });
    return session.awaySince === null ? "reached" : null;
  }
  return null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): TimerState {
  return state;
}

export function useHabitTimer(): TimerState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
