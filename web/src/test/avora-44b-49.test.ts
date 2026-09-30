import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { chooseFloatingPlacement } from "@/components/ui/floating-panel";
import { daysLeftInTrash } from "@/lib/chat-cache";
import { appendPasted, emptyBlock, notesLayout, NOTES_THREE_COLUMNS_MIN, weekReadingNoteCount } from "@/lib/notes";

describe("Lớp nổi placement (44b · H2)", () => {
  const panel = 470;
  it("opens under the field when the whole panel fits below", () => {
    expect(chooseFloatingPlacement({ anchorTop: 100, anchorBottom: 144, viewportHeight: 900, panelHeight: panel })).toBe("below");
  });
  it("flips above when short below but roomy above", () => {
    expect(chooseFloatingPlacement({ anchorTop: 700, anchorBottom: 744, viewportHeight: 900, panelHeight: panel })).toBe("above");
  });
  it("centres when neither side fits (a 700px window, field in the middle)", () => {
    expect(chooseFloatingPlacement({ anchorTop: 330, anchorBottom: 374, viewportHeight: 700, panelHeight: panel })).toBe("center");
  });
  it("keeps 16px from the edge in the sum", () => {
    // 900 - 400 - 4 - 16 = 480 ≥ 470 → below; one pixel less room → not below.
    expect(chooseFloatingPlacement({ anchorTop: 356, anchorBottom: 400, viewportHeight: 900, panelHeight: panel })).toBe("below");
    expect(chooseFloatingPlacement({ anchorTop: 100, anchorBottom: 411, viewportHeight: 900, panelHeight: panel })).toBe("center");
  });
});

describe("Ghi chép layout (44b · B)", () => {
  it("phone steps; a narrow computer folds folders into the list; wide shows three columns", () => {
    expect(notesLayout(false, 2000)).toBe("phone");
    expect(notesLayout(true, NOTES_THREE_COLUMNS_MIN - 1)).toBe("two");
    expect(notesLayout(true, NOTES_THREE_COLUMNS_MIN)).toBe("three");
  });
});

describe("Paste into an old note (việc 3)", () => {
  it("appends the pasted lines as blocks, replacing a lone empty block", () => {
    const merged = appendPasted([emptyBlock()], "một\nhai");
    expect(merged.map((block) => block.text)).toEqual(["một", "hai"]);
    const kept = appendPasted([{ ...emptyBlock(), text: "đã có" }], "thêm");
    expect(kept.map((block) => block.text)).toEqual(["đã có", "thêm"]);
  });
});

describe("Thùng rác Nhật ký (việc 8)", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  it("counts the days left of the 30", () => {
    expect(daysLeftInTrash("2026-09-30T11:00:00Z", now)).toBe(30);
    expect(daysLeftInTrash("2026-09-01T11:00:00Z", now)).toBe(1);
    expect(daysLeftInTrash("2026-08-01T00:00:00Z", now)).toBe(0);
  });
});

describe("Nhìn lại tuần counts reading notes (việc 4)", () => {
  const base = { deletedAt: null, bookTitle: null } as const;
  it("counts notes on a book or in the reading folder, edited inside the week", () => {
    const notes = [
      { ...base, folderId: "r", bookRecordId: null, updatedAt: "2026-09-25T10:00:00Z" },
      { ...base, folderId: null, bookRecordId: "b1", updatedAt: "2026-09-26T10:00:00Z" },
      { ...base, folderId: "x", bookRecordId: null, updatedAt: "2026-09-26T10:00:00Z" },
      { ...base, folderId: "r", bookRecordId: null, updatedAt: "2026-09-10T10:00:00Z" },
      { ...base, folderId: "r", bookRecordId: null, updatedAt: "2026-09-26T10:00:00Z", deletedAt: "2026-09-27T00:00:00Z" },
    ];
    expect(weekReadingNoteCount(notes, "r", new Date("2026-09-22T00:00:00Z"), new Date("2026-09-29T00:00:00Z"))).toBe(2);
  });
});
