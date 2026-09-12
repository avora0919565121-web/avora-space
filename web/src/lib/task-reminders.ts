import { supabase } from "@/integrations/supabase/client";
import { reminderInstant, reminderOffsetMinutes, type ReminderPreset } from "@/lib/task-schedule";

/**
 * Phase 3B reminders.
 *
 * A reminder belongs to a PERSON, not to a task: on shared 1-1 work each side sets their own,
 * so wanting a nudge at 08:30 does not impose one on the other party.
 *
 * Delivery is in-app. This app has no mail, SMS or push sender, so a reminder surfaces when
 * the person has AVORA open (and, with permission, as a browser notification). It cannot
 * reach a closed tab — see the note on `isSent`.
 */
export type TaskReminder = {
  id: string;
  taskId: string;
  /** When it should fire, as an absolute instant. */
  at: string;
  timezone: string;
  offsetMinutes: number | null;
  /** Already surfaced once, so it stops nagging. Not "emailed" — nothing sends mail here. */
  isSent: boolean;
};

export const taskReminderKeys = {
  all: ["task-reminders"] as const,
  list: ["task-reminders", "list"] as const,
};

type Row = {
  id: string;
  task_id: string;
  reminder_time: string;
  reminder_tz: string;
  offset_minutes: number | null;
  is_sent: boolean;
};

function toReminder(row: Row): TaskReminder {
  return {
    id: row.id,
    taskId: row.task_id,
    at: row.reminder_time,
    timezone: row.reminder_tz,
    offsetMinutes: row.offset_minutes,
    isSent: row.is_sent,
  };
}

const COLUMNS = "id, task_id, reminder_time, reminder_tz, offset_minutes, is_sent";

function toVietnameseReminderError(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_reminder_after_deadline"))
    return "Nhắc nhở không thể sau hạn hoàn thành.";
  if (normalized.includes("avora_reminder_in_past")) return "Thời điểm nhắc đã qua rồi.";
  if (normalized.includes("avora_reminder_timezone_invalid")) return "Múi giờ không hợp lệ.";
  if (normalized.includes("avora_reminder_task_missing")) return "Không tìm thấy nhiệm vụ này.";
  if (code === "23505" || normalized.includes("duplicate key")) return "Bạn đã đặt nhắc nhở này rồi.";
  if (code === "42501" || normalized.includes("permission denied"))
    return "Máy chủ chưa cho phép thao tác này.";
  if (normalized.includes("row-level security")) return "Bạn không có quyền với nhắc nhở này.";
  if (normalized.includes("failed to fetch")) return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  return "Không đặt được nhắc nhở. Vui lòng thử lại.";
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[task-reminders] ${code ?? "unknown"}: ${message}`);
  return new Error(toVietnameseReminderError(code, message));
}

export async function fetchTaskReminders(): Promise<TaskReminder[]> {
  const { data, error } = await supabase
    .from("task_reminders")
    .select(COLUMNS)
    .order("reminder_time", { ascending: true });
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toReminder(row as Row));
}

export async function createTaskReminder(
  taskId: string,
  userId: string,
  preset: ReminderPreset,
  deadlineDate: string,
  deadlineTime: string | null,
  timezone: string,
): Promise<TaskReminder | null> {
  const at = reminderInstant(preset, deadlineDate, deadlineTime);
  if (at === null) return null;
  const offset = reminderOffsetMinutes(preset, deadlineDate, deadlineTime);

  const { data, error } = await supabase
    .from("task_reminders")
    .insert({
      task_id: taskId,
      user_id: userId,
      reminder_time: at.toISOString(),
      reminder_tz: timezone,
      offset_minutes: offset,
    })
    .select(COLUMNS)
    .single();
  if (error) throw fail(error.code, error.message);
  return toReminder(data as Row);
}

export async function deleteTaskReminder(reminderId: string): Promise<void> {
  const { error } = await supabase.from("task_reminders").delete().eq("id", reminderId);
  if (error) throw fail(error.code, error.message);
}

/** Marks a reminder as already shown, so re-opening the app does not replay it. */
export async function markReminderSurfaced(reminderId: string): Promise<void> {
  const { error } = await supabase.from("task_reminders").update({ is_sent: true }).eq("id", reminderId);
  if (error) throw fail(error.code, error.message);
}

/** Reminders whose moment has arrived and which have not been shown yet. */
export function dueReminders(reminders: readonly TaskReminder[], now: Date = new Date()): TaskReminder[] {
  return reminders.filter((reminder) => !reminder.isSent && new Date(reminder.at).getTime() <= now.getTime());
}
