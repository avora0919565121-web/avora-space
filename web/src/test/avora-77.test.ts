import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { canEditHead, canEditQuestion, editedAgo, hasLifecycle, latestConclusions, lifecycleLabel, LIFECYCLES } from "@/lib/board-head";
import { BOOK_CATEGORIES, catalogLink, catalogRefOf, epubOf, WIKISOURCE_TITLES } from "@/lib/book-catalog";
import { byLifecycle, initialShelf, isShelfId, plannedBoards, searchLibrary, SHELVES, shelfStatus, type LibraryCounts } from "@/lib/library";
import { clipExcerpt, EXCERPT_LIMIT, furtherElsewhere, makeLocator, parseLocator, percentOf, positionLabel } from "@/lib/reading-state";
import { clearTabMemory, readTabMemory, rememberPlace, tabOfPath, tabTarget } from "@/lib/tab-memory";
import { REMINDER_TILES, THINKING_TYPES, guideQuestionOf } from "@/lib/think-hub-shelf";
import { SPACE_BLOCK_COPY } from "@/lib/space-blocks";
import type { ThinkRecord, ThinkTable } from "@/lib/think-hub";
import { GUEST_MACHINE_KEY } from "@/lib/guest-machine";

function board(over: Partial<ThinkTable> & { id: string }): ThinkTable {
  return {
    ownerUserId: "me",
    name: over.id,
    position: 0,
    columns: [],
    projectId: null,
    conversationId: null,
    parentRecordId: null,
    depth: 1,
    purpose: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    deletedAt: null,
    statusOptions: null,
    titleLabel: null,
    defaultView: null,
    mobileColumns: [],
    sourceTemplateKey: null,
    archivedAt: null,
    kind: null,
    orphanOrigin: null,
    shareMode: "edit",
    syncSource: null,
    lifecycle: "waiting",
    thinkingType: null,
    ...over,
  };
}

function book(id: string, title: string): ThinkRecord {
  return {
    id,
    tableId: "shelf",
    ownerUserId: "me",
    title,
    status: "muon_doc",
    priority: "trung_binh",
    category: null,
    nextActionDate: null,
    remindAt: null,
    tags: [],
    notes: null,
    extensionFields: {},
    projectId: null,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    movedFrom: null,
  } as ThinkRecord;
}

const counts: LibraryCounts = {
  defaultBoards: 1,
  syncedAt: null,
  planned: 4,
  thinking: 2,
  waiting: 1,
  concluded: 1,
  reading: 1,
  wantToRead: 3,
  books: 4,
  diaryToday: null,
  notes: 7,
  noQuestion: 0,
};

describe("77 · A1/A2 — the four tiles say what the moment asks", () => {
  it("one source of words, used by Kế hoạch and Avora Space", () => {
    expect(REMINDER_TILES.map((tile) => `${tile.label} · ${tile.ask}`)).toEqual([
      "Quá hạn · cần chốt",
      "Hôm nay · cần tập trung",
      "Trong tuần · cần sắp xếp",
      "★ Quan trọng · cần ưu tiên",
    ]);
  });
  it("77.15 · Avora Space calls the block Góc kế hoạch", () => {
    expect(SPACE_BLOCK_COPY.planning.title).toBe("Góc kế hoạch");
  });
  it("no file still says Góc hoạch định, and ThinkSpace is gone", () => {
    const root = path.resolve(__dirname, "..");
    for (const file of ["lib/space-blocks.ts", "pages/Dashboard.tsx", "components/think-hub/RecordDialog.tsx", "lib/guide-content.ts"]) {
      expect(readFileSync(path.join(root, file), "utf8")).not.toContain("Góc hoạch định");
    }
    expect(() => readFileSync(path.join(root, "components/think-hub/ThinkSpace.tsx"))).toThrow();
  });
});

