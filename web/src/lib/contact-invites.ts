import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/lib/log";
import { toVietnameseContactError, type InviteMethod } from "@/lib/contacts";

/**
 * KT-07a · Lời mời Đợt 0 (SP-03).
 *
 * "Avora soạn, bạn gửi": `prepareInvite` chỉ tạo một bản nháp (máy chủ ghi `draft`), Avora mở app
 * Tin nhắn / Mail với lời đã soạn, rồi hỏi "Bạn đã gửi chưa?". Chỉ khi người mời bấm `Đã gửi`
 * (`confirmInviteSent`) thì lời mời mới thành "Đã mời"; `Chưa gửi` bỏ bản nháp (`discardInviteDraft`).
 *
 * Mọi luật chống làm phiền (một lời mời còn sống cho mỗi người nhận, người đã từ chối chỉ mời lại
 * từng người có lời nhắn, hạn mức mỗi ngày) do máy chủ kiểm, theo mã băm số/email của người nhận —
 * nên xoá liên hệ rồi thêm lại không lách được.
 */

export type PreparedInvite = {
  inviteId: string;
  token: string;
  status: "draft" | "pending";
  expiresAt: string;
  /** True when an invitation for this person was already waiting — no new one was made. */
  reused: boolean;
};

export type PrepareOptions = {
  note?: string | null;
  /** The sender is deliberately inviting again someone who declined (needs a note, one person). */
  reinvite?: boolean;
  /** Part of "mời nhiều người": the server refuses people who declined. */
  batch?: boolean;
};

/** The public page of an invitation — what anyone holding the link may know. */
export type PublicInvitePreview = {
  inviterName: string;
  status: "pending" | "accepted" | "declined" | "expired";
  expiresAt: string | null;
  note: string | null;
  isOwnInvite: boolean;
  alreadyLinked: boolean;
  signedIn: boolean;
};

export const INVITE_NOTE_MIN = 10;
export const INVITE_NOTE_MAX = 200;

function failInvite(code: string | undefined, message: string): Error {
  logError("contact-invites", { code, message });
  // rate_take speaks one word for every feature; here it can only be the invitation limit.
  if (message.toLowerCase().includes("avora_rate_limited"))
    return new Error("Hôm nay bạn đã mời nhiều người rồi. Bạn thử lại vào ngày mai nhé.");
  return new Error(toVietnameseContactError(code, message));
}

/** The machine code behind a refusal, so a screen can switch mode (e.g. to "Mời lại"). */
export function inviteRefusal(error: unknown): string | null {
  const raw = (error as { raw?: string } | null)?.raw;
  return typeof raw === "string" ? raw : null;
}

export async function prepareInvite(
  contactId: string,
  method: InviteMethod,
  options: PrepareOptions = {},
): Promise<PreparedInvite> {
  const { data, error } = await supabase.rpc("prepare_contact_invite", {
    p_contact_id: contactId,
    p_method: method,
    p_note: options.note?.trim() || undefined,
    p_reinvite: options.reinvite ?? false,
    p_batch: options.batch ?? false,
  });
  if (error) {
    const failure = failInvite(error.code, error.message) as Error & { raw?: string };
    const match = /avora_[a-z_]+/.exec(error.message);
    failure.raw = match ? match[0] : undefined;
    throw failure;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Chưa soạn được lời mời. Bạn thử lại nhé.");
  return {
    inviteId: row.invite_id,
    token: row.invite_token,
    status: row.status === "pending" ? "pending" : "draft",
    expiresAt: row.expires_at,
    reused: row.reused,
  };
}

export async function confirmInviteSent(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc("confirm_invite_sent", { p_invite_id: inviteId });
  if (error) throw failInvite(error.code, error.message);
}

export async function discardInviteDraft(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc("discard_invite_draft", { p_invite_id: inviteId });
  if (error) throw failInvite(error.code, error.message);
}

/** Null when there is no such invitation (or it is between a blocked pair). Works signed out. */
export async function fetchPublicInvitePreview(token: string): Promise<PublicInvitePreview | null> {
  const { data, error } = await supabase.rpc("preview_invite_public", { p_token: token });
  if (error) throw failInvite(error.code, error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const status = row.status === "accepted" || row.status === "declined" || row.status === "expired" ? row.status : "pending";
  return {
    inviterName: row.inviter_name,
    status,
    expiresAt: row.expires_at ?? null,
    note: row.note ?? null,
    isOwnInvite: row.is_own_invite,
    alreadyLinked: row.already_linked,
    signedIn: row.signed_in,
  };
}

/** "Không, cảm ơn" — no account needed. */
export async function declineInvite(token: string): Promise<void> {
  const { error } = await supabase.rpc("decline_invite", { p_token: token });
  if (error) throw failInvite(error.code, error.message);
}

/** Whether a note fits the server's rule for re-inviting someone who declined. */
export function reinviteNoteProblem(note: string): string | null {
  const text = note.trim();
  if (text.length < INVITE_NOTE_MIN) return `Lời nhắn cần ít nhất ${INVITE_NOTE_MIN} ký tự.`;
  if (text.length > INVITE_NOTE_MAX) return `Lời nhắn tối đa ${INVITE_NOTE_MAX} ký tự.`;
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|vn|io|app|me|link|ly)\b)/i.test(text)) return "Lời nhắn không chứa liên kết.";
  return null;
}

export type PublicInviteState =
  | { kind: "ready"; inviterName: string; note: string | null; expiresAt: string | null; signedIn: boolean }
  | { kind: "missing" }
  | { kind: "accepted" }
  | { kind: "declined"; inviterName: string }
  | { kind: "expired" }
  | { kind: "own" }
  | { kind: "linked" };

/** What the public invitation page should say. Same order as the signed-in page used. */
export function publicInviteState(preview: PublicInvitePreview | null): PublicInviteState {
  if (preview === null) return { kind: "missing" };
  if (preview.status === "accepted") return { kind: "accepted" };
  if (preview.status === "declined") return { kind: "declined", inviterName: preview.inviterName };
  if (preview.status === "expired") return { kind: "expired" };
  if (preview.isOwnInvite) return { kind: "own" };
  if (preview.alreadyLinked) return { kind: "linked" };
  return {
    kind: "ready",
    inviterName: preview.inviterName,
    note: preview.note,
    expiresAt: preview.expiresAt,
    signedIn: preview.signedIn,
  };
}
