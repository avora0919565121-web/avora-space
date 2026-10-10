import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  addDays,
  DEFAULT_WHEN_AWAY,
  cleanWindows,
  doneIndexOf,
  doneKey,
  localDateOf,
  type DoneIndex,
  type Habit,
  type HabitDraft,
  type HabitLog,
} from "@/lib/habits";
import { logError } from "@/lib/log";

/**
 * AVORA-107 · PHẦN 1 — Thói quen on this device first (ADR-025: chạy đủ khi không mạng).
 *
 * Every change lands in a small local snapshot at once and waits in a queue; the queue goes to
 * the server one RPC at a time, in order, whenever there is a network. Ids are made here, so a
 * retry can never make a second habit or a second tick (the server returns the existing row).
 * A change from an older version than the server's is dropped and the server's copy wins.
 */
export type HabitOp =
  | { kind: "create"; habit: Habit }
  | { kind: "update"; id: string; draft: HabitDraft; baseVersion: number }
  | { kind: "pause"; id: string; paused: boolean }
  | { kind: "archive"; id: string; archived: boolean }
  | { kind: "log"; log: HabitLog }
  | { kind: "unlog"; habitId: string; localDate: string; windowIndex: number }
  | { kind: "abandon"; log: HabitLog };

type State = {
  userId: string | null;
  habits: Habit[];
  logs: HabitLog[];
  /** Done count older than the loaded logs, per habit — so `Tổng` stays right offline. */
  totalsBefore: Record<string, number>;
  ops: HabitOp[];
  isLoaded: boolean;
  isSyncing: boolean;
  loadFailed: boolean;
};

/** Days of logs kept on the device: enough for `4 tuần gần nhất` and the history. */
export const HABIT_LOG_DAYS = 35;
const STORAGE_PREFIX = "avora-habits:";

const EMPTY: State = { userId: null, habits: [], logs: [], totalsBefore: {}, ops: [], isLoaded: false, isSyncing: false, loadFailed: false };

let state: State = EMPTY;
const listeners = new Set<() => void>();
let flushing: Promise<void> | null = null;
let retryTimer: number | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(next: Partial<State>, persist: boolean = true): void {
  state = { ...state, ...next };
  if (persist) save();
  emit();
}

function save(): void {
  if (state.userId === null) return;
  try {
    const { habits, logs, totalsBefore, ops } = state;
    localStorage.setItem(STORAGE_PREFIX + state.userId, JSON.stringify({ habits, logs, totalsBefore, ops }));
  } catch {
    // Storage full or refused: the app still works for this session.
  }
}

function restore(userId: string): Pick<State, "habits" | "logs" | "totalsBefore" | "ops"> | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<State>;
    return {
      // Snapshots from before "Khi rời Avora" carry no `whenAway`: they read as the default.
      habits: Array.isArray(parsed.habits) ? parsed.habits.map((habit) => ({ ...habit, whenAway: habit.whenAway === "stop" ? "stop" : DEFAULT_WHEN_AWAY })) : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      totalsBefore: parsed.totalsBefore ?? {},
      ops: Array.isArray(parsed.ops) ? parsed.ops : [],
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ server mapping

type HabitRow = {
  id: string; name: string; kind: string; target_minutes: number | null; weekdays: number[] | null; windows: unknown;
  reminders_on: boolean; when_away?: string | null; paused_at: string | null; archived_at: string | null; version: number; created_at: string;
};
type LogRow = {
  id: string; habit_id: string; local_date: string; window_index: number; status: string; done_at: string; source: string;
  duration_seconds: number | null; note: string | null;
};

function toHabit(row: HabitRow): Habit {
  const windows = Array.isArray(row.windows)
    ? (row.windows as { time?: unknown; remind?: unknown }[]).map((item) => ({ time: String(item.time ?? "08:00"), remind: item.remind !== false }))
    : [];
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === "timed" ? "timed" : "check",
    targetMinutes: row.target_minutes,
    weekdays: row.weekdays ?? [],
    windows,
    remindersOn: row.reminders_on,
    whenAway: row.when_away === "stop" ? "stop" : DEFAULT_WHEN_AWAY,
    pausedAt: row.paused_at,
    archivedAt: row.archived_at,
    version: row.version,
    createdAt: row.created_at,
  };
}

function toLog(row: LogRow): HabitLog {
  return {
    id: row.id,
    habitId: row.habit_id,
    localDate: row.local_date,
    windowIndex: row.window_index,
    status: row.status === "abandoned" ? "abandoned" : "done",
    doneAt: row.done_at,
    source: row.source === "timer" ? "timer" : "manual",
    durationSeconds: row.duration_seconds,
    note: row.note,
  };
}

