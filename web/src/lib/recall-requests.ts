import { supabase } from "@/integrations/supabase/client";

/**
 * Asking someone to take back what they said.
 *
 * Deliberately only a request. The words belong to whoever wrote them, so nothing is withdrawn
 * automatically and the sender is never overruled — they see the ask and decide. This is the
 * honest shape of the thing people actually want: "that shouldn't be there" is a sentence one
 * person says to another, not a power one holds over the other.
 */
export type RecallRequest = {
  id: string;
  messageId: string;
  requestedBy: string;
  createdAt: string;
};

export const recallRequestKeys = {
  all: ["message-recall-requests"] as const,
  thread: (conversationId: string) => ["message-recall-requests", conversationId] as const,
};

function fail(code: string | undefined, message: string): Error {
  console.error(`[recall-requests] ${code ?? "unknown"}: ${message}`);
  const normalized = message.toLowerCase();
  if (normalized.includes("duplicate key"))
    return new Error("Bạn đã đề nghị thu hồi tin nhắn này rồi.");
  if (code === "42501" || normalized.includes("permission denied") || normalized.includes("row-level"))
    return new Error("Bạn không đề nghị thu hồi tin nhắn này được.");
  if (normalized.includes("failed to fetch"))
    return new Error("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
  return new Error("Không gửi được đề nghị. Vui lòng thử lại.");
}

type RecallRequestRow = {
  id: string;
  message_id: string;
  requested_by: string;
  created_at: string;
};

function toRecallRequest(row: RecallRequestRow): RecallRequest {
  return {
    id: row.id,
    messageId: row.message_id,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
  };
}

/**
 * The open asks in one conversation. RLS already narrows this to the two people each ask
 * concerns — the sender being asked and the person who asked — so nothing here filters by
 * audience a second time.
 */
export async function fetchRecallRequests(conversationId: string): Promise<RecallRequest[]> {
  const { data: messageRows, error: messageError } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId);

  if (messageError) throw fail(messageError.code, messageError.message);

  const ids = (messageRows ?? []).map((row) => row.id);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("message_recall_request")
    .select("id, message_id, requested_by, created_at")
    .in("message_id", ids)
    .is("resolved_at", null)
    .order("created_at", { ascending: true });

  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toRecallRequest(row as RecallRequestRow));
}

/** Asks the sender to withdraw one message. Never available on your own message. */
export async function requestRecall(messageId: string, requestedBy: string): Promise<RecallRequest> {
  const { data, error } = await supabase
    .from("message_recall_request")
    .insert({ message_id: messageId, requested_by: requestedBy })
    .select("id, message_id, requested_by, created_at")
    .single();

  if (error) throw fail(error.code, error.message);
  return toRecallRequest(data as RecallRequestRow);
}

/**
 * Closes every open ask on one message. Called when the sender has answered — either by
 * withdrawing the message or by deciding to keep it. Their answer is the end of it, so the
 * asks stop showing rather than accumulating.
 */
export async function resolveRecallRequests(messageId: string): Promise<void> {
  const { error } = await supabase
    .from("message_recall_request")
    .update({ resolved_at: new Date().toISOString() })
    .eq("message_id", messageId)
    .is("resolved_at", null);

  if (error) throw fail(error.code, error.message);
}

/** Every open ask against one message. */
export function requestsFor(
  requests: readonly RecallRequest[],
  messageId: string,
): RecallRequest[] {
  return requests.filter((entry) => entry.messageId === messageId);
}

/** Whether this person has already asked about this message, so the menu can say so. */
export function hasAsked(
  requests: readonly RecallRequest[],
  messageId: string,
  viewerId: string | undefined,
): boolean {
  if (viewerId === undefined) return false;
  return requests.some((entry) => entry.messageId === messageId && entry.requestedBy === viewerId);
}

/**
 * How the ask is put to the sender.
 *
 * Named people rather than a count, because "ai đó" invites suspicion of everyone in the room.
 * Past two names it becomes a number — a list of five names is not a sentence anyone reads.
 */
export function recallRequestNote(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} đề nghị bạn thu hồi tin nhắn này.`;
  if (names.length === 2) return `${names[0]} và ${names[1]} đề nghị bạn thu hồi tin nhắn này.`;
  return `${names[0]} và ${names.length - 1} người khác đề nghị bạn thu hồi tin nhắn này.`;
}
