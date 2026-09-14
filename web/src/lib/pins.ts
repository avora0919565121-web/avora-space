import { supabase } from "@/integrations/supabase/client";
import type { GroupRole } from "@/lib/groups";

/**
 * Keeping a message where people can find it again.
 *
 * Two kinds, because two different needs were being confused. A group pin is the room saying
 * "this is the address / the deadline / the decision" — shared, and therefore limited and
 * officer-only. A personal pin is one person's bookmark in a long conversation, which is
 * nobody else's business and must not consume the room's shared space.
 */
export type PinScope = "group" | "personal";

export type MessagePin = {
  id: string;
  messageId: string;
  conversationId: string;
  pinnedBy: string;
  scope: PinScope;
  pinnedAt: string;
};

export const pinKeys = {
  all: ["message-pins"] as const,
  thread: (conversationId: string) => ["message-pins", conversationId] as const,
};

/**
 * How many pins each audience gets.
 *
 * The limit is the feature. A pinned message only means "look here" while there are few of
 * them; a room with twenty pins has a second inbox rather than a noticeboard. Mirrors
 * `message_pin_limit()` in the database, which is what actually enforces it.
 */
export const PIN_LIMIT = 3;

function fail(code: string | undefined, message: string): Error {
  console.error(`[pins] ${code ?? "unknown"}: ${message}`);
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_pin_group_quota_full"))
    return new Error(`Nhóm đã ghim đủ ${PIN_LIMIT} tin. Bỏ ghim một tin trước khi ghim tin mới.`);
  if (normalized.includes("avora_pin_personal_quota_full"))
    return new Error(`Bạn đã ghim riêng đủ ${PIN_LIMIT} tin. Bỏ ghim một tin để ghim tin khác.`);
  if (normalized.includes("avora_pin_officers_only"))
    return new Error("Chỉ chủ nhóm hoặc quản trị viên mới ghim cho cả nhóm được.");
  if (normalized.includes("avora_message_recalled"))
    return new Error("Tin nhắn đã thu hồi thì không còn nội dung để ghim.");
  if (normalized.includes("avora_message_not_found")) return new Error("Không tìm thấy tin nhắn này.");
  if (normalized.includes("avora_not_a_participant"))
    return new Error("Bạn không có quyền trong cuộc trò chuyện này.");
  if (normalized.includes("avora_pin_bad_scope")) return new Error("Loại ghim không hợp lệ.");
  if (code === "42501" || normalized.includes("permission denied"))
    return new Error("Máy chủ chưa cho phép thao tác này.");
  if (normalized.includes("failed to fetch"))
    return new Error("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
  return new Error("Không ghim được tin nhắn. Vui lòng thử lại.");
}

type PinRow = {
  id: string;
  message_id: string;
  conversation_id: string;
  pinned_by: string;
  scope: string;
  pinned_at: string;
};

/**
 * The pins this person can see in one conversation.
 *
 * What comes back is decided by RLS: every group pin in the room, plus only the reader's own
 * personal pins. So the list is already correct for whoever is asking — there is no filter
 * here to forget.
 */
export async function fetchPins(conversationId: string): Promise<MessagePin[]> {
  const { data, error } = await supabase
    .from("message_pins")
    .select("id, message_id, conversation_id, pinned_by, scope, pinned_at")
    .eq("conversation_id", conversationId)
    .order("pinned_at", { ascending: false });
  if (error) throw fail(error.code, error.message);

  return (data ?? []).map((row) => {
    const entry = row as PinRow;
    return {
      id: entry.id,
      messageId: entry.message_id,
      conversationId: entry.conversation_id,
      pinnedBy: entry.pinned_by,
      scope: entry.scope === "group" ? "group" : "personal",
      pinnedAt: entry.pinned_at,
    };
  });
}

/** Pins a message for the room or for yourself. Safe to retry: a repeat is a no-op. */
export async function pinMessage(messageId: string, scope: PinScope): Promise<void> {
  const { error } = await supabase.rpc("pin_message", {
    p_message_id: messageId,
    p_scope: scope,
  });
  if (error) throw fail(error.code, error.message);
}

/**
 * Removes a pin.
 *
 * RLS decides whether it is allowed: your own personal pin always, and a group pin only if
 * you hold a seat that answers for the room. An officer can clear a shared pin someone else
 * added, because a shared pin belongs to the room rather than to whoever put it up.
 */
export async function unpinMessage(pinId: string): Promise<void> {
  const { error } = await supabase.from("message_pins").delete().eq("id", pinId);
  if (error) throw fail(error.code, error.message);
}

/** Only the seats that answer for the room may pin on its behalf. */
export function canPinForGroup(role: GroupRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Which pin options to offer on a message.
 *
 * An officer gets both, and the choice is put in front of them rather than assumed: an owner
 * bookmarking something for themselves is a normal thing to want, and silently making it a
 * group pin would publish a private note to the whole room.
 */
export function pinChoicesFor(role: GroupRole | undefined, isGroupChat: boolean): PinScope[] {
  if (!isGroupChat) return ["personal"];
  return canPinForGroup(role) ? ["group", "personal"] : ["personal"];
}

/** How many of one audience's slots are already used. */
export function usedPins(
  pins: readonly MessagePin[],
  scope: PinScope,
  viewerId: string | undefined,
): number {
  return pins.filter((pin) => {
    if (pin.scope !== scope) return false;
    // A personal count is only ever about the reader; the shared one is about everybody.
    return scope === "group" || pin.pinnedBy === viewerId;
  }).length;
}

export function isQuotaFull(
  pins: readonly MessagePin[],
  scope: PinScope,
  viewerId: string | undefined,
): boolean {
  return usedPins(pins, scope, viewerId) >= PIN_LIMIT;
}

/** The pin covering a message for one audience, or null when it is not pinned. */
export function pinFor(
  pins: readonly MessagePin[],
  messageId: string,
  scope: PinScope,
  viewerId: string | undefined,
): MessagePin | null {
  return (
    pins.find(
      (pin) =>
        pin.messageId === messageId &&
        pin.scope === scope &&
        (scope === "group" || pin.pinnedBy === viewerId),
    ) ?? null
  );
}

/**
 * The pins to show above a thread, shared ones first.
 *
 * Both kinds share one strip rather than two: someone looking for "that thing we pinned" does
 * not remember which shelf they put it on, and two lists would make them check both.
 */
export function orderedPins(pins: readonly MessagePin[]): MessagePin[] {
  return [...pins].sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "group" ? -1 : 1;
    return b.pinnedAt.localeCompare(a.pinnedAt);
  });
}

/** What a pin is labelled in the strip, so its audience is never ambiguous. */
export function pinScopeLabel(scope: PinScope): string {
  return scope === "group" ? "Ghim của nhóm" : "Ghim riêng của bạn";
}