type RpcError = { code?: string; message: string } | null;

async function rpc(name: string, args: Record<string, unknown>): Promise<RpcError> {
  const { error } = await supabase.rpc(name as never, args as never);
  return error === null ? null : { code: error.code, message: error.message };
}

function execute(op: HabitOp): Promise<RpcError> {
  switch (op.kind) {
    case "create":
      return rpc("create_habit", {
        p_id: op.habit.id,
        p_name: op.habit.name,
        p_kind: op.habit.kind,
        p_target_minutes: op.habit.targetMinutes,
        p_weekdays: op.habit.weekdays,
        p_windows: op.habit.windows,
        p_reminders_on: op.habit.remindersOn,
        p_when_away: op.habit.whenAway,
      });
    case "update":
      return rpc("update_habit", {
        p_id: op.id,
        p_name: op.draft.name,
        p_kind: op.draft.kind,
        p_target_minutes: op.draft.kind === "timed" ? op.draft.targetMinutes : null,
        p_weekdays: op.draft.weekdays,
        p_windows: op.draft.windows,
        p_reminders_on: op.draft.remindersOn,
        p_version: op.baseVersion,
        p_when_away: op.draft.whenAway,
      });
    case "pause":
      return rpc("pause_habit", { p_id: op.id, p_paused: op.paused });
    case "archive":
      return rpc("archive_habit", { p_id: op.id, p_archived: op.archived });
    case "log":
      return rpc("log_habit", {
        p_id: op.log.id,
        p_habit: op.log.habitId,
        p_local_date: op.log.localDate,
        p_window: op.log.windowIndex,
        p_source: op.log.source,
        p_duration_seconds: op.log.durationSeconds,
      });
    case "unlog":
      return rpc("unlog_habit", { p_habit: op.habitId, p_local_date: op.localDate, p_window: op.windowIndex });
    case "abandon":
      return rpc("abandon_habit_session", {
        p_id: op.log.id,
        p_habit: op.log.habitId,
        p_local_date: op.log.localDate,
        p_window: op.log.windowIndex,
        p_duration_seconds: op.log.durationSeconds,
        p_note: op.log.note,
      });
  }
}

/** A refusal that will not get better by trying again (conflict, gone, out of range). */
export function isPermanentHabitError(error: { code?: string; message: string }): boolean {
  const message = error.message.toLowerCase();
  if (message.includes("avora_")) return true;
  return ["42501", "22023", "40001", "23514", "23505", "P0001", "PGRST202"].includes(error.code ?? "");
}

function permanentMessage(error: { message: string }): string {
  if (error.message.includes("avora_habit_conflict")) return "Thói quen này vừa được sửa ở máy khác — đã lấy bản mới.";
  if (error.message.includes("avora_habit_date")) return "Ngày này đã qua, không ghi thêm được.";
  if (error.message.includes("avora_habit_too_many")) return "Đã có 50 thói quen đang theo dõi.";
  return "Một thay đổi thói quen chưa lưu được — đã lấy lại bản trên máy chủ.";
}

async function fetchServer(userId: string): Promise<Pick<State, "habits" | "logs" | "totalsBefore">> {
  const since = addDays(localDateOf(), -HABIT_LOG_DAYS);
  // rows-bounded: ≤ 50 running habits per person (server cap) + their archived ones.
  const habitsQuery = supabase.from("habits" as never).select("id, name, kind, target_minutes, weekdays, windows, reminders_on, when_away, paused_at, archived_at, version, created_at").eq("user_id", userId);
  // rows-bounded: 35 days × ≤ 12 windows × the person's habits.
  const logsQuery = supabase.from("habit_logs" as never).select("id, habit_id, local_date, window_index, status, done_at, source, duration_seconds, note").gte("local_date", since).limit(5000);
  const [habitsRes, logsRes, totalsRes] = await Promise.all([habitsQuery, logsQuery, supabase.rpc("my_habit_totals" as never)]);
  if (habitsRes.error !== null || logsRes.error !== null || totalsRes.error !== null) throw new Error("Không tải được thói quen.");
  const habits = ((habitsRes.data ?? []) as unknown as HabitRow[]).map(toHabit);
  const logs = ((logsRes.data ?? []) as unknown as LogRow[]).map(toLog);
  const recent = new Map<string, number>();
  for (const log of logs) if (log.status === "done") recent.set(log.habitId, (recent.get(log.habitId) ?? 0) + 1);
  const totalsBefore: Record<string, number> = {};
  for (const row of (totalsRes.data ?? []) as unknown as { habit_id: string; done_total: number | string }[]) {
    totalsBefore[row.habit_id] = Math.max(0, Number(row.done_total) - (recent.get(row.habit_id) ?? 0));
  }
  return { habits, logs, totalsBefore };
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function scheduleRetry(): void {
  if (retryTimer !== null || typeof window === "undefined") return;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void flush();
  }, 30_000);
}

