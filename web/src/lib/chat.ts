import { logError } from "@/lib/log";
import { BLOCKED_SEND_NOTICE, isContactUnavailable } from "@/lib/blocks";
import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage, ConversationKind, ConversationSummary } from "@/lib/chat-cache";
import { peerLabel } from "@/lib/initials";
import { parseForwardBundle } from "@/lib/chat-transcript";
import { NOT_CONNECTED_NOTICE } from "@/lib/connections";

/** Shown when one side has used its 5 messages in a verification frame. */
export const VERIFICATION_QUOTA_NOTICE = "Bạn đã dùng hết 5 tin. Chờ người kia trả lời nhé.";

export {
  applyMessageEditToInbox,
  applyMessageToInbox,
  applyMessageUpdate,
  canEditMessage,
  canRecallMessage,
  canReplyToMessage,
  canSendDraft,
  chatKeys,
  clearUnread,
  conversationsWithUnread,
  conversationSubtitle,
  conversationTitle,
  FAILED_SEND_ID_PREFIX,
  failedSendIdOf,
  failedSendToMessage,
  filterConversationsByTab,
  formatClock,
  formatDayLabel,
  formatInboxTime,
  formatMissedMessages,
  formatUnreadBadge,
  groupMessagesByDay,
  firstUnreadByCount,
  firstUnreadMessageId,
  isEdited,
  isNearThreadBottom,
  isRecalled,
  isSearchable,
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
  ORIGIN_GROUP_PARAM,
  PLACEHOLDER_TABS,
  isPlaceholderTab,
  isProjectTab,
  quotePreview,
  RECALLED_MESSAGE_NOTE,
  sendReceiptLabel,
  tabForOpenedThread,
  tabOfKind,
  THREAD_BOTTOM_TOLERANCE_PX,
  threadScrollDecision,
  toIsoTimestamp,
  totalUnread,
  unreadForTab,
  unreadSummaryText,
  withFailedSends,
} from "@/lib/chat-cache";
export type {
  ChatMessage,
  FailedSend,
  ConversationKind,
  ConversationSummary,
  ConversationVerification,
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
  if (isContactUnavailable(normalized)) return BLOCKED_SEND_NOTICE;
  if (normalized.includes("avora_not_connected")) return NOT_CONNECTED_NOTICE;
  if (normalized.includes("avora_verification_text_only")) return "Chỉ gửi được chữ khi chưa kết bạn.";
  if (normalized.includes("avora_verification_quota")) return VERIFICATION_QUOTA_NOTICE;
  if (normalized.includes("avora_group_min_three"))
    return "Nhóm cần ít nhất 3 người, tính cả bạn. Nói chuyện với 1 người thì dùng chat 1-1.";
  if (normalized.includes("avora_group_full")) return "Nhóm đã đủ 300 người.";
  if (normalized.includes("avora_urgent_daily_limit")) return "Hôm nay bạn đã gửi khẩn trong cuộc này.";
  if (normalized.includes("avora_urgent_locked")) return "Gửi khẩn đang tạm khoá vì đã dùng 3 lần trong 7 ngày.";
  if (normalized.includes("avora_urgent_not_here")) return "Nhật ký không có gửi khẩn.";
  if (normalized.includes("avora_group_add_forbidden")) return "Chỉ chủ nhóm và quản trị viên thêm được thành viên.";
  if (normalized.includes("avora_group_add_not_friend")) return "Chỉ thêm được bạn bè của bạn.";
  if (normalized.includes("avora_mute_too_long")) return "Tắt thông báo một cuộc lâu nhất tới hết hôm nay.";
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
  logError("chat", { code, message });
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
    peerName: peerLabel(row.peer_display_name),
    peerEmail: row.peer_email,
    groupName: (row.group_name as string | null) ?? null,
    memberCount: (row.member_count as number | null) ?? 1,
    lastMessageContent: row.last_message_content,
    lastMessageAt: row.last_message_at,
    lastMessageSenderId: row.last_message_sender_id,
    // The generator types RPC table columns as non-null; these two really can be null.
    unreadCount: (row.unread_count as number | null) ?? 0,
    sortAt: row.sort_at,
    isConnected: (row.is_connected as boolean | null) ?? null,
    peerPin: (row.peer_pin as string | null) ?? null,
    verification:
      (row.verification_status as string | null) === "pending"
        ? {
            expiresAt: row.verification_expires_at as string,
            viaGroupId: (row.verification_via_group_id as string | null) ?? null,
            viaGroupName: (row.verification_group_name as string | null) ?? null,
            openedBy: (row.verification_opened_by as string | null) ?? null,
            messagesLeft: (row.verification_messages_left as number | null) ?? 0,
            confirmedByMe: (row.verification_confirmed_by_me as boolean | null) ?? false,
          }
        : null,
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

/**
 * Xem sau (AVORA-47 · A): moves only the caller's own read mark back to just before this
 * message, so it and everything after it count as unread again. The sender learns nothing.
 * Returns the new mark.
 */
export async function markUnreadFrom(messageId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("mark_unread_from", { p_message_id: messageId });
  if (error) throw fail(error.code, error.message);
  return data ?? null;
}

/** The newest message of a thread, for `Xem sau` on a whole conversation (= on its newest line). */
export async function fetchNewestMessageId(conversationId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .is("system_kind", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw fail(error.code, error.message);
  return data?.id ?? null;
}

export type DiaryLine = { id: string; senderId: string; content: string; createdAt: string };

/**
 * Nhật ký trò chuyện (AVORA-52 · B): the lines of one 1-1 / group the viewer may still read,
 * newest first. Recalled (`deleted_at`) and system lines are left out; RLS decides who reads.
 */
export async function fetchConversationDiary(conversationId: string): Promise<DiaryLine[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, sender_id, content, created_at")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .is("system_kind", null)
    .is("trashed_at", null)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => ({ id: row.id, senderId: row.sender_id, content: row.content, createdAt: row.created_at }));
}

/** Puts the caller's read mark back where it was (the Hoàn tác of Xem sau). */
export async function restoreReadMark(conversationId: string): Promise<void> {
  await markConversationRead(conversationId);
}

/**
 * Đã nhận (AVORA-47 · E, ADR-028): the recipient's device says these 1-1 messages arrived.
 * The server ignores group lines, one's own lines and anything across a block.
 */
export async function markMessagesDelivered(messageIds: readonly string[]): Promise<void> {
  if (messageIds.length === 0) return;
  const { error } = await supabase.rpc("mark_messages_delivered", { p_message_ids: [...messageIds].slice(0, 200) });
  // Never loud: a receipt that fails to write only leaves the sender on "Đã gửi".
  if (error) logError("chat-delivery", { code: error.code, message: error.message });
}

/** When each of my messages arrived on the other device. RLS returns only rows for my own lines. */
export async function fetchDeliveries(messageIds: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (messageIds.length === 0) return map;
  const { data, error } = await supabase
    .from("message_deliveries")
    .select("message_id, delivered_at")
    .in("message_id", [...messageIds]);
  if (error) throw fail(error.code, error.message);
  for (const row of data ?? []) map.set(row.message_id, row.delivered_at);
  return map;
}

export type UrgentStatus = { usedToday: boolean; lockedUntil: string | null };

/** Whether `Gửi khẩn` is open in this conversation right now (the server decides at send too). */
export async function fetchUrgentStatus(conversationId: string): Promise<UrgentStatus> {
  const { data, error } = await supabase.rpc("urgent_status", { p_conversation_id: conversationId });
  if (error) throw fail(error.code, error.message);
  const value = (data ?? {}) as { used_today?: boolean; locked_until?: string | null };
  return { usedToday: value.used_today === true, lockedUntil: value.locked_until ?? null };
}

/** The conversations I archived (AVORA-47 · F). Only my own rows exist for me. */
export async function fetchArchives(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("conversation_archives").select("conversation_id, archived_at");
  if (error) throw fail(error.code, error.message);
  return new Map((data ?? []).map((row) => [row.conversation_id, row.archived_at] as const));
}

export async function archiveConversation(userId: string, conversationId: string): Promise<void> {
  const { error } = await supabase
    .from("conversation_archives")
    .upsert({ user_id: userId, conversation_id: conversationId, archived_at: new Date().toISOString() }, { onConflict: "user_id,conversation_id" });
  if (error) throw fail(error.code, error.message);
}

export async function unarchiveConversation(conversationId: string): Promise<void> {
  const { error } = await supabase.from("conversation_archives").delete().eq("conversation_id", conversationId);
  if (error) throw fail(error.code, error.message);
}

/** Owner / admin adds friends to a group (AVORA-47 · I). Returns how many joined. */
export async function addGroupMembers(conversationId: string, userIds: readonly string[]): Promise<number> {
  const { data, error } = await supabase.rpc("add_group_members", {
    p_conversation_id: conversationId,
    p_user_ids: [...userIds],
  });
  if (error) throw fail(error.code, error.message);
  return data ?? 0;
}

/** The columns every message read returns, named once so the shapes cannot drift apart. */
const MESSAGE_COLUMNS =
  "id, conversation_id, sender_id, content, created_at, edited_at, deleted_at, reply_to_message_id, mentioned_user_ids, origin_group_id, attachment_count, origin_content_id, origin_sender_id, system_kind, forward_bundle, is_urgent";

/** How many messages one page holds (Đợt gộp 2 · A7). */
export const MESSAGE_PAGE_SIZE = 50;

type MessageRowShape = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_to_message_id: string | null;
  mentioned_user_ids: string[] | null;
  origin_group_id: string | null;
  attachment_count: number | null;
  origin_content_id: string | null;
  origin_sender_id: string | null;
  system_kind: string | null;
  forward_bundle?: unknown;
  is_urgent?: boolean | null;
};

