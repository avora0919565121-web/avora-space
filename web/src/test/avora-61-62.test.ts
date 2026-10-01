import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { notchSide } from "@/components/NotchSync";
import { plusCaption } from "@/components/PlusMenuButton";
import {
  affectedOwners,
  marksSince,
  myPendingChanges,
  needsLeaveReminder,
  summarizeChanges,
  summaryWords,
  type BoardChange,
} from "@/lib/board-changes";
import { FOLDER_COLORS, nextFolderColor, type NoteFolder } from "@/lib/notes";
import {
  cellSortKey,
  COLUMN_PLACEHOLDERS,
  COLUMN_TYPES,
  isHttpLink,
  parseColumnDefs,
  parseColumnInput,
  parseColumnTrash,
  safeTypeChanges,
  type ColumnDef,
  type ThinkRecord,
} from "@/lib/think-hub";

const record = (id: string, fields: Record<string, string | number | null>): ThinkRecord =>
  ({ id, extensionFields: fields }) as unknown as ThinkRecord;

describe("61 · A — one + everywhere", () => {
  it("says what a click does and that holding offers more", () => {
    expect(plusCaption("nhiệm vụ cho tôi")).toBe("Bấm: nhiệm vụ cho tôi · Giữ: thêm lựa chọn");
  });
});

describe("61 · B — folder covers", () => {
  const folder = (id: string, color: NoteFolder["color"], createdAt: string): NoteFolder => ({
    id, parentId: null, name: id, isSystem: false, systemKey: null, position: 0, createdAt, color,
  });
  it("eight quiet colours, and a new folder takes the next one", () => {
    expect(FOLDER_COLORS).toHaveLength(8);
    expect(nextFolderColor([])).toBe("cam");
    expect(nextFolderColor([folder("a", "cam", "2026-01-01"), folder("b", "dat", "2026-01-02")])).toBe("mat_ong");
    expect(nextFolderColor([folder("a", "tro", "2026-01-03")])).toBe("cam");
  });
});

describe("61 · D — eight column kinds", () => {
  it("reads the new kinds back from storage", () => {
    const defs = parseColumnDefs(
      ["link", "contact", "checkbox", "file"].map((type) => ({ id: type, key: type, label: type, type })),
    );
    expect(defs.map((def) => def.type)).toEqual(["link", "contact", "checkbox", "file"]);
    expect(COLUMN_TYPES).toHaveLength(8);
  });

  it("every kind has a hint inside its field (61 · F)", () => {
    expect(COLUMN_PLACEHOLDERS).toMatchObject({
      text: "Nhập chữ",
      number: "Nhập số, vd. 1.000.000",
      date: "Chọn ngày",
      select: "Chọn một mục",
      link: "Dán link https://…",
      contact: "Chọn từ Liên hệ",
      file: "Thêm tệp",
    });
  });

  it("a word in a Số field and a broken link are refused, the text kept by the caller", () => {
    expect(parseColumnInput({ type: "number", label: "Giá" }, "1.000.000")).toEqual({ value: 1_000_000 });
    expect(parseColumnInput({ type: "number", label: "Giá" }, "2,5")).toEqual({ value: 2.5 });
    expect(parseColumnInput({ type: "number", label: "Giá" }, "nhiều lắm")).toEqual({ error: 'Cột "Giá" chỉ nhận số, vd. 1.000.000.' });
    expect(parseColumnInput({ type: "link", label: "Web" }, "avora.vn")).toEqual({ error: "Link cần bắt đầu bằng https:// hoặc http://." });
    expect(parseColumnInput({ type: "link", label: "Web" }, "https://avora.vn")).toEqual({ value: "https://avora.vn" });
    expect(isHttpLink("https://a.vn/x y")).toBe(false);
  });

  it("sorts each kind sensibly: Có before Không, more files first, links as words", () => {
    const yes: ColumnDef = { id: "c", key: "c", label: "Đã ký", type: "checkbox" };
    expect(cellSortKey(record("1", { c: "1" }), yes)).toBeLessThan(cellSortKey(record("2", { c: null }), yes) as number);
    const files: ColumnDef = { id: "f", key: "f", label: "Tệp", type: "file" };
    expect(cellSortKey(record("1", {}), files, 3)).toBeLessThan(cellSortKey(record("2", {}), files, 1) as number);
    const link: ColumnDef = { id: "l", key: "l", label: "Link", type: "link" };
    expect(cellSortKey(record("1", { l: "https://Avora.vn" }), link)).toBe("https://avora.vn");
  });
});

