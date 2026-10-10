import { useSyncExternalStore } from "react";

import type { Habit } from "@/lib/habits";
import {
  HABIT_SESSION_PREFIX,
  isExpired,
  isFinished,
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
 * `screen` is what the full-screen layer shows: `ready` (a habit chosen, clock not started),
 * `session` (the running / stopped session) or `done` (the window just became `Đã làm`).
 */
export type HabitTimerScreen =
  | { mode: "ready"; habitId: string; habitName: string; windowIndex: number; windowTime: string; localDate: string; targetMinutes: number }
  | { mode: "session" }
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

/**
 * Loads this person's session. One that was running when the app went away is kept but stopped
 * without the unseen run (never a minute counted that nobody watched, never a false `Đã làm`).
 */
export function loadHabitTimer(userId: string, today: string): void {
  if (state.userId === userId) return;
  let session: HabitSession | null = null;
  try {
    session = parseSession(window.localStorage.getItem(keyOf(userId)));
  } catch {
    session = null;
  }
  if (session !== null && session.runningSince !== null) session = { ...session, runningSince: null, stoppedBy: "hidden" };
  state = { userId, session, screen: null, notice: null };
  if (session !== null && isExpired(session, today)) {
    state = { ...state, session: null, notice: `Phiên ${session.habitName} đã tự huỷ khi qua ngày.` };
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
export function openHabitTimer(habit: Pick<Habit, "id" | "name" | "targetMinutes" | "windows">, windowIndex: number, localDate: string): void {
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
  setState({ session: startSession(screen, now), screen: { mode: "session" } });
}

export function stopHabitTimer(reason: HabitTimerStopReason, now: number = Date.now()): void {
  if (state.session === null || state.session.runningSince === null) return;
  setState({ session: stopSession(state.session, now, reason) });
}

export function resumeHabitTimer(now: number = Date.now()): void {
  if (state.session === null) return;
  setState({ session: resumeSession(state.session, now), screen: { mode: "session" } });
}

/** Leaving the full screen stops the clock; the chip in the corner brings it back. */
export function closeHabitTimer(now: number = Date.now()): void {
  const session = state.session === null ? null : stopSession(state.session, now, "left");
  setState({ session, screen: null });
}

/** `Hoàn thành` (or the clock reaching its end): the window is `Đã làm` with the real time gathered. */
export function completeHabitTimer(now: number = Date.now()): void {
  const session = state.session;
  if (session === null) return;
  const seconds = recordedSeconds(session, now);
  logHabit(session.habitId, session.localDate, session.windowIndex, { source: "timer", durationSeconds: seconds });
  setState({ session: null, screen: { mode: "done", habitName: session.habitName, seconds, byClock: seconds >= session.targetSeconds } });
}

/** `Bỏ phiên`: written as `Đã bỏ phiên · n phút` with the optional note; the window stays open. */
export function abandonHabitTimer(note: string | null, now: number = Date.now()): void {
  const session = state.session;
  if (session === null) return;
  abandonHabitSession(session.habitId, session.localDate, session.windowIndex, recordedSeconds(session, now), note);
  setState({ session: null, screen: null, notice: "Đã bỏ phiên. Lịch sử có ghi lại." });
}

export function dismissHabitTimerScreen(): void {
  setState({ screen: null });
}

export function clearHabitTimerNotice(): void {
  if (state.notice !== null) setState({ notice: null });
}

/**
 * One look at the clock: reaching the target completes the window; a stopped session past 24:00
 * cancels itself. Returns what happened so the caller can chime.
 */
export function checkHabitTimer(today: string, now: number = Date.now()): "finished" | "expired" | null {
  const session = state.session;
  if (session === null) return null;
  if (isExpired(session, today)) {
    setState({ session: null, screen: state.screen?.mode === "session" ? null : state.screen, notice: `Phiên ${session.habitName} đã tự huỷ khi qua ngày.` });
    return "expired";
  }
  if (session.runningSince !== null && isFinished(session, now)) {
    completeHabitTimer(now);
    return "finished";
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
