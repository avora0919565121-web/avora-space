import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { logError } from "@/lib/log";

/**
 * Gửi hẹn giờ (Đợt gộp 2 · B2). The message is the sender's until it goes: only they can read
 * the row (RLS), and the database delivers it every minute — never the sender's device.
 */
export type ScheduledMessage = {
  id: string;
  conversationId: string;
  content: string;
  sendAt: string;
  status: "pending" | "sent" | "cancelled" | "failed";
  failReason: string | null;
  sentMessageId: string | null;
};

type Row = {
  id: string;
  conversation_id: string;
  content: string;
  send_at: string;
  status: string;
  fail_reason: string | null;
  sent_message_id: string | null;
};

function toScheduled(row: Row): ScheduledMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    content: row.content,
    sendAt: row.send_at,
    status: (["pending", "sent", "cancelled", "failed"].includes(row.status) ? row.status : "pending") as ScheduledMessage["status"],
    failReason: row.fail_reason,
    sentMessageId: row.sent_message_id,
  };
}

function fail(code: string | undefined, message: string): Error {
  logError("schedule", { code, message });
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_schedule_too_soon")) return new Error("Hẹn giờ ít nhất 5 phút sau bây giờ.");
  if (normalized.includes("avora_schedule_too_far")) return new Error("Chỉ hẹn được trong vòng 30 ngày.");
  if (normalized.includes("avora_schedule_limit")) return new Error("Mỗi cuộc trò chuyện giữ tối đa 20 tin hẹn giờ.");
  if (normalized.includes("avora_schedule_not_here")) return new Error("Không hẹn giờ được ở đây.");
  if (normalized.includes("avora_schedule_missing")) return new Error("Tin hẹn giờ này không còn nữa.");
  if (normalized.includes("avora_contact_unavailable")) return new Error("Không gửi được tới người này.");
  if (normalized.includes("avora_not_connected")) return new Error("Hai bạn không còn là bạn nên không gửi thêm được.");
  if (normalized.includes("avora_not_a_participant")) return new Error("Bạn không còn trong cuộc trò chuyện này.");
  if (normalized.includes("failed to fetch")) return new Error("Cần kết nối mạng để hẹn giờ.");
  return new Error("Không hẹn giờ được. Vui lòng thử lại.");
}

export const scheduleKeys = {
  thread: (conversationId: string) => ["scheduled-messages", conversationId] as const,
};

const COLUMNS = "id, conversation_id, content, send_at, status, fail_reason, sent_message_id";

/** Pending + failed ones (for the strip) and sent ones (for the sender's own small clock). */
export async function fetchMyScheduled(conversationId: string): Promise<ScheduledMessage[]> {
  const { data, error } = await supabase
    .from("scheduled_messages")
    .select(COLUMNS)
    .eq("conversation_id", conversationId)
    .in("status", ["pending", "failed", "sent"])
    .order("send_at", { ascending: true })
    .limit(500);
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toScheduled(row as Row));
}

export function useMyScheduled(conversationId: string | undefined, enabled: boolean): UseQueryResult<ScheduledMessage[], Error> {
  const { user } = useAuth();
  return useQuery<ScheduledMessage[], Error>({
    queryKey: scheduleKeys.thread(conversationId ?? ""),
    queryFn: () => fetchMyScheduled(conversationId as string),
    enabled: enabled && conversationId !== undefined && Boolean(user?.id),
    refetchInterval: 60_000,
  });
}

export function useScheduleActions(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  const refresh = (): void => {
    if (conversationId !== undefined) void queryClient.invalidateQueries({ queryKey: scheduleKeys.thread(conversationId) });
  };
  const schedule = useMutation({
    mutationFn: async (input: { content: string; sendAt: Date; mentionedIds: string[]; replyToId: string | null }) => {
      const { error } = await supabase.rpc("schedule_message", {
        p_conversation_id: conversationId as string,
        p_content: input.content,
        p_send_at: input.sendAt.toISOString(),
        p_mentioned_user_ids: input.mentionedIds,
        p_reply_to_message_id: input.replyToId as string,
      });
      if (error) throw fail(error.code, error.message);
    },
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: async (input: { id: string; content: string; sendAt: Date }) => {
      const { error } = await supabase.rpc("update_scheduled_message", {
        p_id: input.id,
        p_content: input.content,
        p_send_at: input.sendAt.toISOString(),
      });
      if (error) throw fail(error.code, error.message);
    },
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("cancel_scheduled_message", { p_id: id });
      if (error) throw fail(error.code, error.message);
    },
    onSuccess: refresh,
  });
  const sendNow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("send_scheduled_message_now", { p_id: id });
      if (error) throw fail(error.code, error.message);
    },
    onSuccess: refresh,
  });
  return { schedule, update, cancel, sendNow };
}

/** Next multiple of 5 minutes at or after `date`. */
function roundUpToFive(date: Date): Date {
  const step = 5 * 60_000;
  return new Date(Math.ceil(date.getTime() / step) * step);
}

export type QuickTime = { id: "hour" | "tonight" | "morning"; label: string; at: Date };

/**
 * The quick choices: "Sau 1 giờ" (rounded up to 5 minutes) · "Tối nay 20:00" (only before 19:55)
 * · "Sáng mai 08:00".
 */
export function quickScheduleTimes(now: Date): QuickTime[] {
  const inAnHour = roundUpToFive(new Date(now.getTime() + 60 * 60_000));
  const tonight = new Date(now);
  tonight.setHours(20, 0, 0, 0);
  const morning = new Date(now);
  morning.setDate(morning.getDate() + 1);
  morning.setHours(8, 0, 0, 0);
  const cutoff = new Date(now);
  cutoff.setHours(19, 55, 0, 0);
  const list: QuickTime[] = [{ id: "hour", label: "Sau 1 giờ", at: inAnHour }];
  if (now.getTime() < cutoff.getTime()) list.push({ id: "tonight", label: "Tối nay 20:00", at: tonight });
  list.push({ id: "morning", label: "Sáng mai 08:00", at: morning });
  return list;
}

/** "Sẽ gửi lúc 20:00, hôm nay 28/09" / "…, ngày mai 29/09" / "…, T5 01/10". */
export function sendAtLine(at: Date, now: Date = new Date()): string {
  const pad = (value: number): string => `${value}`.padStart(2, "0");
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const dayMonth = `${pad(at.getDate())}/${pad(at.getMonth() + 1)}`;
  const startOf = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(at) - startOf(now)) / 86_400_000);
  const days = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  const when = diff === 0 ? `hôm nay ${dayMonth}` : diff === 1 ? `ngày mai ${dayMonth}` : `${days[at.getDay()]} ${dayMonth}`;
  return `${clock}, ${when}`;
}
