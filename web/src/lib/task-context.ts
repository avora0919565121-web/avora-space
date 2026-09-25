import type { ConversationKind } from "@/lib/chat-cache";

/**
 * What was on screen when someone turned a conversation into a task.
 *
 * A task born in a chat only makes sense next to the message that prompted it, and messages
 * can be deleted. So the wording is copied onto the task at the moment it is created and never
 * touched again — the database refuses any later edit. Every field is always present: a missing
 * key and a genuinely empty value must not look the same, or the archive cannot be trusted.
 */
export type TaskContextSnapshot = {
  conversationType: ConversationKind;
  conversationId: string;
  conversationName: string;
  /** Null when the task was raised in a thread that had no messages yet. */
  originalMessageId: string | null;
  originalMessageText: string;
  originalMessageSenderId: string | null;
  originalMessageSenderName: string;
  originalMessageCreatedAt: string | null;
  /** What the creator asked for in reply — the task's own description. */
  userResponse: string;
  snapshotCreatedAt: string;
  /**
   * Where the content came from when it did not come from a conversation at all. Absent on
   * every task raised from a chat; present only on tasks made from something pasted in.
   */
  origin?: TaskOrigin;
};

/**
 * Content brought in from outside AVORA by pasting it into Diary. The pasted words and the
 * names of the pasted files are kept as they were, so the task still says what it was made
 * from after the note or the clipboard is long gone.
 */
export type TaskOrigin = {
  type: "external_paste";
  /** The pasted text, as pasted (capped). Empty when only files were pasted. */
  content: string;
  /** The pasted files, by name, in the order they were pasted. */
  fileNames: string[];
};

/** The exact JSON the database trigger validates, key for key. */
export type TaskContextSnapshotJson = {
  conversation_type: string;
  conversation_id: string;
  conversation_name: string;
  original_message_id: string | null;
  original_message_text: string;
  original_message_sender_id: string | null;
  original_message_sender_name: string;
  original_message_created_at: string | null;
  user_response: string;
  snapshot_created_at: string;
  /** Only on tasks made from pasted content. The trigger requires the ten keys above, nothing more. */
  origin_type?: "external_paste";
  origin_content?: string;
  origin_file_names?: string[];
};

export type ContextMessage = {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
};

/**
 * Takes the copy of the conversation that will travel with the task.
 *
 * The message quoted is the newest one in the thread at the moment the button was pressed —
 * that is what "the thing we were just talking about" means to the person creating the task.
 */
export function buildContextSnapshot(input: {
  conversationType: ConversationKind;
  conversationId: string;
  conversationName: string;
  message: ContextMessage | null;
  senderName: string;
  userResponse: string;
  now?: Date;
}): TaskContextSnapshot {
  const now = input.now ?? new Date();
  return {
    conversationType: input.conversationType,
    conversationId: input.conversationId,
    conversationName: input.conversationName,
    originalMessageId: input.message?.id ?? null,
    originalMessageText: input.message?.content ?? "",
    originalMessageSenderId: input.message?.senderId ?? null,
    originalMessageSenderName: input.message === null ? "" : input.senderName,
    originalMessageCreatedAt: input.message?.createdAt ?? null,
    userResponse: input.userResponse,
    snapshotCreatedAt: now.toISOString(),
  };
}

export function snapshotToJson(snapshot: TaskContextSnapshot): TaskContextSnapshotJson {
  const origin: Partial<TaskContextSnapshotJson> =
    snapshot.origin === undefined
      ? {}
      : {
          origin_type: snapshot.origin.type,
          origin_content: snapshot.origin.content,
          origin_file_names: [...snapshot.origin.fileNames],
        };
  return {
    ...origin,
    conversation_type: snapshot.conversationType,
    conversation_id: snapshot.conversationId,
    conversation_name: snapshot.conversationName,
    original_message_id: snapshot.originalMessageId,
    original_message_text: snapshot.originalMessageText,
    original_message_sender_id: snapshot.originalMessageSenderId,
    original_message_sender_name: snapshot.originalMessageSenderName,
    original_message_created_at: snapshot.originalMessageCreatedAt,
    user_response: snapshot.userResponse,
    snapshot_created_at: snapshot.snapshotCreatedAt,
  };
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readNullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Reads a snapshot back off a task row. Anything that is not a complete, well-formed snapshot
 * reads as "no context" rather than as a half-filled one — a partial quote is worse than none.
 */
export function parseContextSnapshot(raw: unknown): TaskContextSnapshot | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const conversationType = readString(record, "conversation_type");
  if (conversationType !== "direct" && conversationType !== "group" && conversationType !== "personal") {
    return null;
  }
  const conversationId = readNullableString(record, "conversation_id");
  if (conversationId === null) return null;

  const rawNames = record.origin_file_names;
  const origin: Pick<TaskContextSnapshot, "origin"> =
    record.origin_type === "external_paste"
      ? {
          origin: {
            type: "external_paste",
            content: readString(record, "origin_content"),
            fileNames: Array.isArray(rawNames)
              ? rawNames.filter((name): name is string => typeof name === "string")
              : [],
          },
        }
      : {};

  return {
    ...origin,
    conversationType,
    conversationId,
    conversationName: readString(record, "conversation_name"),
    originalMessageId: readNullableString(record, "original_message_id"),
    originalMessageText: readString(record, "original_message_text"),
    originalMessageSenderId: readNullableString(record, "original_message_sender_id"),
    originalMessageSenderName: readString(record, "original_message_sender_name"),
    originalMessageCreatedAt: readNullableString(record, "original_message_created_at"),
    userResponse: readString(record, "user_response"),
    snapshotCreatedAt: readString(record, "snapshot_created_at"),
  };
}

/** Said out loud when the quoted message is no longer in the thread. */
export const DELETED_MESSAGE_NOTE = "Tin nhắn gốc đã bị xoá";

/**
 * How "Xem trong ngữ cảnh" names the task it is opening. The chat screen reads this to know
 * which task to point out and which quoted message to scroll to.
 */
export const CONTEXT_TASK_PARAM = "nhiem-vu";

/** The address of a task's own context: its conversation, with the task called out. */
export function contextLink(conversationId: string, taskId: string): string {
  return `/tin-nhan/${conversationId}?${CONTEXT_TASK_PARAM}=${encodeURIComponent(taskId)}`;
}

/**
 * Whether the message this task was raised from is still in the thread.
 *
 * A snapshot that never quoted a message (the thread was empty) is not "deleted" — there was
 * simply nothing to point at, so it must not raise the alarm.
 */
export function isOriginalMessageMissing(
  snapshot: TaskContextSnapshot | null,
  messageIds: readonly string[],
): boolean {
  if (snapshot === null || snapshot.originalMessageId === null) return false;
  return !messageIds.includes(snapshot.originalMessageId);
}

/**
 * Where "Xem trong ngữ cảnh" should land: the conversation, and the message to bring into view.
 * Returns null when the task carries no context at all, which is what every task created
 * before the in-chat flow existed looks like.
 */
export function contextTarget(
  snapshot: TaskContextSnapshot | null,
  fallbackConversationId: string | null,
): { conversationId: string; messageId: string | null } | null {
  if (snapshot !== null) {
    return { conversationId: snapshot.conversationId, messageId: snapshot.originalMessageId };
  }
  if (fallbackConversationId === null) return null;
  return { conversationId: fallbackConversationId, messageId: null };
}
