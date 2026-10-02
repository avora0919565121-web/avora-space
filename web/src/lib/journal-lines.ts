import type { MessageAttachment } from "@/lib/attachments";
import type { ChatMessage } from "@/lib/chat-cache";
import { extractLinks } from "@/lib/diary-views";

/**
 * AVORA-70: Nhật ký của tôi read as a notebook of one-line entries, grouped by day.
 *
 * Pure helpers (testable without a browser): what kind of entry a line is, its first line, the
 * day it belongs to and how that day is written, and which days this device keeps folded.
 */

/** One row is as tall as a row of the 1-1 / Nhóm list: a 44px face + 12px above and below. */
export const LINE_ROW_PX = 68;
/** The day row is about two thirds of that, so the eye finds the day at once. */
export const DAY_ROW_PX = 44;
/** More than this many lines of text (or any image / PDF) offers `⤢ Xem toàn màn`. */
export const LONG_ENTRY_LINES = 10;
/** Tidying this many entries or more asks once; fewer is undone from the toast instead. */
export const CLEANUP_CONFIRM_AT = 50;

export type JournalEntryKind = "text" | "forwarded" | "file" | "image" | "link" | "voice" | "task";

/** The icon a line carries: a task raised from it wins, then what it holds. */
export function journalEntryKind(
  message: Pick<ChatMessage, "content" | "originContentId">,
  attachments: readonly Pick<MessageAttachment, "kind">[],
  hasTask: boolean,
): JournalEntryKind {
  if (hasTask) return "task";
  if (message.originContentId != null) return "forwarded";
  if (attachments.some((item) => item.kind === "voice")) return "voice";
  if (attachments.some((item) => item.kind === "image")) return "image";
  if (attachments.length > 0) return "file";
  if (extractLinks(message.content).length > 0) return "link";
  return "text";
}

/** The first line of what was written, or the file's name when there are no words. */
export function journalFirstLine(content: string, attachments: readonly Pick<MessageAttachment, "fileName" | "kind">[]): string {
  const line = content.split("\n").map((part) => part.trim()).find((part) => part !== "");
  if (line !== undefined) return line;
  const first = attachments[0];
  if (first === undefined) return "(trống)";
  if (first.kind === "voice") return "Ghi âm";
  return attachments.length > 1 ? `${first.fileName} và ${attachments.length - 1} tệp khác` : first.fileName;
}

export function isLongEntry(content: string, attachments: readonly Pick<MessageAttachment, "kind" | "mimeType">[]): boolean {
  if (attachments.some((item) => item.kind === "image" || item.mimeType === "application/pdf")) return true;
  return content.split("\n").length > LONG_ENTRY_LINES || content.length > 700;
}

/** The local calendar day of an instant, `YYYY-MM-DD`. */
export function dayKeyOf(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const WEEKDAYS = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"] as const;

/** `Thứ Năm, 25/09/2026`. */
export function journalDayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map((part) => Number(part));
  const date = new Date(year, month - 1, day);
  return `${WEEKDAYS[date.getDay()]}, ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

export type DayGroup<T> = { key: string; label: string; items: T[] };

/** Consecutive items of one day, in the order given. */
export function groupByDay<T extends { at: string }>(items: readonly T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const key = dayKeyOf(item.at);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.items.push(item);
    else groups.push({ key, label: journalDayLabel(key), items: [item] });
  }
  return groups;
}

/** `1,2 MB`, `840 KB`. */
export function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ------------------------------------------------------------------ folded days, per device

export function readFoldedDays(storageKey: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return new Set(raw === null ? [] : (JSON.parse(raw) as string[]));
  } catch {
    return new Set();
  }
}

export function writeFoldedDays(storageKey: string, days: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...days].slice(-400)));
  } catch {
    // Remembering is a courtesy.
  }
}