describe("77 · A4 — lifecycle only measures the thinking", () => {
  it("three states + Lưu trữ; nothing about doing", () => {
    expect(LIFECYCLES.map((item) => item.label)).toEqual(["Đang chờ", "Đang suy nghĩ", "Đã chốt"]);
    expect(lifecycleLabel("archived")).toBe("Lưu trữ");
    expect(lifecycleLabel(undefined)).toBe("Đang chờ");
  });
  it("77.19 · Bảng Avora mặc định has no lifecycle and its question is not editable", () => {
    const sync = board({ id: "s", syncSource: "contact_opportunities" });
    expect(hasLifecycle(sync)).toBe(false);
    expect(canEditQuestion(sync, "me")).toBe(false);
    expect(canEditHead(sync, "me", false)).toBe(false);
  });
  it("77.18 · a `Chỉ xem` board: only its owner changes the head", () => {
    const shared = board({ id: "b", ownerUserId: "a", conversationId: "c", shareMode: "view" });
    expect(canEditHead(shared, "b-user", false)).toBe(false);
    expect(canEditHead(shared, "a", false)).toBe(true);
    expect(canEditHead({ ...shared, shareMode: "edit" }, "b-user", false)).toBe(true);
  });
  it("77.17 · the newest conclusion wins, older ones stay in the history", () => {
    const latest = latestConclusions([
      { id: "1", tableId: "t", body: "Chưa nên", createdBy: "me", createdAt: "2026-09-28T00:00:00Z" },
      { id: "2", tableId: "t", body: "Nên, nếu vay được 2 tỷ", createdBy: "me", createdAt: "2026-09-30T00:00:00Z" },
    ]);
    expect(latest.get("t")?.body).toBe("Nên, nếu vay được 2 tỷ");
  });
  it("says when a board was last touched", () => {
    expect(editedAgo("2026-10-01T00:00:00Z", new Date("2026-10-04T08:00:00Z"))).toBe("sửa 3 ngày trước");
  });
});

describe("77 · A5 — five ways of thinking, one source", () => {
  it("carries the agreed words", () => {
    expect(THINKING_TYPES.map((item) => item.label)).toEqual(["Theo dõi", "Tiến trình", "Phân rã", "Cân nhắc", "Học hỏi"]);
    expect(guideQuestionOf("weigh")).toBe("Nếu chọn cái này mà sai thì vì sao?");
    expect(guideQuestionOf("learn")).toBe("Điều này áp dụng vào đâu?");
    expect(guideQuestionOf(null)).toBeNull();
  });
});

describe("77 · B — six shelves", () => {
  it("are numbered 01–06 with one line each", () => {
    expect(SHELVES.map((shelf) => `${shelf.no} ${shelf.name}`)).toEqual([
      "01 Bảng Avora mặc định",
      "02 Bảng tôi hoạch định",
      "03 Theo trạng thái",
      "04 Kệ sách",
      "05 Nhật ký",
      "06 Khác",
    ]);
    expect(isShelfId("ke-sach")).toBe(true);
    expect(isShelfId("y-chua-xep")).toBe(false);
  });
  it("77.1 · first visit: a computer opens kệ 02, a phone the overview", () => {
    expect(initialShelf(null, false)).toBe("hoach-dinh");
    expect(initialShelf(null, true)).toBeNull();
    expect(initialShelf("ke-sach", true)).toBe("ke-sach");
  });
  it("kệ 02 leaves out system boards and the bookshelf; kệ 03 the archived", () => {
    const list = plannedBoards([
      board({ id: "a" }),
      board({ id: "sync", syncSource: "contact_opportunities" }),
      board({ id: "books", kind: "bookshelf" }),
      board({ id: "old", archivedAt: "2026-09-01T00:00:00Z", lifecycle: "archived" }),
      board({ id: "t", lifecycle: "thinking" }),
    ]);
    expect(list.map((item) => item.id).sort()).toEqual(["a", "old", "t"]);
    const lanes = byLifecycle(list);
    expect(lanes.waiting.map((item) => item.id)).toEqual(["a"]);
    expect(lanes.thinking.map((item) => item.id)).toEqual(["t"]);
    expect(lanes.concluded).toEqual([]);
  });
  it("77.6 · kệ 06 on an empty account says there is nothing to file", () => {
    expect(shelfStatus("khac", counts).text).toBe("Không có gì cần xếp");
    expect(shelfStatus("khac", { ...counts, noQuestion: 2 })).toMatchObject({ needsAttention: true });
  });
  it("status lines", () => {
    expect(shelfStatus("trang-thai", counts).text).toBe("Nghĩ 2 · Chờ 1 · Chốt 1");
    expect(shelfStatus("ke-sach", counts).text).toBe("Đang đọc 1 · Muốn đọc 3");
  });
  it("searches boards, questions, books and authors — accent-free", () => {
    const hits = searchLibrary(
      "xuong",
      [board({ id: "x", name: "Xưởng 2", purpose: "Có nên mở xưởng thứ hai?" })],
      [book("k", "Truyện Kiều")],
      () => "Nguyễn Du",
    );
    expect(hits.map((hit) => hit.kind)).toEqual(["board"]);
    expect(searchLibrary("nguyen du", [], [book("k", "Truyện Kiều")], () => "Nguyễn Du")).toHaveLength(1);
  });
});

