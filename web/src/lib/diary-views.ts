import type { MessageAttachment } from "@/lib/attachments";
import type { ChatMessage } from "@/lib/chat-cache";

/**
 * Diary reads three ways. They are readings of the same journal, not three stores: every note
 * still lives in the one personal conversation, and switching views never moves anything.
 */
export type DiaryView = "journal" | "files" | "sources";

export const DIARY_VIEWS: readonly { id: DiaryView; label: string }[] = [
  { id: "journal", label: "Nhật ký của bạn" },
  { id: "files", label: "File của bạn" },
  { id: "sources", label: "Nguồn tạo việc" },
];

/** The address-bar key naming which Diary view is open (`?xem=`). */
export const DIARY_VIEW_PARAM = "xem";

const VIEW_SLUGS: Readonly<Record<DiaryView, string>> = { journal: "nhat-ky", files: "file", sources: "nguon" };

/** The slug a Diary view is written as in the address bar. */
export function diaryViewSlug(view: DiaryView): string {
  return VIEW_SLUGS[view];
}

/**
 * The Diary view an address names, or `null` when it names none.
 *
 * `null` matters on a phone: it means the reader is on the three-row Diary list and has not
 * opened any view yet. A computer shows the list and the journal side by side either way.
 */
export function diaryViewFromSlug(slug: string | null): DiaryView | null {
  if (slug === null) return null;
  const found = (Object.keys(VIEW_SLUGS) as DiaryView[]).find((view) => VIEW_SLUGS[view] === slug);
  return found ?? null;
}

/**
 * A note that is only a photo or a file, with no words of its own.
 *
 * It belongs to File của bạn, where it is shown with its source. Everything else — anything with
 * words, a voice note, a note that was deleted — stays in the written timeline, so nothing ever
 * falls between the two views.
 */
export function isFileOnlyNote(message: ChatMessage, attachments: readonly MessageAttachment[]): boolean {
  if (message.systemKind != null || message.deletedAt != null) return false;
  if (message.content.trim() !== "") return false;
  if (attachments.length === 0) return false;
  return attachments.every((item) => item.kind !== "voice");
}

/**
 * Nhật ký của bạn: the written timeline, in thread order.
 *
 * `keepIds` are notes that must stay visible anyway — the file note a pasted task points at,
 * when "Xem trong ngữ cảnh" has just brought the reader here to see it.
 */
export function journalTimeline(
  messages: readonly ChatMessage[],
  attachmentsOf: (messageId: string) => MessageAttachment[],
  keepIds: ReadonlySet<string> = new Set<string>(),
): ChatMessage[] {
  return messages.filter(
    (message) => keepIds.has(message.id) || !isFileOnlyNote(message, attachmentsOf(message.id)),
  );
}

export type DiaryFileSource = "forwarded" | "pasted" | "uploaded";

/** One Diary note's photos and files, with the words written beside them. */
export type DiaryFileNote = {
  messageId: string;
  attachments: MessageAttachment[];
  /** The words written with the files, if any — their context note. */
  note: string;
  source: DiaryFileSource;
  createdAt: string;
};

/**
 * File của bạn: every photo and file in the journal, one entry per note, newest first.
 *
 * `pastedNoteIds` are the notes that hold files pasted in to make a task — named as such, so
 * the list says where each file came from rather than only that it is there.
 */
export function diaryFileNotes(
  attachments: readonly MessageAttachment[],
  messages: readonly ChatMessage[],
  pastedNoteIds: ReadonlySet<string> = new Set<string>(),
): DiaryFileNote[] {
  const noteOf = new Map<string, string>(messages.map((message) => [message.id, message.content.trim()]));
  const byNote = new Map<string, DiaryFileNote>();
  for (const attachment of attachments) {
    if (attachment.kind === "voice") continue;
    const existing = byNote.get(attachment.messageId);
    if (existing !== undefined) {
      existing.attachments.push(attachment);
      if (attachment.originMessageId !== null) existing.source = "forwarded";
      continue;
    }
    byNote.set(attachment.messageId, {
      messageId: attachment.messageId,
      attachments: [attachment],
      note: noteOf.get(attachment.messageId) ?? "",
      source:
        attachment.originMessageId !== null
          ? "forwarded"
          : pastedNoteIds.has(attachment.messageId)
            ? "pasted"
            : "uploaded",
      createdAt: attachment.createdAt,
    });
  }
  return [...byNote.values()].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
}

/** How many entries File của bạn lists: one per note holding a photo or file (voice notes stay out). */
export function countDiaryFileNotes(attachments: readonly MessageAttachment[]): number {
  return new Set<string>(attachments.filter((item) => item.kind !== "voice").map((item) => item.messageId)).size;
}

export function diaryFileSourceLabel(source: DiaryFileSource): string {
  if (source === "forwarded") return "Chuyển tiếp vào Diary";
  if (source === "pasted") return "Dán vào để tạo việc";
  return "Bạn tải lên";
}
