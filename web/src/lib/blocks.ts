import { logError } from "@/lib/log";
import { supabase } from "@/integrations/supabase/client";

/**
 * Chặn (AVORA-37 / A).
 *
 * Blocking is the blocker's own business. The blocked person is never told, and the database
 * gives them no row to read: every refusal they meet is worded neutrally, never with "chặn".
 * It covers direct relationships only — 1-1 messages, task suggestions and invitations in a
 * 1-1, and being found by email or a contact link. Groups are left exactly as they are.
 */
export type BlockedPerson = {
  userId: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
};

export const blockKeys = {
  all: ["user-blocks"] as const,
  list: ["user-blocks", "list"] as const,
};

/** The one sentence the blocked side ever sees when a send is refused. No word "chặn". */
export const BLOCKED_SEND_NOTICE = "Không gửi được tin trong cuộc trò chuyện này.";

/** Shown for `avora_contact_unavailable` anywhere outside the composer. */
export const CONTACT_UNAVAILABLE_MESSAGE = "Không thể liên lạc với người này lúc này.";

/** Shown instead of Chặn/Báo cáo when the device is offline (ADR-025). */
export const NEEDS_NETWORK_MESSAGE = "Cần kết nối mạng";

/** True for the server's refusal code, whichever path raised it. */
export function isContactUnavailable(message: string | null | undefined): boolean {
  return (message ?? "").toLowerCase().includes("avora_contact_unavailable");
}

function fail(code: string | undefined, message: string): Error {
  logError("blocks", { code, message });
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_block_self")) return new Error("Bạn không thể tự chặn chính mình.");
  if (normalized.includes("avora_user_not_found")) return new Error("Không tìm thấy người dùng này trên AVORA.");
  if (normalized.includes("avora_not_signed_in")) return new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
  if (normalized.includes("failed to fetch")) return new Error(`${NEEDS_NETWORK_MESSAGE}.`);
  return new Error("Chưa lưu được. Vui lòng thử lại.");
}

export async function fetchMyBlocks(): Promise<BlockedPerson[]> {
  const { data, error } = await supabase.rpc("list_my_blocks");
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    createdAt: row.created_at,
  }));
}

/** Idempotent on the server: blocking twice keeps the first date. */
export async function blockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc("block_user", { p_user_id: userId });
  if (error) throw fail(error.code, error.message);
}

export async function unblockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc("unblock_user", { p_user_id: userId });
  if (error) throw fail(error.code, error.message);
}

/** How a blocked person is named in the list: their name, then their email, then a fallback. */
export function blockedPersonLabel(person: Pick<BlockedPerson, "displayName" | "email">): string {
  const name = person.displayName?.trim() ?? "";
  if (name !== "") return name;
  const email = person.email?.trim() ?? "";
  return email !== "" ? email : "Người dùng AVORA";
}
