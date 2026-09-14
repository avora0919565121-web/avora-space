import { supabase } from "@/integrations/supabase/client";
import {
  HEAVY_TASK_MINUTES,
  type TaskFlagIndex,
  type TaskFlagValue,
} from "@/lib/tasks";

/**
 * How one person reads one task: does it matter to them, and how long will it cost them.
 *
 * Both questions used to be answered once per task, for everybody. That was wrong in a way
 * that only shows up between two people: the person who asked for the work and the person
 * carrying it rarely agree about how heavy it is, and "important" is not a property of a task
 * at all — it is a property of someone's week. So each side now keeps its own row, and neither
 * can see or disturb the other's.
 */
export const taskFlagKeys = {
  all: ["task-flags"] as const,
  list: ["task-flags", "list"] as const,
};

export type TaskFlagRow = {
  taskId: string;
  isImportant: boolean;
  durationMinutes: number | null;
};

const FLAG_COLUMNS = "task_id, is_important, duration_minutes";

function fail(code: string | undefined, message: string): Error {
  console.error(`[task-flags] ${code ?? "unknown"}: ${message}`);
  const normalized = message.toLowerCase();
  if (normalized.includes("task_flags_duration_positive"))
    return new Error("Thời lượng phải lớn hơn 0 phút.");
  if (normalized.includes("task_flags_duration_sane"))
    return new Error("Thời lượng này dài quá mức hợp lý.");
  if (code === "42501" || normalized.includes("permission denied"))
    return new Error("Máy chủ chưa cho phép thao tác này.");
  if (normalized.includes("row-level security"))
    return new Error("Bạn không có quyền đánh dấu nhiệm vụ này.");
  if (normalized.includes("failed to fetch"))
    return new Error("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
  return new Error("Không lưu được đánh dấu. Vui lòng thử lại.");
}

/**
 * Two quick answers plus an exact one.
 *
 * Most people do not know whether something will take 40 or 55 minutes, and asking them to
 * decide is a worse question than the one being answered. "Under an hour" and "over an hour"
 * is the distinction the heavy view actually needs, so those are offered first and a precise
 * number stays available for whoever has one.
 */
export const DURATION_PRESETS: readonly { id: "light" | "heavy"; label: string; minutes: number }[] = [
  { id: "light", label: "Nhẹ (dưới 1 giờ)", minutes: 30 },
  { id: "heavy", label: "Nặng (trên 1 giờ)", minutes: 120 },
] as const;

/** Which quick answer a stored estimate corresponds to, for showing the choice as selected. */
export function durationPresetOf(minutes: number | null): "light" | "heavy" | null {
  if (minutes === null) return null;
  return minutes > HEAVY_TASK_MINUTES ? "heavy" : "light";
}

/** A short human reading of an estimate: hours once it passes one, minutes below that. */
export function formatDuration(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours} giờ`;
  return `${hours} giờ ${rest} phút`;
}

/** An empty or unparseable estimate means "not estimated", never zero. */
export function parseDurationInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

type FlagRow = { task_id: string; is_important: boolean | null; duration_minutes: number | null };

/**
 * This person's own flags for every task they can see. RLS restricts the rows to theirs, so
 * there is no filter here to forget — the query cannot return anyone else's reading.
 */
export async function fetchTaskFlags(): Promise<TaskFlagRow[]> {
  const { data, error } = await supabase.from("task_flags").select(FLAG_COLUMNS);
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => {
    const flag = row as FlagRow;
    return {
      taskId: flag.task_id,
      isImportant: flag.is_important ?? false,
      durationMinutes: flag.duration_minutes,
    };
  });
}

/** Rows to the lookup the list views read. */
export function toFlagIndex(rows: readonly TaskFlagRow[]): TaskFlagIndex {
  const index = new Map<string, TaskFlagValue>();
  for (const row of rows) {
    index.set(row.taskId, {
      isImportant: row.isImportant,
      durationMinutes: row.durationMinutes,
    });
  }
  return index;
}

/**
 * Writes this person's reading of a task, creating the row the first time.
 *
 * `user_id` is sent because the row is keyed by it, and the policy checks it against the
 * caller's own identity — a mismatched id is refused by the database rather than trusted.
 */
export async function saveTaskFlag(
  taskId: string,
  userId: string,
  patch: Partial<TaskFlagValue>,
  current?: TaskFlagValue,
): Promise<TaskFlagRow> {
  const next: TaskFlagValue = {
    isImportant: patch.isImportant ?? current?.isImportant ?? false,
    durationMinutes:
      patch.durationMinutes !== undefined ? patch.durationMinutes : current?.durationMinutes ?? null,
  };

  const { data, error } = await supabase
    .from("task_flags")
    .upsert(
      {
        task_id: taskId,
        user_id: userId,
        is_important: next.isImportant,
        duration_minutes: next.durationMinutes,
      },
      { onConflict: "task_id,user_id" },
    )
    .select(FLAG_COLUMNS)
    .single();

  if (error) throw fail(error.code, error.message);
  const row = data as FlagRow;
  return {
    taskId: row.task_id,
    isImportant: row.is_important ?? false,
    durationMinutes: row.duration_minutes,
  };
}

/** Replaces one entry in a cached flag list, or adds it when it is the first for that task. */
export function upsertFlagRow(list: readonly TaskFlagRow[], incoming: TaskFlagRow): TaskFlagRow[] {
  const index = list.findIndex((row) => row.taskId === incoming.taskId);
  if (index === -1) return [...list, incoming];
  const current = list[index];
  if (
    current !== undefined &&
    current.isImportant === incoming.isImportant &&
    current.durationMinutes === incoming.durationMinutes
  )
    return [...list];
  const next = [...list];
  next[index] = incoming;
  return next;
}
