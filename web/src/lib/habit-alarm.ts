import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/lib/log";

/**
 * VMT 10/10 21:11 — the "đủ giờ" notification of a `Cứ chạy` session when Avora is closed: the
 * server keeps only the moment (one `push_outbox` row, sent by send-push, quiet modes checked at
 * sending). `at = null` cancels. Best effort: offline or refused, the clock itself is unaffected.
 */
export type HabitAlarm = { habitId: string; localDate: string; windowIndex: number; at: number | null };

type AlarmSender = (alarm: HabitAlarm) => Promise<void>;

async function sendToServer(alarm: HabitAlarm): Promise<void> {
  const { error } = await supabase.rpc("set_habit_alarm" as never, {
    p_habit: alarm.habitId,
    p_local_date: alarm.localDate,
    p_window: alarm.windowIndex,
    p_at: alarm.at === null ? null : new Date(alarm.at).toISOString(),
  } as never);
  if (error !== null) logError("habit-alarm", { code: error.code, message: error.message });
}

let sender: AlarmSender = sendToServer;

/** Test seam. */
export function setHabitAlarmSender(next: AlarmSender | null): void {
  sender = next ?? sendToServer;
}

export function setHabitAlarm(alarm: HabitAlarm): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  void sender(alarm).catch(() => undefined);
}