/** Sends the queue in order. Stops (and waits) on a network problem; drops a refused change. */
export function flush(): Promise<void> {
  if (flushing !== null) return flushing;
  // Started on the next tick, so `flushing` is set before the run can finish and clear it.
  flushing = Promise.resolve().then(async () => {
    let refused = false;
    setState({ isSyncing: true }, false);
    try {
      while (state.ops.length > 0 && state.userId !== null) {
        if (isOffline()) {
          scheduleRetry();
          return;
        }
        const op = state.ops[0];
        let error: RpcError;
        try {
          error = await execute(op);
        } catch (thrown) {
          error = { message: thrown instanceof Error ? thrown.message : "network" };
        }
        if (error !== null && !isPermanentHabitError(error)) {
          scheduleRetry();
          return;
        }
        if (error !== null) {
          refused = true;
          logError("habits", { kind: op.kind, code: error.code, message: error.message });
          toast(permanentMessage(error));
        }
        setState({ ops: state.ops.slice(1) });
      }
      if (state.userId !== null && state.ops.length === 0) await pull(state.userId, refused);
    } finally {
      setState({ isSyncing: false }, false);
      flushing = null;
    }
  });
  return flushing;
}

async function pull(userId: string, force: boolean): Promise<void> {
  if (isOffline() && !force) return;
  try {
    const server = await fetchServer(userId);
    // A change made while this read was on its way stays on top.
    if (state.userId !== userId || state.ops.length > 0) return;
    setState({ ...server, isLoaded: true, loadFailed: false });
  } catch (error) {
    logError("habits", error);
    setState({ isLoaded: true, loadFailed: state.habits.length === 0 }, false);
  }
}

/** Opens one person's habits: what this device remembers at once, then the server. */
export function startHabits(userId: string): void {
  if (state.userId === userId) return;
  const cached = restore(userId);
  state = { ...EMPTY, userId, ...(cached ?? {}), isLoaded: cached !== null };
  emit();
  void flush();
}

/** Tests only. */
export function resetHabitStore(): void {
  state = EMPTY;
  flushing = null;
  if (retryTimer !== null) window.clearTimeout(retryTimer);
  retryTimer = null;
  emit();
}

function enqueue(op: HabitOp, apply: (current: State) => Partial<State>): void {
  setState({ ...apply(state), ops: [...state.ops, op] });
  void flush();
}

// ------------------------------------------------------------------ actions

function newId(): string {
  return crypto.randomUUID();
}

export function createHabit(draft: HabitDraft): string {
  const habit: Habit = {
    id: newId(),
    name: draft.name.trim(),
    kind: draft.kind,
    targetMinutes: draft.kind === "timed" ? draft.targetMinutes : null,
    weekdays: [...new Set(draft.weekdays)].sort((a, b) => a - b),
    windows: cleanWindows(draft.windows),
    remindersOn: draft.remindersOn,
    whenAway: draft.whenAway ?? DEFAULT_WHEN_AWAY,
    pausedAt: null,
    archivedAt: null,
    version: 1,
    createdAt: new Date().toISOString(),
  };
  enqueue({ kind: "create", habit }, (current) => ({ habits: [...current.habits, habit] }));
  return habit.id;
}

export function updateHabit(id: string, draft: HabitDraft): void {
  const habit = state.habits.find((item) => item.id === id);
  if (habit === undefined) return;
  const clean: HabitDraft = { ...draft, name: draft.name.trim(), windows: cleanWindows(draft.windows), weekdays: [...new Set(draft.weekdays)].sort((a, b) => a - b), targetMinutes: draft.kind === "timed" ? draft.targetMinutes : null };
  enqueue({ kind: "update", id, draft: clean, baseVersion: habit.version }, (current) => ({
    habits: current.habits.map((item) => (item.id === id ? { ...item, ...clean, version: item.version + 1 } : item)),
  }));
}

export function pauseHabit(id: string, paused: boolean): void {
  enqueue({ kind: "pause", id, paused }, (current) => ({
    habits: current.habits.map((item) => (item.id === id ? { ...item, pausedAt: paused ? (item.pausedAt ?? new Date().toISOString()) : null, version: item.version + 1 } : item)),
  }));
}

