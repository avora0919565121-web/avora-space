import type { MessageAttachment } from "@/lib/attachments";
import type { ChatMessage } from "@/lib/chat-cache";

/**
 * Nhật ký reads five ways (AVORA-44 · A). They are readings, not stores: a journal entry still
 * lives in the one personal conversation, and which reading shows it is worked out when it is
 * read (`diaryPrimaryPlace`), never saved — so editing an entry moves it by itself.
 */
export type DiaryView = "journal" | "notes" | "files" | "links" | "sources";

export const DIARY_VIEWS: readonly { id: DiaryView; label: string; short: string }[] = [
  // AVORA-71 · A: Ghi chép first — used most, and shaped differently (a tree of folders).
  { id: "notes", label: "Ghi chép", short: "Ghi chép" },
  { id: "journal", label: "Nhật ký của tôi", short: "Nhật ký" },
  { id: "files", label: "File của tôi", short: "File" },
  { id: "links", label: "Liên kết", short: "Liên kết" },
  { id: "sources", label: "Nguồn tạo việc", short: "Nguồn tạo việc" },
];

/** The address-bar key naming which Nhật ký view is open (`?xem=`). */
export const DIARY_VIEW_PARAM = "xem";

const VIEW_SLUGS: Readonly<Record<DiaryView, string>> = {
  journal: "nhat-ky",
  notes: "ghi-chep",
  files: "file",
  links: "lien-ket",
  sources: "nguon",
};

export function diaryViewSlug(view: DiaryView): string {
  return VIEW_SLUGS[view];
}

/** The view an address names, or `null` when it names none. */
export function diaryViewFromSlug(slug: string | null): DiaryView | null {
  if (slug === null) return null;
  const found = (Object.keys(VIEW_SLUGS) as DiaryView[]).find((view) => VIEW_SLUGS[view] === slug);
  return found ?? null;
}

// ------------------------------------------------------------------ remembered on this device

const LAST_VIEW_KEY = "avora.diary.lastView";
const SEEN_KEY_PREFIX = "avora.diary.seen.";

/** The view used last on this device; the first visit opens Ghi chép (AVORA-71 · A). */
export function readLastDiaryView(): DiaryView {
  try {
    const stored = window.localStorage.getItem(LAST_VIEW_KEY);
    return diaryViewFromSlug(stored) ?? "notes";
  } catch {
    return "notes";
  }
}

export function rememberDiaryView(view: DiaryView): void {
  try {
    window.localStorage.setItem(LAST_VIEW_KEY, VIEW_SLUGS[view]);
  } catch {
    // Private mode or a full disk: the next visit simply opens Nhật ký của tôi.
  }
}

/** When this view was last looked at, or null when unknown (then no dot is shown). */
export function readDiarySeen(view: DiaryView): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY_PREFIX + view);
  } catch {
    return null;
  }
}

export function markDiarySeen(view: DiaryView, at: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY_PREFIX + view, at);
  } catch {
    // A dot that lingers is harmless.
  }
}

/** The • on a count chip: something arrived after the last look. Unknown seen time → no dot. */
export function hasNewSince(latest: string | null, seen: string | null): boolean {
  if (latest === null || seen === null) return false;
  return latest > seen;
}

// ------------------------------------------------------------------ links

export type FoundLink = { url: string; domain: string };

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;

/** Every http(s) link in a text, in order. Trailing punctuation is not part of a link. */
export function extractLinks(text: string): FoundLink[] {
  const found: FoundLink[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(/[.,;:!?)\]}»”]+$/u, "");
    try {
      const parsed = new URL(url);
      found.push({ url: parsed.href, domain: parsed.hostname.replace(/^www\./i, "") });
    } catch {
      // Not a link after all.
    }
  }
  return found;
}

/** The words of an entry once its links are taken out. */
export function textWithoutLinks(text: string): string {
  return text.replace(URL_PATTERN, " ").replace(/[ \t]+/g, " ").trim();
}

