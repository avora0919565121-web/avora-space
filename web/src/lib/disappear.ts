import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/lib/log";
import type { ChatMessage } from "@/lib/chat-cache";
import { isRecalled } from "@/lib/chat-cache";

/**
 * AVORA-109 · B — Tin tự biến mất, có dấu vết. The server sets `expires_at` when a message is created
 * and empties it when the time comes (the row stays as a tombstone). This module is the client's side:
 * the per-conversation timer, the 1-1 proposal, and "hide tombstones on my screen".
 */

export type DisappearSeconds = 3600 | 86400 | 604800 | 2592000;

export const DISAPPEAR_OPTIONS: readonly { value: DisappearSeconds | null; label: string }[] = [
  { value: null, label: "Tắt" },
  { value: 3600, label: "1 giờ" },
  { value: 86400, label: "24 giờ" },
  { value: 604800, label: "7 ngày" },
  { value: 2592000, label: "30 ngày" },
];

export const DISAPPEAR_NOTE = "Người nhận vẫn có thể chụp màn hình hoặc sao chép trước khi tin biến mất.";
export const TASK_STAYS_NOTE = "Nhiệm vụ này sẽ ở lại dù tin biến mất.";
export const EXPIRED_NOTE = "Tin đã tự biến mất";
export const DISAPPEAR_KINDS: readonly string[] = ["disappear_changed", "disappear_proposed"];

export function disappearLabel(seconds: number | null | undefined): string {
  return DISAPPEAR_OPTIONS.find((option) => option.value === (seconds ?? null))?.label ?? "Tắt";
}

/** Gone already — by the server's sweep, or because its time passed and the sweep has not run yet. */
export function isExpired(message: Pick<ChatMessage, "expiresAt" | "expiredAt">, now: number = Date.now()): boolean {
  if (message.expiredAt != null) return true;
  return message.expiresAt != null && new Date(message.expiresAt).getTime() <= now;
}

/** A recalled or expired message: the one tombstone mechanism (B3). */
export function isTombstone(message: Pick<ChatMessage, "deletedAt" | "expiresAt" | "expiredAt">, now: number = Date.now()): boolean {
  return isRecalled(message) || isExpired(message, now);
}

/** The bubble text of an expired message: `Tin đã tự biến mất · 14:32`. */
export function expiredLine(message: Pick<ChatMessage, "expiresAt" | "expiredAt">): string {
  const at = message.expiresAt ?? message.expiredAt;
  if (at == null) return EXPIRED_NOTE;
  const clock = new Date(at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  return `${EXPIRED_NOTE} · ${clock}`;
}

/** What the thread should still draw once tombstones are hidden on my screen (B4). */
export function visibleMessages<T extends Pick<ChatMessage, "deletedAt" | "expiresAt" | "expiredAt" | "systemKind">>(
  messages: readonly T[],
  hideTombstones: boolean,
  now: number = Date.now(),
): T[] {
  if (!hideTombstones) return [...messages];
  return messages.filter((message) => message.systemKind != null || !isTombstone(message, now));
}

/** Milliseconds until the next message in view expires, or null — so the screen updates on time. */
export function nextExpiryIn(messages: readonly Pick<ChatMessage, "expiresAt" | "expiredAt">[], now: number = Date.now()): number | null {
  let soonest: number | null = null;
  for (const message of messages) {
    if (message.expiredAt != null || message.expiresAt == null) continue;
    const at = new Date(message.expiresAt).getTime();
    if (at <= now) continue;
    if (soonest === null || at < soonest) soonest = at;
  }
  return soonest === null ? null : soonest - now;
}

export type DisappearProposal = { id: string; proposedBy: string; seconds: DisappearSeconds; messageId: string | null; createdAt: string };
export type DisappearState = { seconds: DisappearSeconds | null; proposal: DisappearProposal | null; hideTombstones: boolean };

export const disappearKeys = {
  state: (conversationId: string) => ["disappear", conversationId] as const,
};

function isSeconds(value: unknown): value is DisappearSeconds {
  return value === 3600 || value === 86400 || value === 604800 || value === 2592000;
}

/** The timer, the open 1-1 proposal (if any) and my own "hide tombstones" — read together. */
export async function fetchDisappearState(conversationId: string, userId: string): Promise<DisappearState> {
  const [conv, proposal, prefs] = await Promise.all([
    supabase.from("conversations").select("disappear_after_seconds" as never).eq("id", conversationId).maybeSingle(),
    supabase
      .from("disappear_proposals" as never)
      .select("id, proposed_by, seconds, message_id, created_at")
      .eq("conversation_id" as never, conversationId as never)
      .eq("status" as never, "open" as never)
      .order("created_at" as never, { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("conversation_member_prefs" as never)
      .select("hide_tombstones")
      .eq("conversation_id" as never, conversationId as never)
      .eq("user_id" as never, userId as never)
      .maybeSingle(),
  ]);
  if (conv.error) logError("disappear", conv.error);
  const seconds = (conv.data as { disappear_after_seconds?: unknown } | null)?.disappear_after_seconds;
  const row = proposal.data as { id: string; proposed_by: string; seconds: number; message_id: string | null; created_at: string } | null;
  const fresh = row !== null && Date.now() - new Date(row.created_at).getTime() < 3 * 86_400_000;
  return {
    seconds: isSeconds(seconds) ? seconds : null,
    proposal:
      row !== null && fresh && isSeconds(row.seconds)
        ? { id: row.id, proposedBy: row.proposed_by, seconds: row.seconds, messageId: row.message_id, createdAt: row.created_at }
        : null,
    hideTombstones: (prefs.data as { hide_tombstones?: boolean } | null)?.hide_tombstones === true,
  };
}

function fail(message: string): Error {
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_not_admin")) return new Error("Chỉ chủ nhóm hoặc quản trị viên đổi được.");
  if (normalized.includes("avora_proposal_closed")) return new Error("Đề nghị này đã đóng.");
  if (normalized.includes("avora_proposal_own")) return new Error("Người kia sẽ trả lời đề nghị này.");
  if (normalized.includes("failed to fetch")) return new Error("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
  return new Error("Chưa đổi được. Thử lại nhé.");
}

/** `applied` (Nhóm, or turning off) · `proposed` (1-1 on / change) · `unchanged`. */
export async function setDisappearTimer(conversationId: string, seconds: DisappearSeconds | null): Promise<"applied" | "proposed" | "unchanged"> {
  const { data, error } = await supabase.rpc("set_disappear_timer" as never, { p_conversation_id: conversationId, p_seconds: seconds } as never);
  if (error) {
    logError("disappear", { code: error.code, message: error.message });
    throw fail(error.message);
  }
  return data === "proposed" || data === "unchanged" ? data : "applied";
}

export async function answerDisappearProposal(proposalId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc("answer_disappear_proposal" as never, { p_proposal_id: proposalId, p_accept: accept } as never);
  if (error) {
    logError("disappear", { code: error.code, message: error.message });
    throw fail(error.message);
  }
}

export async function setHideTombstones(conversationId: string, hide: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_hide_tombstones" as never, { p_conversation_id: conversationId, p_value: hide } as never);
  if (error) {
    logError("disappear", { code: error.code, message: error.message });
    throw fail(error.message);
  }
}
