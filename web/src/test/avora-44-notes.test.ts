import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  diaryLinks,
  diaryPrimaryPlace,
  diaryViewFromSlug,
  extractLinks,
  hasNewSince,
  isOneLine,
} from "@/lib/diary-views";
import {
  applyTyping,
  blockLabels,
  blocksFromText,
  bucketNotes,
  indentBlock,
  matchesNote,
  normalizeTags,
  pressBackspaceAtStart,
  pressEnter,
  readBlocks,
  visibleBlocks,
  type Note,
  type NoteBlock,
} from "@/lib/notes";

const file = { kind: "image" as const, originMessageId: null };
const ownVoice = { kind: "voice" as const, originMessageId: null };
const forwardedVoice = { kind: "voice" as const, originMessageId: "m-src" };

describe("diaryPrimaryPlace — A.3, top to bottom", () => {
  it("1 · an entry that made a task lives in Nguồn tạo việc, whatever it holds", () => {
    expect(diaryPrimaryPlace({ content: "Hoá đơn", attachments: [file], hasTask: true })).toBe("sources");
  });
  it("2 · mostly a file (words fit one line) → File của tôi (44.16)", () => {
    expect(diaryPrimaryPlace({ content: "Hoá đơn điện", attachments: [file], hasTask: false })).toBe("files");
    expect(diaryPrimaryPlace({ content: "", attachments: [file], hasTask: false })).toBe("files");
  });
  it("3 · mostly a link (words besides it fit one line) → Liên kết (44.17)", () => {
    expect(diaryPrimaryPlace({ content: "Bài giảng hay https://www.youtube.com/watch?v=abc", attachments: [], hasTask: false })).toBe("links");
  });
  it("4 · a thought with words is the timeline, even with a file and a link (44.18)", () => {
    const five = "Dòng 1\nDòng 2\nDòng 3\nDòng 4\nDòng 5 https://example.com";
    expect(diaryPrimaryPlace({ content: five, attachments: [file], hasTask: false })).toBe("journal");
    expect(diaryPrimaryPlace({ content: "Chỉ là một ý nghĩ", attachments: [], hasTask: false })).toBe("journal");
  });
  it("a voice note I recorded stays in the timeline (44.21); a forwarded one is a file", () => {
    expect(diaryPrimaryPlace({ content: "", attachments: [ownVoice], hasTask: false })).toBe("journal");
    expect(diaryPrimaryPlace({ content: "", attachments: [forwardedVoice], hasTask: false })).toBe("files");
  });
  it("one line = no line break and at most 120 characters, after trimming", () => {
    expect(isOneLine("  một dòng  ")).toBe(true);
    expect(isOneLine("hai\ndòng")).toBe(false);
    expect(isOneLine("a".repeat(120))).toBe(true);
    expect(isOneLine("a".repeat(121))).toBe(false);
    expect(diaryPrimaryPlace({ content: "a".repeat(121), attachments: [file], hasTask: false })).toBe("journal");
    expect(diaryPrimaryPlace({ content: "a\nb", attachments: [file], hasTask: false })).toBe("journal");
  });
});

describe("Liên kết — a reading, nothing fetched", () => {
  it("finds links, strips trailing punctuation, names the domain without www", () => {
    expect(extractLinks("xem https://www.youtube.com/watch?v=1, và http://a.vn/x).")).toEqual([
      { url: "https://www.youtube.com/watch?v=1", domain: "youtube.com" },
      { url: "http://a.vn/x", domain: "a.vn" },
    ]);
  });
  it("one row per occurrence, newest first, journal and Ghi chép together", () => {
    const rows = diaryLinks(
      [
        { id: "m1", content: "https://a.vn", createdAt: "2026-09-01T00:00:00Z", place: "links" },
        { id: "m2", content: "lại https://a.vn", createdAt: "2026-09-03T00:00:00Z", place: "links" },
      ],
      [{ id: "n1", title: "Bài giảng", text: "đọc https://b.vn", updatedAt: "2026-09-02T00:00:00Z" }],
    );
    expect(rows.map((row) => row.key)).toEqual(["m:m2:0", "n:n1:0", "m:m1:0"]);
    expect(rows[1].caption).toBe("Bài giảng");
  });
  it("the • shows only when something is newer than the last look, and never when unknown", () => {
    expect(hasNewSince("2026-09-02", "2026-09-01")).toBe(true);
    expect(hasNewSince("2026-09-01", "2026-09-02")).toBe(false);
    expect(hasNewSince("2026-09-02", null)).toBe(false);
  });
  it("?xem= knows ghi-chep and lien-ket", () => {
    expect(diaryViewFromSlug("ghi-chep")).toBe("notes");
    expect(diaryViewFromSlug("lien-ket")).toBe("links");
  });
});

function b(level: NoteBlock["level"], text: string, id = Math.random().toString(36).slice(2)): NoteBlock {
  return { id, level, text };
}