/** "Không quá 1 dòng": trimmed, no line break, at most 120 characters. */
export function isOneLine(text: string): boolean {
  const trimmed = text.trim();
  return !trimmed.includes("\n") && [...trimmed].length <= 120;
}

// ------------------------------------------------------------------ the one place of each entry

export type DiaryPlace = "sources" | "files" | "links" | "journal";

/** A voice note the person recorded themselves stays a thought spoken aloud (A.6). */
export function isOwnVoice(attachment: Pick<MessageAttachment, "kind" | "originMessageId">): boolean {
  return attachment.kind === "voice" && attachment.originMessageId === null;
}

export type DiaryEntryShape = {
  content: string;
  attachments: readonly Pick<MessageAttachment, "kind" | "originMessageId">[];
  /** A task of mine points back at this entry (`context_snapshot.original_message_id`). */
  hasTask: boolean;
};

/**
 * Where an entry lives, read top to bottom — the first row that fits wins (A.3):
 *   1. it made a task → Nguồn tạo việc
 *   2. mostly files (the words fit one line) → File của tôi
 *   3. mostly links (the words besides the links fit one line) → Liên kết
 *   4. otherwise → Nhật ký của tôi
 */
export function diaryPrimaryPlace(entry: DiaryEntryShape): DiaryPlace {
  if (entry.hasTask) return "sources";
  const files = entry.attachments.filter((item) => !isOwnVoice(item));
  if (files.length > 0 && isOneLine(entry.content)) return "files";
  if (extractLinks(entry.content).length > 0 && isOneLine(textWithoutLinks(entry.content))) return "links";
  return "journal";
}

/** Chips on a thought in the timeline: 📎 files and 🔗 links it also carries. */
export function entryChips(entry: DiaryEntryShape): { files: number; links: number } {
  return {
    files: entry.attachments.filter((item) => !isOwnVoice(item)).length,
    links: extractLinks(entry.content).length,
  };
}

// ------------------------------------------------------------------ the timeline

/** Kept for older callers: an entry that is only a photo or a file, with no words. */
export function isFileOnlyNote(message: ChatMessage, attachments: readonly MessageAttachment[]): boolean {
  if (message.systemKind != null || message.deletedAt != null) return false;
  if (message.content.trim() !== "") return false;
  if (attachments.length === 0) return false;
  return attachments.every((item) => !isOwnVoice(item));
}

/**
 * Nhật ký của tôi: the entries whose place is the timeline, in thread order. `showAll` is the
 * \"Hiện tất cả\" switch. `keepIds` stay visible anyway — the entry a task has just pointed at.
 */
export function journalTimeline(
  messages: readonly ChatMessage[],
  attachmentsOf: (messageId: string) => MessageAttachment[],
  keepIds: ReadonlySet<string> = new Set<string>(),
  taskMessageIds: ReadonlySet<string> = new Set<string>(),
  showAll = false,
): ChatMessage[] {
  if (showAll) return [...messages];
  return messages.filter((message) => {
    if (keepIds.has(message.id)) return true;
    if (message.systemKind != null || message.deletedAt != null) return true;
    return (
      diaryPrimaryPlace({
        content: message.content,
        attachments: attachmentsOf(message.id),
        hasTask: taskMessageIds.has(message.id),
      }) === "journal"
    );
  });
}

// ------------------------------------------------------------------ File của tôi

export type DiaryFileSource = "forwarded" | "pasted" | "uploaded";

export type DiaryFileNote = {
  messageId: string;
  attachments: MessageAttachment[];
  /** The words written with the files — their caption. */
  note: string;
  source: DiaryFileSource;
  createdAt: string;
  /** The entry's place: when it is not "files", deleting here also deletes a thought. */
  place: DiaryPlace;
};

