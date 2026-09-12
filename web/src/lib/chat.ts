import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage, ConversationKind, ConversationSummary } from "@/lib/chat-cache";
import { peerLabel } from "@/lib/initials";

export {
  applyMessageToInbox,
  applyPeerRead,
  canSendDraft,
  chatKeys,
  clearUnread,
  conversationsWithUnread,
  conversationSubtitle,
  conversationTitle,
  filterConversationsByTab,
  formatClock,
  formatDayLabel,
  formatInboxTime,
  formatMissedMessages,
  formatUnreadBadge,
  groupMessagesByDay,
  isNearThreadBottom,
  isSeenByPeer,
  JOURNAL_SUBTITLE,
  JOURNAL_TITLE,
  lastOutgoingId,
  matchesConversationQuery,
  mergeIncomingMessage,
  MESSAGE_TABS,
  tabOfKind,
  THREAD_BOTTOM_TOLERANCE_PX,
  threadScrollDecision,
  toIsoTimestamp,
  totalUnread,
  unreadForTab,
  unreadSummaryText,
} from "@/lib/chat-cache";
export type {
  ChatMessage,
  ConversationKind,
  ConversationSummary,
  MessageDayGroup,
  MessageTab,
  ReadingContext,
  ThreadScrollDecision,
  ThreadScrollMetrics,
} from "@/lib/chat-cache";

export type DirectoryMatch = {
  userId: string;
  displayName: string | null;
  email: string;
};

export type ConversationPeer = {
  peerId: string;
  peerName: string;
  peerEmail: string | null;
};

/** Maps Postgres/PostgREST failures on the chat tables to short Vietnamese messages. */
export function toVietnameseChatError(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();
  if (code === "42501" || normalized.includes("permission denied"))
    return "Máy chủ chưa cho phép thao tác này. Vui lòng báo lại cho chúng tôi.";
  if (normalized.includes("row-level security")) return "Bạn không có quyền trong cuộc trò chuyện này.";
  if (normalized.includes("avora_user_not_found")) return "Không tìm thấy người dùng này trên AVORA.";
  if (normalized.includes("avora_invalid_partner")) return "Bạn không thể tự trò chuyện với chính mình.";
  if (normalized.includes("avora_not_signed_in")) return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (normalized.includes("avora_not_a_participant")) return "Bạn không có quyền trong cuộc trò chuyện này.";
  if (normalized.includes("messages_content_not_blank")) return "Tin nhắn không được để trống.";
  if (normalized.includes("messages_content_max_len")) return "Tin nhắn quá dài (tối đa 4000 ký tự).";
  if (normalized.includes("failed to fetch")) return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[chat] ${code ?? "unknown"}: ${message}`);
  return new Error(toVietnameseChatError(code, message));
}

/** Inbox list, newest activity first. Peer identity is resolved server-side. */
export async function fetchConversations(): Promise<ConversationSummary[]> {
  const { data, error } = await supabase.rpc("list_my_conversations");
  if (error) throw fail(error.code, error.message);

  return (data ?? []).map((row) => ({
    conversationId: row.conversation_id,
    kind: (row.conversation_type as ConversationKind | null) ?? "direct",
    peerId: row.peer_id,
    peerName: peerLabel(row.peer_display_name, row.peer_email),
    peerEmail: row.peer_email,
    groupName: (row.group_name as string | null) ?? null,
    memberCount: (row.member_count as number | null) ?? 1,
    lastMessageContent: row.last_message_content,
    lastMessageAt: row.last_message_at,
    lastMessageSenderId: row.last_message_sender_id,
    // The generator types RPC table columns as non-null; these two really can be null.
    unreadCount: (row.unread_count as number | null) ?? 0,
    peerLastReadAt: (row.peer_last_read_at as string | null) ?? null,
    sortAt: row.sort_at,
  }));
}

/**
 * Moves the caller's read watermark to the newest message in the thread.
 * The server decides the watermark, so this can never mark unseen messages read.
 */
export async function markConversationRead(conversationId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });
  if (error) throw fail(error.code, error.message);
  return data ?? null;
}

/** Full thread, oldest first. RLS returns nothing for conversations you are not in. */
export async function fetchMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw fail(error.code, error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    content: row.content,
    createdAt: row.created_at,
  }));
}

/** Peer of a thread opened straight from its URL. Returns null when you are not a member. */
export async function fetchConversationPeer(conversationId: string): Promise<ConversationPeer | null> {
  const { data, error } = await supabase.rpc("get_conversation_peer", { p_conversation_id: conversationId });
  if (error) throw fail(error.code, error.message);

  const row = (data ?? [])[0];
  if (!row) return null;
  return {
    peerId: row.peer_id,
    peerName: peerLabel(row.peer_display_name, row.peer_email),
    peerEmail: row.peer_email,
  };
}

export async function sendMessage(conversationId: string, senderId: string, content: string): Promise<ChatMessage> {
  const trimmed = content.trim();
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: senderId, content: trimmed })
    .select("id, conversation_id, sender_id, content, created_at")
    .single();

  if (error) throw fail(error.code, error.message);

  return {
    id: data.id,
    conversationId: data.conversation_id,
    senderId: data.sender_id,
    content: data.content,
    createdAt: data.created_at,
  };
}

/** Exact-email lookup. AVORA has no browsable member list by design. */
export async function findUserByEmail(email: string): Promise<DirectoryMatch | null> {
  const { data, error } = await supabase.rpc("find_user_by_email", { p_email: email.trim() });
  if (error) throw fail(error.code, error.message);

  const row = (data ?? [])[0];
  if (!row) return null;
  return { userId: row.user_id, displayName: row.display_name, email: row.email };
}

/** Creates the 1-1 conversation, or returns the existing one for this pair. */
export async function createDirectConversation(otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_direct_conversation", { other_user_id: otherUserId });
  if (error) throw fail(error.code, error.message);
  if (!data) throw new Error("Không tạo được cuộc trò chuyện. Thử lại nhé.");
  return data;
}

/**
 * The viewer's own journal, created on first use. The server reads the identity from the
 * session, so this can only ever open your own.
 */
export async function ensureJournalConversation(): Promise<string> {
  const { data, error } = await supabase.rpc("get_my_journal_conversation");
  if (error) throw fail(error.code, error.message);
  if (!data) throw new Error("Không mở được nhật ký. Thử lại nhé.");
  return data;
}
