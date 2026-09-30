import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  dailyReviewLine,
  isWeeklyReviewDay,
  reviewJournalText,
  reviewRange,
  summarizeReview,
} from "@/lib/review";
import { isDoneStatus, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";
import type { TaskItem } from "@/lib/tasks";
import type { Note } from "@/lib/notes";

const ME = "me";

function table(id: string, extra: Partial<ThinkTable> = {}): ThinkTable {
  return {
    id,
    ownerUserId: ME,
    name: `Bảng ${id}`,
    position: 0,
    columns: [],
    projectId: null,
    conversationId: null,
    parentRecordId: null,
    depth: 1,
    purpose: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    statusOptions: null,
    titleLabel: null,
    defaultView: null,
    mobileColumns: [],
    sourceTemplateKey: null,
    archivedAt: null,
    kind: null,
    orphanOrigin: null,
    ...extra,
  };
}

function record(id: string, tableId: string, extra: Partial<ThinkRecord> = {}): ThinkRecord {
  return {
    id,
    tableId,
    ownerUserId: ME,
    title: `Hạng mục ${id}`,
    status: "moi",
    priority: "trung_binh",
    category: null,
    nextActionDate: null,
    remindAt: null,
    tags: [],
    notes: null,
    extensionFields: {},
    projectId: null,
    createdAt: "2026-09-01T08:00:00",
    updatedAt: "2026-09-01T08:00:00",
    deletedAt: null,
    movedFrom: null,
    ...extra,
  };
}

function task(id: string, doneAt: string | null, extra: Partial<TaskItem> = {}): TaskItem {
  return { id, title: `Việc ${id}`, type: "personal", creatorId: ME, assigneeId: null, status: doneAt === null ? "todo" : "done", doneAt, completedConfirmedAt: null, ...extra } as TaskItem;
}

// Saturday 26/09/2026, 19:30 local.
const now = new Date(2026, 8, 26, 19, 30);

describe("when the review shows (50.B1–B2)", () => {
  it("weekly: the day before the rest day (Chủ nhật → Thứ Bảy)", () => {
    expect(isWeeklyReviewDay(now, 0)).toBe(true);
    expect(isWeeklyReviewDay(now, 1)).toBe(false);
    // Rest day Thứ Hai → review on Chủ nhật.
    expect(isWeeklyReviewDay(new Date(2026, 8, 27), 1)).toBe(true);
  });
  it("ranges: the seven days ending today, and today alone", () => {
    const week = reviewRange("week", now);
    expect(week.label).toBe("20/09–26/09");
    expect(week.from.getDate()).toBe(20);
    expect(week.to.getDate()).toBe(27);
    const day = reviewRange("day", now);
    expect(day.label).toBe("26/09");
  });
});

describe("the four blocks", () => {
  const tables = [table("a"), table("b"), table("shelf", { kind: "bookshelf" }), table("gone", { deletedAt: "2026-09-10T00:00:00Z" })];
  const inWeek = "2026-09-24T10:00:00";
  const today = "2026-09-26T09:00:00";
  const records = [
    record("r1", "a", { updatedAt: inWeek }),
    record("r2", "a", { createdAt: today, updatedAt: today }),
    record("r3", "b", { updatedAt: inWeek }),
    record("old", "b"),
    record("other", "a", { ownerUserId: "someone", updatedAt: inWeek }),
    record("inGone", "gone", { updatedAt: inWeek }),
    record("book", "shelf", { status: "dang_doc", updatedAt: inWeek }),
    record("late", "b", { nextActionDate: "2026-09-20" }),
    record("lateDone", "b", { nextActionDate: "2026-09-20", status: "xong" }),
    record("setAside", "b", { nextActionDate: "2026-09-20", status: "khong_lam" }),
  ];
  const tasks = [task("t1", "2026-09-25T12:00:00"), task("t2", "2026-09-10T12:00:00"), task("t3", null), task("t4", today, { creatorId: "x" })];
  const notes: Note[] = [
    { id: "n", folderId: "reading", title: "", blocks: [], tags: [], pinnedAt: null, bookRecordId: null, bookTitle: null, deletedAt: null, createdAt: inWeek, updatedAt: inWeek },
  ];

  const week = summarizeReview({ range: reviewRange("week", now), today: "2026-09-26", userId: ME, tables, records, tasks, notes, readingFolderId: "reading" });

  it("Đã suy nghĩ: my records touched this week, grouped by Bảng, never someone else's or a deleted table's", () => {
    expect(week.thoughtCount).toBe(3);
    expect(week.thought.map((group) => group.table.id)).toEqual(["a", "b"]);
  });
  it("Đã đọc: books on the shelf and reading notes", () => {
    expect(week.books.map((book) => book.id)).toEqual(["book"]);
    expect(week.readingNotes).toBe(1);
  });
  it("Đã làm xong: my tasks closed in the week only", () => {
    expect(week.done.map((item) => item.id)).toEqual(["t1"]);
  });
  it("Còn treo: past their date and not finished; Không làm nữa counts as set aside", () => {
    expect(week.pending.map((row) => row.record.id)).toEqual(["late"]);
    expect(isDoneStatus(table("x", { statusOptions: [{ key: "moi", label: "Mới" }] }), "khong_lam")).toBe(true);
  });

  it("the daily line names only what happened, and is absent on an empty day (50.B2)", () => {
    const day = summarizeReview({ range: reviewRange("day", now), today: "2026-09-26", userId: ME, tables, records, tasks, notes, readingFolderId: "reading" });
    expect(dailyReviewLine(day)).toBe("Hôm nay: 1 Hạng mục đã nghĩ");
    const empty = summarizeReview({ range: reviewRange("day", now), today: "2026-09-26", userId: ME, tables, records: [], tasks: [], notes: [], readingFolderId: null });
    expect(dailyReviewLine(empty)).toBeNull();
  });

  it("Lưu vào Nhật ký writes one entry: title, counts, only the answers given (50.B1)", () => {
    const text = reviewJournalText({ range: reviewRange("week", now), summary: week, answers: ["Giữ nhịp sáng sớm", "", ""], focusTitle: "Hạng mục late" });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Nhìn lại tuần 20/09–26/09");
    expect(text).toContain("Điều gì đáng giữ lại tuần này?\nGiữ nhịp sáng sớm");
    expect(text).not.toContain("Điều gì cần đổi hướng?");
    expect(text).toContain("Tuần tới, một điều quan trọng nhất?\n★ Hạng mục late");
  });
});