function toChatMessageRow(row: MessageRowShape): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    content: row.content,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    replyToMessageId: row.reply_to_message_id,
    mentionedUserIds: row.mentioned_user_ids ?? [],
    originGroupId: row.origin_group_id,
    attachmentCount: row.attachment_count ?? 0,
    originContentId: row.origin_content_id,
    originSenderId: row.origin_sender_id,
    systemKind: row.system_kind ?? null,
    forwardBundle: parseForwardBundle(row.forward_bundle),
    isUrgent: row.is_urgent === true,
  };
}

/**
 * The newest part of a thread, oldest first. RLS returns nothing for conversations you are not in.
 *
 * Read newest-first at the database: the API caps a read at 1,000 rows, so reading oldest-first
 * used to lose the newest messages of a long thread. `since` keeps a window the reader already
 * scrolled back through: a refresh re-reads from that oldest message on instead of one page.
 */
export async function fetchMessages(conversationId: string, since: string | null = null): Promise<ChatMessage[]> {
  const base = supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .is("trashed_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  const { data, error } = await (since === null
    ? base.limit(MESSAGE_PAGE_SIZE)
    : base.gte("created_at", since).limit(1000));
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map(toChatMessageRow).reverse();
}

/** A journal entry in Thùng rác: what it said, and when it went in (AVORA-44 · việc 8). */
export type TrashedJournalEntry = ChatMessage & { trashedAt: string };

