import type { MessageAttachment } from "@/lib/attachments";
import type { DiaryLine } from "@/lib/chat";
import { extractLinks, textWithoutLinks } from "@/lib/diary-views";
import type { TaskItem } from "@/lib/tasks";

/** `YYYY-MM-DD` in local time — the key a day dot and a day tap share. */
export function localDayKey(iso: string): string {
  const date = new Date(iso);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Each day that has a line → the first (oldest) line of that day. */
export function firstLineByDay(lines: readonly DiaryLine[]): Map<string, string> {
  const map = new Map<string, { id: string; at: string }>();
  for (const line of lines) {
    const key = localDayKey(line.createdAt);
    const current = map.get(key);
    if (current === undefined || line.createdAt < current.at) map.set(key, { id: line.id, at: line.createdAt });
  }
  return new Map([...map].map(([key, value]) => [key, value.id] as const));
}

export type ConversationLink = {
  key: string;
  url: string;
  domain: string;
  caption: string;
  senderId: string;
  createdAt: string;
  messageId: string;
};

/** Every link in the conversation, newest first. Nothing is fetched from the linked site. */
export function conversationLinks(lines: readonly DiaryLine[]): ConversationLink[] {
  const rows: ConversationLink[] = [];
  for (const line of lines) {
    const caption = textWithoutLinks(line.content);
    extractLinks(line.content).forEach((link, index) => {
      rows.push({
        key: `${line.id}:${index}`,
        url: link.url,
        domain: link.domain,
        caption,
        senderId: line.senderId,
        createdAt: line.createdAt,
        messageId: line.id,
      });
    });
  }
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export type FileFilter = "all" | "image" | "file" | "voice";

/**
 * Files of lines the viewer can still read, newest first. A recalled line's files are already
 * gone server-side; this also drops any whose line is not in the readable set.
 */
export function conversationFiles(
  attachments: readonly MessageAttachment[],
  lines: readonly DiaryLine[],
  filter: FileFilter,
): MessageAttachment[] {
  const readable = new Set(lines.map((line) => line.id));
  return attachments
    .filter((attachment) => readable.has(attachment.messageId))
    .filter((attachment) => filter === "all" || attachment.kind === filter)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/**
 * Nguồn tạo việc of one conversation: tasks the viewer can see (the list comes from RLS, so a
 * task given privately to someone else is simply not in it) whose context points into here.
 */
export function conversationSourceTasks(tasks: readonly TaskItem[], conversationId: string): TaskItem[] {
  return tasks
    .filter((task) => task.contextSnapshot?.conversationId === conversationId && task.contextSnapshot.originalMessageId !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