export function archiveHabit(id: string, archived: boolean = true): void {
  enqueue({ kind: "archive", id, archived }, (current) => ({
    habits: current.habits.map((item) => (item.id === id ? { ...item, archivedAt: archived ? (item.archivedAt ?? new Date().toISOString()) : null, version: item.version + 1 } : item)),
  }));
}

/** Ticks one window. Ticking a window already done does nothing (no double row, ever). */
export function logHabit(habitId: string, localDate: string, windowIndex: number, extra?: { source?: "manual" | "timer"; durationSeconds?: number | null }): void {
  const key = doneKey(habitId, localDate, windowIndex);
  if (doneIndexOf(state.logs).has(key)) return;
  const log: HabitLog = {
    id: newId(),
    habitId,
    localDate,
    windowIndex,
    status: "done",
    doneAt: new Date().toISOString(),
    source: extra?.source ?? "manual",
    durationSeconds: extra?.durationSeconds ?? null,
    note: null,
  };
  enqueue({ kind: "log", log }, (current) => ({ logs: [...current.logs, log] }));
}

/** Un-ticks a window of today. A tick still waiting to be sent is simply taken back. */
export function unlogHabit(habitId: string, localDate: string, windowIndex: number): void {
  const pendingIndex = state.ops.findIndex((op) => op.kind === "log" && op.log.habitId === habitId && op.log.localDate === localDate && op.log.windowIndex === windowIndex);
  const logs = state.logs.filter((log) => !(log.status === "done" && log.habitId === habitId && log.localDate === localDate && log.windowIndex === windowIndex));
  if (pendingIndex >= 0 && !(flushing !== null && pendingIndex === 0)) {
    setState({ logs, ops: state.ops.filter((_, index) => index !== pendingIndex) });
    return;
  }
  enqueue({ kind: "unlog", habitId, localDate, windowIndex }, () => ({ logs }));
}

export function abandonHabitSession(habitId: string, localDate: string, windowIndex: number, durationSeconds: number, note: string | null): void {
  const log: HabitLog = {
    id: newId(),
    habitId,
    localDate,
    windowIndex,
    status: "abandoned",
    doneAt: new Date().toISOString(),
    source: "timer",
    durationSeconds: Math.max(0, Math.round(durationSeconds)),
    note: note === null || note.trim() === "" ? null : note.trim().slice(0, 500),
  };
  enqueue({ kind: "abandon", log }, (current) => ({ logs: [...current.logs, log] }));
}

/** Ticks / un-ticks one window of today — the one action every habit list shares. */
export function toggleHabitWindow(habit: Pick<Habit, "id">, today: string, windowIndex: number, isDone: boolean): void {
  if (isDone) unlogHabit(habit.id, today, windowIndex);
  else logHabit(habit.id, today, windowIndex);
}

// ------------------------------------------------------------------ hooks

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): State {
  return state;
}

/** The device day, turning over at 24:00 while the app stays open. */
export function useLocalDay(): string {
  const [day, setDay] = useState<string>(() => localDateOf());
  useEffect(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const timer = window.setTimeout(() => setDay(localDateOf()), Math.max(1_000, next.getTime() - now.getTime()));
    const onVisible = (): void => {
      if (document.visibilityState === "visible") setDay(localDateOf());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [day]);
  return day;
}

export type HabitsApi = {
  habits: Habit[];
  logs: HabitLog[];
  done: DoneIndex;
  today: string;
  isLoaded: boolean;
  loadFailed: boolean;
  /** Changes on this device not yet on the server (shown as `Đang chờ mạng`). */
  pendingCount: number;
  totalOf: (habitId: string) => number;
  retry: () => void;
};

/** Thói quen for the signed-in person, from this device first. */
export function useHabits(): HabitsApi {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  useEffect(() => {
    if (userId !== null) startHabits(userId);
  }, [userId]);
  useEffect(() => {
    const onOnline = (): void => void flush();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const today = useLocalDay();
  const mine = current.userId === userId ? current : EMPTY;
  const done = useMemo(() => doneIndexOf(mine.logs), [mine.logs]);
  const totalOf = useCallback(
    (habitId: string): number => (mine.totalsBefore[habitId] ?? 0) + mine.logs.filter((log) => log.habitId === habitId && log.status === "done").length,
    [mine.logs, mine.totalsBefore],
  );
  const retry = useCallback((): void => void flush(), []);
  return {
    habits: mine.habits,
    logs: mine.logs,
    done,
    today,
    isLoaded: mine.isLoaded,
    loadFailed: mine.loadFailed,
    pendingCount: mine.ops.length,
    totalOf,
    retry,
  };
}