describe("77 · D — the open library and the reader", () => {
  it("nine categories, one source", () => {
    expect(BOOK_CATEGORIES.map((item) => item.label)).toEqual(["Văn học", "Triết học", "Kinh Thánh", "Lịch sử", "Khoa học", "Kinh tế", "Thơ", "Thiếu nhi", "Khác"]);
  });
  it("77.14 · the checked Wikisource list has Truyện Kiều and the 1925 Bible", () => {
    expect(WIKISOURCE_TITLES.map((item) => item.id)).toContain("Truyện Kiều");
    expect(WIKISOURCE_TITLES.map((item) => item.id)).toContain("Kinh Thánh Cựu Ước và Tân Ước 1925");
  });
  it("a shelf link round-trips into a catalogue reference; other links read nothing", () => {
    const gutenberg = { source: "gutenberg" as const, sourceId: "1342" };
    expect(catalogRefOf(catalogLink(gutenberg))).toEqual(gutenberg);
    const kieu = { source: "wikisource" as const, sourceId: "Truyện Kiều" };
    expect(catalogRefOf(catalogLink(kieu))).toEqual(kieu);
    expect(catalogRefOf("https://example.com/book.pdf")).toBeNull();
    expect(catalogRefOf("https://www.gutenberg.org/ebooks/1342/x")).toBeNull();
  });
  it("EPUB only for Gutenberg, from the official mirror (never www.gutenberg.org)", () => {
    expect(epubOf({ source: "gutenberg", sourceId: "1342" })).toBe("https://gutenberg.pglaf.org/cache/epub/1342/pg1342-images-3.epub");
    expect(epubOf({ source: "wikisource", sourceId: "Truyện Kiều" })).toBeNull();
  });
  it("D4 · a place reads back, and `Đang ở` reads like people write it", () => {
    expect(parseLocator(makeLocator(3, 12))).toEqual({ chapter: 3, block: 12 });
    expect(parseLocator("rubbish")).toEqual({ chapter: 0, block: 0 });
    expect(positionLabel(3, 38.4)).toBe("Chương 4 · 38%");
    expect(percentOf(10, 3, 0.5)).toBe(35);
  });
  it("77.8 · another device further along is offered, never jumped to", () => {
    const server = { recordId: "r", locator: "c5:p0", percent: 52, deviceLabel: "iPhone · Safari", updatedAt: "2026-10-03T10:00:00Z" };
    expect(furtherElsewhere(server, { percent: 30, at: "2026-10-03T09:00:00Z" }, "Mac · Chrome")?.percent).toBe(52);
    expect(furtherElsewhere(server, { percent: 60, at: "2026-10-03T09:00:00Z" }, "Mac · Chrome")).toBeNull();
    expect(furtherElsewhere(server, { percent: 30, at: "2026-10-03T11:00:00Z" }, "Mac · Chrome")).toBeNull();
    expect(furtherElsewhere(server, { percent: 30, at: null }, "iPhone · Safari")).toBeNull();
  });
  it("77.10 · an excerpt is at most 2000 characters", () => {
    expect(clipExcerpt("x".repeat(5000))).toHaveLength(EXCERPT_LIMIT);
    expect(clipExcerpt("  short  ")).toBe("short");
  });
  it("D3 · the reader never blocks translation", () => {
    const source = readFileSync(path.resolve(__dirname, "../pages/BookReader.tsx"), "utf8");
    // Code only — the file's own comment names the attribute it must never use.
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join("\n");
    expect(code).not.toMatch(/translate=/);
    expect(source).not.toMatch(/<iframe|<canvas/);
    expect(source).toContain("lang={language}");
    expect(source).toContain("Dịch bằng trình duyệt — bản dịch không lưu.");
  });
});