describe("Ghi chép levels: I. → 1. → A. → a. → + → -", () => {
  it("numbers from position, restarting under each new parent", () => {
    const blocks = [b(0, "Kinh tế"), b(1, "Cung cầu"), b(1, "Giá"), b(2, "Trần"), b(0, "Xã hội"), b(1, "Dân số")];
    expect(blockLabels(blocks)).toEqual(["I.", "1.", "2.", "A.", "II.", "1."]);
    expect(blockLabels([b(3, "x"), b(4, "y"), b(5, "z"), b(null, "đoạn"), b(1, "lại")])).toEqual(["a.", "+", "-", null, "1."]);
  });
  it("44.3: typing `I. Kinh tế` Enter `1. Cung cầu` Enter Enter steps back a level", () => {
    let blocks: NoteBlock[] = [applyTyping(b(null, ""), "I. Kinh tế")];
    expect(blocks[0]).toMatchObject({ level: 0, text: "Kinh tế" });
    let step = pressEnter(blocks, 0, blocks[0].text.length);
    blocks = step.blocks;
    expect(blocks[1].level).toBe(0);
    blocks[1] = indentBlock(blocks[1], 1);
    blocks[1] = { ...blocks[1], text: "Cung cầu" };
    step = pressEnter(blocks, 1, blocks[1].text.length);
    blocks = step.blocks;
    expect(blockLabels(blocks)).toEqual(["I.", "1.", "2."]);
    step = pressEnter(blocks, 2, 0);
    blocks = step.blocks;
    expect(blocks[2].level).toBe(0);
    expect(blockLabels(blocks)).toEqual(["I.", "1.", "II."]);
  });
  it("numbering stays right after inserting and deleting lines", () => {
    const blocks = [b(1, "a", "x1"), b(1, "b", "x2"), b(1, "c", "x3")];
    const inserted = pressEnter(blocks, 0, 1).blocks;
    expect(blockLabels(inserted)).toEqual(["1.", "2.", "3.", "4."]);
    const removed = pressBackspaceAtStart(inserted, 1);
    expect(removed).not.toBeNull();
    expect(blockLabels((removed as { blocks: NoteBlock[] }).blocks)).toEqual(["1.", null, "1.", "2."]);
  });
  it("Enter splits the words at the caret", () => {
    const step = pressEnter([b(1, "Cung cầu")], 0, 4);
    expect(step.blocks.map((item) => item.text)).toEqual(["Cung", " cầu"]);
  });
  it("collapsing a marker hides its branch only", () => {
    const blocks = [{ ...b(0, "I"), collapsed: true }, b(1, "con"), b(2, "cháu"), b(0, "II"), b(1, "con II")];
    expect(visibleBlocks(blocks)).toEqual([true, false, false, true, true]);
  });
  it("pasted lines keep their levels", () => {
    expect(blocksFromText("I. Mở đầu\n1. Ý một\n- chi tiết\nđoạn thường").map((item) => item.level)).toEqual([0, 1, 5, null]);
  });
  it("unreadable stored blocks never crash the editor", () => {
    expect(readBlocks(null)).toHaveLength(1);
    expect(readBlocks([{ level: 9, text: 3 }, "x"])[0]).toMatchObject({ level: null, text: "" });
  });
});

describe("tags", () => {
  it("case-insensitive and #-free: bài giảng = Bài giảng", () => {
    expect(normalizeTags(["#Bài giảng", "bài giảng", "  Kinh   tế ", ""])).toEqual(["Bài giảng", "Kinh tế"]);
  });
  it("44.7: `#bai giang` finds the note tagged #Bài giảng", () => {
    const note: Note = {
      id: "n", folderId: null, title: "Buổi 1", blocks: [b(null, "nội dung")], tags: ["Bài giảng"], pinnedAt: null,
      bookRecordId: null, bookTitle: null, deletedAt: null, createdAt: "2026-09-01", updatedAt: "2026-09-01",
    };
    expect(matchesNote(note, "#bai giang")).toBe(true);
    expect(matchesNote(note, "#kinh te")).toBe(false);
    expect(matchesNote(note, "noi dung")).toBe(true);
  });
});

describe("the list inside a folder", () => {
  it("Đã ghim · Hôm nay · Hôm qua · 7 ngày · 30 ngày · Tháng · năm", () => {
    const now = new Date("2026-09-30T12:00:00");
    const note = (id: string, updatedAt: string, pinned = false): Note => ({
      id, folderId: null, title: id, blocks: [], tags: [], pinnedAt: pinned ? updatedAt : null, bookRecordId: null, bookTitle: null,
      deletedAt: null, createdAt: updatedAt, updatedAt,
    });
    const buckets = bucketNotes(
      [
        note("p", "2026-01-01T00:00:00", true),
        note("t", "2026-09-30T08:00:00"),
        note("y", "2026-09-29T08:00:00"),
        note("w", "2026-09-25T08:00:00"),
        note("m", "2026-09-05T08:00:00"),
        note("aug", "2026-08-01T08:00:00"),
        note("old", "2025-03-01T08:00:00"),
      ],
      now,
    );
    expect(buckets.map((bucket) => bucket.label)).toEqual(["Đã ghim", "Hôm nay", "Hôm qua", "7 ngày qua", "30 ngày qua", "Tháng 8", "2025"]);
  });
});
