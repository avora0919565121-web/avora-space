import { supabase } from "@/integrations/supabase/client";

/**
 * AVORA-108 (ADR-083, replaces the "no Đã xem" part of ADR-028) — trạng thái tin thật, có đi có lại.
 *
 * 1-1: `Đã gửi → Đã nhận → Đã xem` (Đã xem only when both share). Groups of ≤ 100: everyone sees who
 * has read / received each line. Over 100, Nhật ký, email: nothing at all. Someone who does not share
 * is shown as `Ẩn` and sees nobody else either. Every answer comes from one server function that
 * checks who is asking; read marks never travel by SELECT or realtime.
 */
export type ReceiptState = "read" | "delivered" | "not_delivered" | "hidden" | "unavailable";
export type Receipt = { userId: string; name: string; state: ReceiptState; at: string | null };
export type ReceiptCount = { read: number; delivered: number; total: number };

/** Groups larger than this have no receipts (counted on the server; the client only mirrors it). */
export const RECEIPT_GROUP_LIMIT = 100;

export class ReceiptsOffError extends Error {
  constructor() {
    super("Tắt thì bạn cũng không thấy ai đã xem tin của bạn.");
  }
}

export const receiptKeys = {
  list: (messageId: string) => ["receipts", "list", messageId] as const,
  counts: (messageId: string) => ["receipts", "counts", messageId] as const,
  share: (userId: string) => ["receipts", "share", userId] as const,
};

function isOff(message: string | undefined): boolean {
  return (message ?? "").includes("avora_receipts_off");
}

export async function fetchReceipts(messageId: string): Promise<Receipt[]> {
  const { data, error } = await supabase.rpc("get_message_receipts" as never, { p_message_id: messageId } as never);
  if (error) {
    if (isOff(error.message)) throw new ReceiptsOffError();
    throw new Error("Chưa xem được trạng thái tin.");
  }
  type Row = { user_id: string; display_name: string; state: string; at: string | null };
  return ((data ?? []) as Row[]).map((row) => ({
    userId: row.user_id,
    name: row.display_name,
    state: (["read", "delivered", "not_delivered", "hidden", "unavailable"].includes(row.state) ? row.state : "not_delivered") as ReceiptState,
    at: row.at,
  }));
}

/** Counts for the chip under my last line. Null when receipts do not apply here (empty answer). */
export async function fetchReceiptCount(messageId: string): Promise<ReceiptCount | null> {
  const { data, error } = await supabase.rpc("get_message_receipt_counts" as never, { p_message_ids: [messageId] } as never);
  if (error) {
    if (isOff(error.message)) throw new ReceiptsOffError();
    throw new Error("Chưa xem được trạng thái tin.");
  }
  const row = ((data ?? []) as { read_count: number; delivered_count: number; total: number }[])[0];
  return row === undefined ? null : { read: row.read_count, delivered: row.delivered_count, total: row.total };
}

export async function fetchShareReadStatus(userId: string): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("share_read_status" as never).eq("id", userId).maybeSingle();
  return (data as { share_read_status?: boolean } | null)?.share_read_status !== false;
}

export async function setShareReadStatus(value: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_share_read_status" as never, { p_value: value } as never);
  if (error) throw new Error("Chưa đổi được.");
}

/** null = theo cài đặt chung. */
export async function setConversationShareRead(conversationId: string, value: boolean | null): Promise<void> {
  const { error } = await supabase.rpc("set_conversation_share_read" as never, { p_conversation_id: conversationId, p_value: value } as never);
  if (error) throw new Error("Chưa đổi được.");
}

export async function fetchConversationShareRead(conversationId: string, userId: string): Promise<boolean | null> {
  const { data } = await supabase
    .from("conversation_member_prefs" as never)
    .select("share_read_status")
    .eq("conversation_id" as never, conversationId as never)
    .eq("user_id" as never, userId as never)
    .maybeSingle();
  const value = (data as { share_read_status?: boolean | null } | null)?.share_read_status;
  return value === true || value === false ? value : null;
}

/** `14:32`, yesterday → `Hôm qua 21:10`, older → `3/10 08:05`. */
export function receiptTime(at: string, now: Date = new Date()): string {
  const date = new Date(at);
  const clock = date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const day = (d: Date): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (day(date) === day(now)) return clock;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(date) === day(yesterday)) return `Hôm qua ${clock}`;
  return `${date.getDate()}/${date.getMonth() + 1} ${clock}`;
}

/** The chip under my last line in a group: `👁 12/37` · `Mọi người đã xem` · `Đã gửi`. */
export function receiptChipLabel(count: ReceiptCount): string {
  if (count.total > 0 && count.read >= count.total) return "Mọi người đã xem";
  if (count.read === 0) return "Đã gửi";
  return `👁 ${count.read}/${count.total}`;
}

/** The sheet's sections, newest read first; `Ẩn` is only a number, never names. */
export function groupReceipts(rows: readonly Receipt[]): { read: Receipt[]; delivered: Receipt[]; notDelivered: Receipt[]; hidden: number } {
  const byNewest = (a: Receipt, b: Receipt): number => (b.at ?? "").localeCompare(a.at ?? "");
  return {
    read: rows.filter((r) => r.state === "read").sort(byNewest),
    delivered: rows.filter((r) => r.state === "delivered").sort(byNewest),
    notDelivered: rows.filter((r) => r.state === "not_delivered"),
    hidden: rows.filter((r) => r.state === "hidden").length,
  };
}