/** Unit tests run without a browser: a tiny Storage is enough for the tab memory. */
class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}
if (typeof globalThis.window === "undefined") {
  (globalThis as unknown as { window: unknown }).window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() };
}

describe("77 · G — every tab remembers where you stood", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  it("knows which tab owns a path", () => {
    expect(tabOfPath("/ke-hoach/ke-sach/doc/abc?x=1")).toBe("/ke-hoach");
    expect(tabOfPath("/ket-sat/tai-lieu")).toBe("/ket-sat");
    expect(tabOfPath("/dang-nhap")).toBeNull();
  });
  it("77.24 · going to another tab returns to the remembered place and scroll", () => {
    rememberPlace("u1", "/ke-hoach?ke=ke-sach", 640);
    rememberPlace("u1", "/nhiem-vu?muc=lich", 0);
    expect(tabTarget("/ke-hoach", "/nhiem-vu", "u1")).toEqual({ path: "/ke-hoach?ke=ke-sach", scroll: 640, remembered: true });
    expect(tabTarget("/nhiem-vu", "/ke-hoach", "u1").path).toBe("/nhiem-vu?muc=lich");
  });
  it("77.25 · pressing the tab you are on goes to its root", () => {
    rememberPlace("u1", "/ke-hoach?ke=ke-sach", 300);
    expect(tabTarget("/ke-hoach", "/ke-hoach", "u1")).toEqual({ path: "/ke-hoach", scroll: 0, remembered: false });
  });
  it("one-shot parameters are not remembered; accounts are kept apart", () => {
    rememberPlace("u1", "/nhiem-vu?moi=1&muc=lich", 0);
    expect(readTabMemory("u1")["/nhiem-vu"]?.path).toBe("/nhiem-vu?muc=lich");
    expect(readTabMemory("u2")).toEqual({});
  });
  it("77.26 · a borrowed machine keeps it only for this browser tab", () => {
    window.sessionStorage.setItem(GUEST_MACHINE_KEY, "1");
    rememberPlace("u1", "/tin-nhan/abc", 0);
    expect(window.localStorage.length).toBe(0);
    window.sessionStorage.clear(); // closing the browser tab
    expect(readTabMemory("u1")).toEqual({});
  });
  it("77.27 · Két sắt remembers only the path — its lock still runs on arrival", () => {
    rememberPlace("u1", "/ket-sat/tai-lieu", 0);
    const stored = window.localStorage.getItem("avora.tab-memory.v1:u1") ?? "";
    expect(stored).toContain("/ket-sat/tai-lieu");
    // Only a path and a scroll — never what was on the screen.
    expect(Object.keys(JSON.parse(stored)["/ket-sat"])).toEqual(["path", "scroll"]);
    expect(tabTarget("/ket-sat", "/tong-quan", "u1").path).toBe("/ket-sat/tai-lieu");
  });
  it("signing out forgets everything", () => {
    rememberPlace("u1", "/ke-hoach?ke=khac", 0);
    clearTabMemory();
    expect(readTabMemory("u1")).toEqual({});
  });
  it("a remembered path for the wrong tab or another site is ignored", () => {
    window.localStorage.setItem("avora.tab-memory.v1:u1", JSON.stringify({ "/ke-hoach": { path: "//evil.example", scroll: 0 }, "/nhiem-vu": { path: "/ket-sat", scroll: 0 } }));
    expect(readTabMemory("u1")).toEqual({});
  });
});