/** Nhật ký's Thùng rác, newest first. Only the owner's journal is readable (RLS). */
export async function fetchTrashedJournal(conversationId: string): Promise<TrashedJournalEntry[]> {
  const { data, error } = await supabase
    .from("messages")
    .select(`${MESSAGE_COLUMNS}, trashed_at`)
    .eq("conversation_id", conversationId)
    .not("trashed_at", "is", null)
    .order("trashed_at", { ascending: false })
    .limit(200);
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => ({
    ...toChatMessageRow(row as MessageRowShape),
    trashedAt: (row as { trashed_at: string }).trashed_at,
  }));
}

/** The page just before `before` (older), oldest first. Fewer than a page means the start was reached. */
export async function fetchOlderMessages(conversationId: string, before: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .lt("created_at", before)
    .is("trashed_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map(toChatMessageRow).reverse();
}

/** Where one message sits in time, so the window can be widened back to it. Null if unreadable. */
export async function fetchMessageTime(messageId: string): Promise<string | null> {
  const { data, error } = await supabase.from("messages").select("created_at").eq("id", messageId).maybeSingle();
  if (error) throw fail(error.code, error.message);
  return data?.created_at ?? null;
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
    .is("trashed_at", null)
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
    originGroupId: row.origin_group_id,
    attachmentCount: row.attachment_count ?? 0,
    originContentId: row.origin_content_id,
    originSenderId: row.origin_sender_id,
    systemKind: row.system_kind ?? null,
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
    peerName: peerLabel(row.peer_display_name),
    peerEmail: row.peer_email,
  };
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  content: string,
  replyToMessageId: string | null = null,
  mentionedUserIds: readonly string[] = [],
  /**
   * Set only when the thread was opened from inside a group's member list. The server checks
   * the claim against real membership, so this is a hint it verifies, never a fact it trusts.
   */
  originGroupId: string | null = null,
  /**
   * The Daily Thought this line answers (`category:YYYY-MM-DD`). Journal only — the database
   * refuses it on any other kind of conversation.
   */
  replyToDailyThoughtId: string | null = null,
  /** Cờ Khẩn (AVORA-47 · D). The server enforces 1 / conversation / day and the 7-day lock. */
  isUrgent: boolean = false,
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
      origin_group_id: originGroupId,
      reply_to_daily_thought_id: replyToDailyThoughtId,
      ...(isUrgent ? { is_urgent: true } : {}),
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) throw fail(error.code, error.message);

  return toChatMessageRow(data);
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
