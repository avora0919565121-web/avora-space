import { supabase } from "@/integrations/supabase/client";

/**
 * A reaction is a reply too small to be worth a message.
 *
 * One person may leave several different reactions on the same message — something can be
 * both funny and sad — but never the same one twice. There is no stored count anywhere: the
 * rows are the count, so the number on screen cannot drift from what people actually did.
 */
export type MessageReaction = {
  messageId: string;
  userId: string;
  emoji: string;
};

export const reactionKeys = {
  all: ["message-reactions"] as const,
  thread: (conversationId: string) => ["message-reactions", conversationId] as const,
};

/**
 * The quick bar: eight feelings that cover most of what people actually mean.
 *
 * Deliberately not the usual six positives. Sadness, sympathy and surprise are as much a part
 * of a real conversation as approval — a set that can only agree turns every reaction into
 * applause, and people stop using it for anything honest.
 */
export const QUICK_REACTIONS: readonly { emoji: string; label: string }[] = [
  { emoji: "❤️", label: "Thương" },
  { emoji: "👍", label: "Đồng ý" },
  { emoji: "😂", label: "Cười" },
  { emoji: "😮", label: "Ngạc nhiên" },
  { emoji: "😢", label: "Buồn" },
  { emoji: "🙏", label: "Cảm ơn" },
  { emoji: "🔥", label: "Tuyệt" },
  { emoji: "🤝", label: "Nhất trí" },
] as const;

/** The fuller set behind "+", for whoever wants something the quick bar does not carry. */
export const MORE_REACTIONS: readonly string[] = [
  "😀", "😅", "😊", "😍", "🤔", "😐", "😴", "😭",
  "😡", "🥳", "🤯", "😱", "🙌", "👏", "💪", "✅",
  "❌", "⭐", "💡", "📌", "⏰", "🎉", "☕", "🌱",
] as const;

function fail(code: string | undefined, message: string): Error {
  console.error(`[reactions] ${code ?? "unknown"}: ${message}`);
  const normalized = message.toLowerCase();
  if (code === "42501" || normalized.includes("permission denied"))
    return new Error("Máy chủ chưa cho phép thao tác này.");
  if (normalized.includes("row-level security"))
    return new Error("Bạn không có quyền trong cuộc trò chuyện này.");
  if (normalized.includes("failed to fetch"))
    return new Error("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
  return new Error("Không lưu được cảm xúc. Vui lòng thử lại.");
}

type ReactionRow = { message_id: string; user_id: string; emoji: string };

/**
 * Every reaction on a set of messages.
 *
 * Fetched per thread rather than per bubble: a conversation renders all its messages at once,
 * and a request per message would be a request per message.
 */
export async function fetchReactions(messageIds: readonly string[]): Promise<MessageReaction[]> {
  if (messageIds.length === 0) return [];
  const { data, error } = await supabase
    .from("message_reactions")
    .select("message_id, user_id, emoji")
    .in("message_id", [...messageIds]);
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => {
    const entry = row as ReactionRow;
    return { messageId: entry.message_id, userId: entry.user_id, emoji: entry.emoji };
  });
}

/** Leaves a reaction. Safe to retry: the same person and emoji can only exist once. */
export async function addReaction(
  messageId: string,
  userId: string,
  emoji: string,
): Promise<void> {
  const { error } = await supabase
    .from("message_reactions")
    .upsert({ message_id: messageId, user_id: userId, emoji }, { onConflict: "message_id,user_id,emoji" });
  if (error) throw fail(error.code, error.message);
}

/** Takes back your own reaction. RLS makes it impossible to remove anyone else's. */
export async function removeReaction(
  messageId: string,
  userId: string,
  emoji: string,
): Promise<void> {
  const { error } = await supabase
    .from("message_reactions")
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .eq("emoji", emoji);
  if (error) throw fail(error.code, error.message);
}

/** One emoji on one message: how many left it, whether the viewer is among them, and who. */
export type ReactionGroup = {
  emoji: string;
  count: number;
  mine: boolean;
  userIds: string[];
};

/**
 * Groups a message's reactions for display, most-used first.
 *
 * Ties settle by the order of the quick bar so the same two emoji always appear in the same
 * order — a row of chips that reshuffles between renders is unreadable.
 */
export function groupReactions(
  reactions: readonly MessageReaction[],
  messageId: string,
  viewerId: string | undefined,
): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const reaction of reactions) {
    if (reaction.messageId !== messageId) continue;
    const existing = groups.get(reaction.emoji);
    if (existing === undefined) {
      groups.set(reaction.emoji, {
        emoji: reaction.emoji,
        count: 1,
        mine: reaction.userId === viewerId,
        userIds: [reaction.userId],
      });
      continue;
    }
    existing.count += 1;
    existing.userIds.push(reaction.userId);
    if (reaction.userId === viewerId) existing.mine = true;
  }

  const quickOrder = new Map(QUICK_REACTIONS.map((entry, index) => [entry.emoji, index]));
  const rank = (emoji: string): number => quickOrder.get(emoji) ?? QUICK_REACTIONS.length;

  return [...groups.values()].sort(
    (a, b) => b.count - a.count || rank(a.emoji) - rank(b.emoji) || a.emoji.localeCompare(b.emoji),
  );
}

/** Whether the viewer has already left this exact reaction — what makes the chip a toggle. */
export function hasReacted(
  reactions: readonly MessageReaction[],
  messageId: string,
  viewerId: string | undefined,
  emoji: string,
): boolean {
  if (viewerId === undefined) return false;
  return reactions.some(
    (reaction) =>
      reaction.messageId === messageId && reaction.userId === viewerId && reaction.emoji === emoji,
  );
}

/** Who left one reaction, named — the tooltip on a chip. */
export function describeReactors(
  group: ReactionGroup,
  nameOf: (userId: string) => string,
  viewerId: string | undefined,
): string {
  const names = group.userIds.map((id) => (id === viewerId ? "Bạn" : nameOf(id)));
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} và ${names.length - 3} người khác`;
}
