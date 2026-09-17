import { supabase } from "@/integrations/supabase/client";

/**
 * A live piece of work that came out of one message.
 *
 * Only pending and accepted rows are ever fetched: a suggestion that was declined or taken
 * back is not work anybody is carrying, and marking the message it came from would tell the
 * reader something is happening when nothing is.
 */
export type MessageTaskMark = {
  suggestionId: string;
  messageId: string;
  assigneeId: string;
  /** The task it became, once somebody agreed. Null while it is still a question. */
  taskId: string | null;
};

export const messageTaskKeys = {
  all: ["message-tasks"] as const,
  thread: (conversationId: string) => ["message-tasks", conversationId] as const,
};

type MarkRow = {
  id: string;
  message_id: string | null;
  assignee_id: string;
  accepted_task_id: string | null;
};

function fail(code: string | undefined, message: string): Error {
  console.error(`[message-tasks] ${code ?? "unknown"}: ${message}`);
  return new Error("Không đọc được nhiệm vụ gắn với tin nhắn.");
}

/**
 * Every live suggestion hanging off a set of messages.
 *
 * Batched per thread exactly like reactions: the conversation renders all its bubbles at
 * once, so asking per bubble would be a request per bubble.
 */
export async function fetchMessageTaskMarks(
  messageIds: readonly string[],
): Promise<MessageTaskMark[]> {
  if (messageIds.length === 0) return [];
  const { data, error } = await supabase
    .from("task_suggestions")
    .select("id, message_id, assignee_id, accepted_task_id")
    .in("message_id", [...messageIds])
    .in("status", ["pending", "accepted"]);

  if (error) throw fail(error.code, error.message);
  return (data ?? []).flatMap((row) => {
    const entry = row as MarkRow;
    if (entry.message_id === null) return [];
    return [
      {
        suggestionId: entry.id,
        messageId: entry.message_id,
        assigneeId: entry.assignee_id,
        taskId: entry.accepted_task_id,
      },
    ];
  });
}

/** What the dot beside a message means, once the rows for that message are read together. */
export type MessageTaskSummary = {
  /**
   * Whose work it is. `mine` wins whenever any of it is the reader's, because their own
   * promise is the reason they would look twice at an old message.
   */
  tone: "mine" | "others";
  count: number;
  /** Where pressing it should land: a real task if one exists, else the pending suggestion. */
  taskId: string | null;
  suggestionId: string;
};

/**
 * The single mark for one message, or null when that message produced no live work.
 *
 * Several suggestions can come from one message — a group where three people each took a
 * piece — and they collapse into one dot. A row of dots would be counting rather than saying
 * the one thing a reader wants to know: something came of this.
 */
export function summarizeMessageTasks(
  marks: readonly MessageTaskMark[],
  messageId: string,
  viewerId: string | undefined,
): MessageTaskSummary | null {
  const own: MessageTaskMark[] = [];
  const others: MessageTaskMark[] = [];
  for (const mark of marks) {
    if (mark.messageId !== messageId) continue;
    if (viewerId !== undefined && mark.assigneeId === viewerId) own.push(mark);
    else others.push(mark);
  }

  const total = own.length + others.length;
  if (total === 0) return null;

  // Prefer the reader's own, and within that prefer one that already became a task, so the
  // dot leads somewhere real whenever anything real exists.
  const preferred = [...own, ...others];
  const landable = preferred.find((mark) => mark.taskId !== null) ?? preferred[0];

  return {
    tone: own.length > 0 ? "mine" : "others",
    count: total,
    taskId: landable.taskId,
    suggestionId: landable.suggestionId,
  };
}

/** What the dot's label says out loud, for a screen reader and on hover. */
export function describeMessageTasks(summary: MessageTaskSummary): string {
  const what = summary.tone === "mine" ? "nhiệm vụ của bạn" : "nhiệm vụ";
  const many = summary.count > 1 ? ` (${summary.count})` : "";
  return `Tin nhắn này đã tạo ${what}${many} — mở ra xem`;
}
