import { ensureJournalConversation, sendMessage } from "@/lib/chat";
import { completedAtOf, type TaskItem } from "@/lib/tasks";

/**
 * The line the journal receives when a completed task is forwarded.
 *
 * Two lines on purpose: what closed, and what it brought. The journal already timestamps
 * every entry, so a date would only repeat what the thread shows — the words are the part
 * worth reading back a month later.
 */
export function journalForwardContent(task: Pick<TaskItem, "title" | "outputValue">): string {
  return `✅ ${task.title}\n${task.outputValue ?? ""}`.trimEnd();
}

/**
 * Copies a completed task's output into the viewer's own journal.
 *
 * The journal is the one place nobody else reads, which is exactly why a result lands there:
 * the Báo cáo answers "what did I deliver", and the journal keeps it. Returns the journal's
 * conversation id so the caller can offer to open it.
 */
export async function forwardTaskOutputToJournal(userId: string, task: TaskItem): Promise<string> {
  if (task.outputValue === null)
    throw new Error("Việc này chưa có kết quả để chuyển vào Nhật ký.");
  const conversationId = await ensureJournalConversation();
  await sendMessage(conversationId, userId, journalForwardContent(task));
  return conversationId;
}

/** When the result closed, said briefly for the report row. */
export function completedDayLabel(task: TaskItem): string | null {
  const at = completedAtOf(task);
  if (at === null) return null;
  const [, month, day] = at.slice(0, 10).split("-");
  return `${Number(day)}/${Number(month)}`;
}
