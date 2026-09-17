import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage, ConversationKind, ConversationSummary } from "@/lib/chat-cache";
import { peerLabel } from "@/lib/initials";

export {
  applyMessageEditToInbox,
  applyMessageToInbox,
  applyMessageUpdate,
  applyPeerRead,
  canEditMessage,
  canRecallMessage,
  canReplyToMessage,
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
  isEdited,
  isNearThreadBottom,
  isRecalled,
  isSearchable,
  isSeenByPeer,
  isWithinEditWindow,
  matchExcerpt,
  MESSAGE_SEARCH_MIN_LENGTH,
  JOURNAL_SUBTITLE,
  JOURNAL_TITLE,
  lastOutgoingId,
  matchesConversationQuery,
  mergeIncomingMessage,
  messageBodyText,
  MESSAGE_EDIT_WINDOW_MS,
  MESSAGE_TABS,
  PLACEHOLDER_TABS,
  isPlaceholderTab,
  isProjectTab,
  quotePreview,
  RECALLED_MESSAGE_NOTE,
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
  if (normalized.includes("avora_message_not_yours")) return "Bạn chỉ sửa hoặc thu hồi tin của mình.";
  if (normalized.includes("avora_message_edit_expired"))
    return "Đã quá 24 giờ nên không sửa được tin này nữa.";
  if (normalized.includes("avora_message_recall_expired"))
    return "Đã quá 24 giờ nên không thu hồi được tin này nữa.";
  if (normalized.includes("avora_message_recalled")) return "Tin nhắn này đã được thu hồi.";
  if (normalized.includes("avora_message_not_found")) return "Không tìm thấy tin nhắn này.";
  if (normalized.includes("avora_message_mention_not_participant"))
    return "Bạn chỉ nhắc tên được thành viên trong nhóm này.";
  if (normalized.includes("avora_message_mentions_immutable"))
    return "Không thể thay đổi người được nhắc sau khi đã gửi.";
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

/** The columns every message read returns, named once so the shapes cannot drift apart. */
const MESSAGE_COLUMNS =
  "id, conversation_id, sender_id, content, created_at, edited_at, deleted_at, reply_to_message_id, mentioned_user_ids";

/** Full thread, oldest first. RLS returns nothing for conversations you are not in. */
export async function fetchMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
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
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    replyToMessageId: row.reply_to_message_id,
    mentionedUserIds: row.mentioned_user_ids ?? [],
  }));
}

/**
 * Finds messages in one conversation by what they say.
 *
 * Scoped to a single thread on purpose: "where did we agree that" is nearly always a question
 * about one conversation, and searching every thread at once would need ranking, grouping and
 * a results screen of its own. ILIKE is enough at this scale — a full-text index would be
 * machinery bought before the problem exists.
 *
 * Withdrawn messages are excluded explicitly rather than relying on their text being empty.
 * The recall destroys the words, so they could not match anyway; saying so here means a future
 * change to how recall stores things cannot quietly make them searchable again.
 */
export async function searchMessages(
  conversationId: string,
  query: string,
  limit: number = 50,
): Promise<ChatMessage[]> {
  const needle = query.trim();
  if (needle === "") return [];

  // `%` and `_` are wildcards in LIKE; someone searching for "50%" means the characters.
  const escaped = needle.replace(/[\\%_]/g, (match) => `\\${match}`);

  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .ilike("content", `%${escaped}%`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw fail(error.code, error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    content: row.content,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    replyToMessageId: row.reply_to_message_id,
    mentionedUserIds: row.mentioned_user_ids ?? [],
  }));
}

/**
 * Corrects the wording of your own message.
 *
 * The server re-checks who is asking and how old the message is, so an expired edit is
 * refused even when this is called directly — the window is a rule, not a hint.
 */
export async function editMessage(messageId: string, content: string): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc("edit_message", {
    p_message_id: messageId,
    p_content: content,
  });
  if (error) throw fail(error.code, error.message);
  const row = data as unknown as {
    id: string;
    conversation_id: string;
    sender_id: string;
    content: string;
    created_at: string;
    edited_at: string | null;
    deleted_at: string | null;
    reply_to_message_id: string | null;
  };
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    content: row.content,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    replyToMessageId: row.reply_to_message_id,
  };
}

/**
 * Takes your own message back. The words are destroyed server-side rather than hidden, so
 * what comes back has empty content and a tombstone — which is what the bubble then says.
 */
export async function recallMessage(messageId: string): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc("recall_message", { p_message_id: messageId });
  if (error) throw fail(error.code, error.message);
  const row = data as unknown as {
    id: string;
    conversation_id: string;
    sender_id: string;
    content: string;
    created_at: string;
    edited_at: string | null;
    deleted_at: string | null;
    reply_to_message_id: string | null;
  };
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    content: row.content,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    replyToMessageId: row.reply_to_message_id,
  };
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

export async function sendMessage(
  conversationId: string,
  senderId: string,
  content: string,
  replyToMessageId: string | null = null,
  mentionedUserIds: readonly string[] = [],
): Promise<ChatMessage> {
  const trimmed = content.trim();
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      content: trimmed,
      reply_to_message_id: replyToMessageId,
      mentioned_user_ids: [...mentionedUserIds],
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) throw fail(error.code, error.message);

  return {
    id: data.id,
    conversationId: data.conversation_id,
    senderId: data.sender_id,
    content: data.content,
    createdAt: data.created_at,
    editedAt: data.edited_at,
    deletedAt: data.deleted_at,
    replyToMessageId: data.reply_to_message_id,
    mentionedUserIds: data.mentioned_user_ids ?? [],
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