describe("61 · E — column bin and safe type changes", () => {
  it("only safe changes are offered", () => {
    const text: ColumnDef = { id: "t", key: "t", label: "Web", type: "text" };
    expect(safeTypeChanges(text, ["https://a.vn", null, ""])).toEqual(["link"]);
    expect(safeTypeChanges(text, ["https://a.vn", "không phải link"])).toEqual([]);
    expect(safeTypeChanges({ ...text, type: "number" }, [1])).toEqual(["text"]);
    expect(safeTypeChanges({ ...text, type: "checkbox" }, ["1"])).toEqual([]);
  });

  it("the bin keeps 30 days and counts what each column held", () => {
    const now = new Date("2026-10-02T00:00:00Z");
    const trash = parseColumnTrash(
      [
        { def: { id: "a", key: "a", label: "A", type: "text" }, deleted_at: "2026-09-30T00:00:00Z", values: { r1: "x", r2: "y" } },
        { def: { id: "b", key: "b", label: "B", type: "text" }, deleted_at: "2026-08-01T00:00:00Z", values: {} },
      ],
      now,
    );
    expect(trash).toEqual([expect.objectContaining({ filledCount: 2, column: expect.objectContaining({ id: "a" }) })]);
  });
});

describe("61 · J — which side holds the notch", () => {
  it("top of the phone to the left = notch left; the other way = right; upright = unknown", () => {
    expect(notchSide(90)).toBe("left");
    expect(notchSide(-90)).toBe("right");
    expect(notchSide(270)).toBe("right");
    expect(notchSide(0)).toBeNull();
    expect(notchSide(null)).toBeNull();
  });
});

describe("62 — sửa im lặng, báo gộp", () => {
  const change = (over: Partial<BoardChange>): BoardChange => ({
    id: Math.random().toString(36),
    tableId: "t",
    actorId: "a",
    kind: "record_edit",
    recordId: "r",
    columnId: null,
    recordOwnerId: "a",
    recordTitle: "Dự án Hoiana",
    cells: 1,
    before: {},
    after: { status: "dang_lam" },
    createdAt: "2026-10-01T10:00:00Z",
    announcedAt: null,
    announcementId: null,
    ...over,
  });

  it("the card's words, as the server writes them", () => {
    const list = [change({ kind: "record_add" }), change({ kind: "record_add" }), change({ cells: 5 }), change({ kind: "record_delete" })];
    expect(summaryWords(summarizeChanges(list))).toBe("Thêm 2 Hạng mục · Sửa 5 ô · Xoá 1 Hạng mục");
  });

  it("Báo nhóm counts only my unannounced changes", () => {
    const list = [change({}), change({ actorId: "b" }), change({ announcedAt: "2026-10-01T11:00:00Z" })];
    expect(myPendingChanges(list, "a")).toHaveLength(1);
    expect(myPendingChanges(list, "b")).toHaveLength(1);
  });

  it("Báo riêng cho = the makers of the Hạng mục I changed, never me", () => {
    const list = [change({ recordOwnerId: "b" }), change({ recordOwnerId: "a" }), change({ kind: "record_delete", recordOwnerId: "c" }), change({ kind: "record_add", recordOwnerId: "d" })];
    expect(affectedOwners(list, "a").sort()).toEqual(["b", "c"]);
  });

  it("leaving reminds only when someone else's work or a deletion is involved (62.5)", () => {
    expect(needsLeaveReminder([change({ recordOwnerId: "a" })], "a")).toBe(false);
    expect(needsLeaveReminder([change({ recordOwnerId: "b" })], "a")).toBe(true);
    expect(needsLeaveReminder([change({ kind: "record_delete", recordOwnerId: "a" })], "a")).toBe(true);
  });

  it("marks since my last visit: changed cells, new rows, deletions — not my own", () => {
    const list = [
      change({ actorId: "b", after: { status: "x", "ext:col_1": 3 }, cells: 2, createdAt: "2026-10-01T12:00:00Z" }),
      change({ actorId: "b", kind: "record_add", recordId: "r2", createdAt: "2026-10-01T12:00:00Z" }),
      change({ actorId: "b", kind: "record_delete", recordId: "r3", recordTitle: "Cũ", createdAt: "2026-10-01T12:00:00Z" }),
      change({ actorId: "a", recordId: "r4", createdAt: "2026-10-01T12:00:00Z" }),
      change({ actorId: "b", recordId: "r5", createdAt: "2026-09-01T00:00:00Z" }),
    ];
    const marks = marksSince(list, "2026-10-01T00:00:00Z", "a");
    expect([...marks.cells].sort()).toEqual(["r:ext:col_1", "r:status"]);
    expect([...marks.newRecords]).toEqual(["r2"]);
    expect(marks.deleted).toEqual([{ recordId: "r3", title: "Cũ" }]);
    expect(marks.records.has("r4")).toBe(false);
    expect(marks.records.has("r5")).toBe(false);
    expect(marks.count).toBe(4);
  });

  it("an announcement's own changes, for `Xem thay đổi`", () => {
    const list = [change({ announcementId: "x", recordId: "r1" }), change({ announcementId: "y", recordId: "r2" })];
    expect([...marksSince(list, null, undefined, "x").records]).toEqual(["r1"]);
  });
});
