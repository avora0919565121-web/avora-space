import { completedAtOf, involvesViewer, type TaskItem } from "@/lib/tasks";
import { isDoneStatus, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";
import { weekReadingNoteCount, type Note } from "@/lib/notes";

/**
 * Nhìn lại tuần / hôm nay (Đợt gộp 2 · C7, AVORA-50 · B). Everything here is read from data that
 * already exists; nothing is scored, no streak is counted, nothing is pushed.
 */
export type ReviewKind = "week" | "day";

export type ReviewRange = { kind: ReviewKind; from: Date; to: Date; label: string };

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function ddmm(date: Date): string {
  return `${`${date.getDate()}`.padStart(2, "0")}/${`${date.getMonth() + 1}`.padStart(2, "0")}`;
}

/** The weekly card shows on the day before the rest day (0 = Chủ nhật … 6 = Thứ Bảy). */
export function isWeeklyReviewDay(now: Date, restWeekday: number): boolean {
  return now.getDay() === (((restWeekday % 7) + 6) % 7);
}

/** The seven days ending today, and today alone. `to` is exclusive (tomorrow 00:00). */
export function reviewRange(kind: ReviewKind, now: Date = new Date()): ReviewRange {
  const today = startOfDay(now);
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const from = kind === "week" ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6) : today;
  const label = kind === "week" ? `${ddmm(from)}–${ddmm(today)}` : ddmm(today);
  return { kind, from, to, label };
}

function within(iso: string | null | undefined, range: Pick<ReviewRange, "from" | "to">): boolean {
  if (iso === null || iso === undefined) return false;
  const at = new Date(iso).getTime();
  return !Number.isNaN(at) && at >= range.from.getTime() && at < range.to.getTime();
}

export type ThoughtGroup = { table: ThinkTable; records: ThinkRecord[] };

export type ReviewSummary = {
  /** Đã suy nghĩ: my Hạng mục created or edited in the range, grouped by Bảng. */
  thought: ThoughtGroup[];
  thoughtCount: number;
  /** Đã đọc: books on the Kệ sách touched in the range, and reading notes written. */
  books: ThinkRecord[];
  readingNotes: number;
  /** Đã làm xong: my tasks that closed in the range, newest first. */
  done: TaskItem[];
  /** Còn treo: my Hạng mục past their date and not finished. */
  pending: { record: ThinkRecord; table: ThinkTable }[];
};

/** The four blocks of the review, worked out from what is already loaded. */
export function summarizeReview(input: {
  range: Pick<ReviewRange, "from" | "to">;
  today: string;
  userId: string | undefined;
  tables: readonly ThinkTable[];
  records: readonly ThinkRecord[];
  tasks: readonly TaskItem[];
  notes: readonly Note[];
  readingFolderId: string | null;
}): ReviewSummary {
  const { range, today, userId } = input;
  const tableById = new Map(input.tables.filter((table) => table.deletedAt === null).map((table) => [table.id, table] as const));
  const mine = input.records.filter((record) => record.deletedAt === null && record.ownerUserId === userId && tableById.has(record.tableId));

  const groups = new Map<string, ThoughtGroup>();
  const books: ThinkRecord[] = [];
  const pending: { record: ThinkRecord; table: ThinkTable }[] = [];
  for (const record of mine) {
    const table = tableById.get(record.tableId) as ThinkTable;
    const touched = within(record.createdAt, range) || within(record.updatedAt, range);
    if (table.kind === "bookshelf") {
      if (touched) books.push(record);
      continue;
    }
    if (touched) {
      const group = groups.get(table.id) ?? { table, records: [] };
      group.records.push(record);
      groups.set(table.id, group);
    }
    if (record.nextActionDate !== null && record.nextActionDate < today && !isDoneStatus(table, record.status)) pending.push({ record, table });
  }
  const thought = [...groups.values()]
    .map((group) => ({ ...group, records: [...group.records].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)) }))
    .sort((a, b) => b.records.length - a.records.length);

  const done = input.tasks
    .filter((task) => involvesViewer(task, userId) && within(completedAtOf(task), range))
    .sort((a, b) => ((completedAtOf(a) ?? "") < (completedAtOf(b) ?? "") ? 1 : -1));

  return {
    thought,
    thoughtCount: thought.reduce((sum, group) => sum + group.records.length, 0),
    books,
    readingNotes: weekReadingNoteCount(input.notes, input.readingFolderId, range.from, range.to),
    done,
    pending: pending.sort((a, b) => ((a.record.nextActionDate ?? "") < (b.record.nextActionDate ?? "") ? -1 : 1)),
  };
}

/** "Hôm nay: 2 Hạng mục đã nghĩ · 1 việc xong · 1 lần đọc" — only the parts that happened; null when nothing did. */
export function dailyReviewLine(summary: ReviewSummary): string | null {
  const reading = summary.books.length + summary.readingNotes;
  const parts = [
    summary.thoughtCount > 0 ? `${summary.thoughtCount} Hạng mục đã nghĩ` : null,
    summary.done.length > 0 ? `${summary.done.length} việc xong` : null,
    reading > 0 ? `${reading} lần đọc` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : `Hôm nay: ${parts.join(" · ")}`;
}

export const WEEK_QUESTIONS = [
  "Điều gì đáng giữ lại tuần này?",
  "Điều gì cần đổi hướng?",
  "Tuần tới, một điều quan trọng nhất?",
] as const;
export const DAY_QUESTIONS = ["Điều gì đáng giữ lại hôm nay?"] as const;

/** The one Nhật ký entry the review is saved as: a title, the counts, and the answers given. */
export function reviewJournalText(input: {
  range: ReviewRange;
  summary: ReviewSummary;
  answers: readonly string[];
  focusTitle?: string | null;
}): string {
  const { range, summary } = input;
  const questions = range.kind === "week" ? WEEK_QUESTIONS : DAY_QUESTIONS;
  const title = range.kind === "week" ? `Nhìn lại tuần ${range.label}` : `Nhìn lại hôm nay ${range.label}`;
  const counts = [
    `${summary.thoughtCount} Hạng mục đã nghĩ`,
    `${summary.books.length} sách · ${summary.readingNotes} ghi chép đọc`,
    `${summary.done.length} việc xong`,
    `${summary.pending.length} còn treo`,
  ].join(" · ");
  const lines: string[] = [title, counts];
  questions.forEach((question, index) => {
    const answer = (input.answers[index] ?? "").trim();
    const focus = index === 2 && input.focusTitle ? `★ ${input.focusTitle}` : "";
    const body = [answer, focus].filter((part) => part !== "").join("\n");
    if (body !== "") lines.push("", question, body);
  });
  return lines.join("\n");
}

// ------------------------------------------------------------------ "Để sau" on this device

const DISMISS_PREFIX = "avora.review.dismissed.";

/** Opened, saved or put off ("Để sau"): the card stays folded for the rest of that day. */
export function isReviewDismissed(userId: string | undefined, kind: ReviewKind, day: string): boolean {
  if (userId === undefined) return true;
  try {
    return window.localStorage.getItem(`${DISMISS_PREFIX}${userId}.${kind}`) === day;
  } catch {
    return false;
  }
}

export function dismissReview(userId: string | undefined, kind: ReviewKind, day: string): void {
  if (userId === undefined) return;
  try {
    window.localStorage.setItem(`${DISMISS_PREFIX}${userId}.${kind}`, day);
  } catch {
    // Seen again later today is the fallback.
  }
}