/** Every file and photo in the journal (A.3: all of them, wherever the entry lives), newest first. */
export function diaryFileNotes(
  attachments: readonly MessageAttachment[],
  messages: readonly Pick<ChatMessage, "id" | "content">[],
  pastedNoteIds: ReadonlySet<string> = new Set<string>(),
  taskMessageIds: ReadonlySet<string> = new Set<string>(),
): DiaryFileNote[] {
  const noteOf = new Map<string, string>(messages.map((message) => [message.id, message.content.trim()]));
  const byNote = new Map<string, DiaryFileNote>();
  for (const attachment of attachments) {
    if (isOwnVoice(attachment)) continue;
    const existing = byNote.get(attachment.messageId);
    if (existing !== undefined) {
      existing.attachments.push(attachment);
      if (attachment.originMessageId !== null) existing.source = "forwarded";
      continue;
    }
    const note = noteOf.get(attachment.messageId) ?? "";
    byNote.set(attachment.messageId, {
      messageId: attachment.messageId,
      attachments: [attachment],
      note,
      source:
        attachment.originMessageId !== null
          ? "forwarded"
          : pastedNoteIds.has(attachment.messageId)
            ? "pasted"
            : "uploaded",
      createdAt: attachment.createdAt,
      place: "files",
    });
  }
  for (const entry of byNote.values()) {
    entry.place = diaryPrimaryPlace({
      content: entry.note,
      attachments: entry.attachments,
      hasTask: taskMessageIds.has(entry.messageId),
    });
  }
  return [...byNote.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** How many entries File của tôi lists from the journal (own voice notes stay out). */
export function countDiaryFileNotes(attachments: readonly Pick<MessageAttachment, "messageId" | "kind" | "originMessageId">[]): number {
  return new Set<string>(
    attachments.filter((item) => !isOwnVoice({ kind: item.kind, originMessageId: item.originMessageId ?? null })).map((item) => item.messageId),
  ).size;
}

export function diaryFileSourceLabel(source: DiaryFileSource): string {
  if (source === "forwarded") return "Chuyển tiếp vào Nhật ký";
  if (source === "pasted") return "Dán vào để tạo việc";
  return "Bạn tải lên";
}

// ------------------------------------------------------------------ Liên kết

export type DiaryLink = {
  key: string;
  url: string;
  domain: string;
  /** The entry's words (links taken out), or a note's title. */
  caption: string;
  createdAt: string;
  from: { kind: "journal"; messageId: string; place: DiaryPlace } | { kind: "note"; noteId: string; title: string };
};

/**
 * Every link in the journal and in Ghi chép, one row per occurrence — the same link twice is
 * two rows, because each sits in a different context. Nothing is fetched from the linked site.
 */
export function diaryLinks(
  entries: readonly { id: string; content: string; createdAt: string; place: DiaryPlace }[],
  notes: readonly { id: string; title: string; text: string; updatedAt: string }[] = [],
): DiaryLink[] {
  const rows: DiaryLink[] = [];
  for (const entry of entries) {
    const caption = textWithoutLinks(entry.content);
    extractLinks(entry.content).forEach((link, index) => {
      rows.push({
        key: `m:${entry.id}:${index}`,
        url: link.url,
        domain: link.domain,
        caption,
        createdAt: entry.createdAt,
        from: { kind: "journal", messageId: entry.id, place: entry.place },
      });
    });
  }
  for (const note of notes) {
    extractLinks(note.text).forEach((link, index) => {
      rows.push({
        key: `n:${note.id}:${index}`,
        url: link.url,
        domain: link.domain,
        caption: note.title,
        createdAt: note.updatedAt,
        from: { kind: "note", noteId: note.id, title: note.title },
      });
    });
  }
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** The newest time among items, for the • dot. */
export function latestOf(times: readonly string[]): string | null {
  let latest: string | null = null;
  for (const time of times) if (latest === null || time > latest) latest = time;
  return latest;
}
