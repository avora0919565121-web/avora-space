import type { Lifecycle } from "@/lib/board-head";
import { normalizeSearch } from "@/lib/normalize-search";
import { rootTables, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";

/**
 * AVORA-77 · B (ADR-048) — Kế hoạch as a library of six shelves.
 *
 * Shelves are readings, not stores: kệ 02 and kệ 03 show the very same boards; kệ 05 is only a
 * door into Nhật ký; kệ 06 lists what has no place yet. Nothing here is saved anywhere.
 */
export type ShelfId = "mac-dinh" | "hoach-dinh" | "trang-thai" | "ke-sach" | "nhat-ky" | "khac";

export const SHELVES: readonly { id: ShelfId; no: string; name: string; description: string }[] = [
  { id: "mac-dinh", no: "01", name: "Bảng Avora mặc định", description: "Avora tự lập từ dữ liệu của bạn" },
  { id: "hoach-dinh", no: "02", name: "Bảng tôi hoạch định", description: "Của tôi · 1-1 · Nhóm · Dự án" },
  { id: "trang-thai", no: "03", name: "Theo trạng thái", description: "Đã chốt · Đang suy nghĩ · Đang chờ" },
  { id: "ke-sach", no: "04", name: "Kệ sách", description: "Đọc, ghi chép, mở lại đúng chỗ" },
  { id: "nhat-ky", no: "05", name: "Nhật ký", description: "Ghi chép, nhật ký, file, liên kết" },
  { id: "khac", no: "06", name: "Khác", description: "Những gì chưa có chỗ" },
];

/** `?ke=` on the address names the open shelf. */
export const SHELF_PARAM = "ke";

export function isShelfId(value: string | null): value is ShelfId {
  return SHELVES.some((shelf) => shelf.id === value);
}

export function shelfOf(id: ShelfId): (typeof SHELVES)[number] {
  return SHELVES.find((shelf) => shelf.id === id) ?? SHELVES[1];
}

/** The muted covers of Kệ sách — the spines of every shelf card use the same eight. */
export const COVERS: readonly string[] = ["#5B4636", "#2F4A3F", "#3B4A63", "#6B3F3F", "#4A4A2E", "#3F3552", "#2E4F55", "#6A5230"];

export function coverColor(title: string): string {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COVERS[hash % COVERS.length];
}

/** Bảng Avora mặc định (ADR-045): a board a source fills, not a person. */
export function isDefaultBoard(table: ThinkTable): boolean {
  return table.syncSource != null;
}

/** Két sắt boards are never searched (ADR-032). None exist yet; the rule is here for when they do. */
export function isVaultBoard(table: ThinkTable): boolean {
  return (table.syncSource as string | null | undefined)?.startsWith("vault") === true;
}

/** Boards a person plans with: roots, live, not a system board, not the bookshelf. */
export function plannedBoards(tables: readonly ThinkTable[]): ThinkTable[] {
  return rootTables(tables).filter((table) => table.deletedAt === null && !isDefaultBoard(table) && table.kind !== "bookshelf");
}

export type PlaceFilter = "all" | "personal" | "direct" | "group" | "project";

export const PLACE_FILTERS: readonly { id: PlaceFilter; label: string }[] = [
  { id: "all", label: "Tất cả" },
  { id: "personal", label: "Của tôi" },
  { id: "direct", label: "1-1" },
  { id: "group", label: "Nhóm" },
  { id: "project", label: "Dự án" },
];

export function placeKindOf(table: ThinkTable, kindOf: (conversationId: string) => string | undefined): Exclude<PlaceFilter, "all"> {
  if (table.projectId !== null) return "project";
  if (table.conversationId === null) return "personal";
  return kindOf(table.conversationId) === "group" ? "group" : "direct";
}

/** Kệ 03 columns, in reading order. Archived boards are not on this shelf. */
export function byLifecycle(boards: readonly ThinkTable[]): Record<Exclude<Lifecycle, "archived">, ThinkTable[]> {
  const out: Record<Exclude<Lifecycle, "archived">, ThinkTable[]> = { waiting: [], thinking: [], concluded: [] };
  for (const board of boards) {
    if (board.archivedAt !== null || board.lifecycle === "archived") continue;
    const lane = board.lifecycle === "thinking" || board.lifecycle === "concluded" ? board.lifecycle : "waiting";
    out[lane].push(board);
  }
  for (const lane of Object.values(out)) lane.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

export type ShelfStatus = { text: string; needsAttention: boolean; spines: number };

export type LibraryCounts = {
  defaultBoards: number;
  syncedAt: string | null;
  planned: number;
  thinking: number;
  waiting: number;
  concluded: number;
  reading: number;
  wantToRead: number;
  books: number;
  diaryToday: number | null;
  notes: number | null;
  noQuestion: number;
};

function hhmm(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** The one line under each shelf card: what is on it now. */
export function shelfStatus(id: ShelfId, counts: LibraryCounts): ShelfStatus {
  switch (id) {
    case "mac-dinh":
      return {
        text: `${counts.defaultBoards} bảng${counts.syncedAt === null ? "" : ` · đồng bộ ${hhmm(counts.syncedAt)}`}`,
        needsAttention: false,
        spines: counts.defaultBoards,
      };
    case "hoach-dinh":
      return { text: `${counts.planned} bảng · ${counts.thinking} đang suy nghĩ`, needsAttention: false, spines: counts.planned };
    case "trang-thai":
      return {
        text: `Nghĩ ${counts.thinking} · Chờ ${counts.waiting} · Chốt ${counts.concluded}`,
        needsAttention: counts.waiting > 0,
        spines: counts.thinking + counts.waiting + counts.concluded,
      };
    case "ke-sach":
      return { text: `Đang đọc ${counts.reading} · Muốn đọc ${counts.wantToRead}`, needsAttention: false, spines: counts.books };
    case "nhat-ky": {
      const parts: string[] = [];
      if (counts.diaryToday !== null) parts.push(`Hôm nay ${counts.diaryToday}`);
      if (counts.notes !== null) parts.push(`Ghi chép ${counts.notes}`);
      return { text: parts.length === 0 ? "Mở Nhật ký" : parts.join(" · "), needsAttention: false, spines: counts.notes ?? 0 };
    }
    case "khac":
      return counts.noQuestion > 0
        ? { text: `${counts.noQuestion} bảng chưa có câu hỏi`, needsAttention: true, spines: counts.noQuestion }
        : { text: "Không có gì cần xếp", needsAttention: false, spines: 0 };
  }
}

/** Spine heights, the same for the same shelf every time (no flicker between renders). */
export function spineHeights(count: number, seed: string): number[] {
  const out: number[] = [];
  let hash = 7;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  for (let index = 0; index < Math.min(10, count); index += 1) {
    hash = (hash * 1103515245 + 12345) >>> 0;
    out.push(60 + (hash % 41));
  }
  return out;
}

export type LibraryHit =
  | { kind: "board"; table: ThinkTable; detail: string | null }
  | { kind: "book"; record: ThinkRecord; detail: string | null };

/**
 * `Tìm trong mọi kệ`: board names and questions, book titles and authors — accent-free.
 * Két sắt boards are never in the results (ADR-032).
 */
export function searchLibrary(
  query: string,
  boards: readonly ThinkTable[],
  books: readonly ThinkRecord[],
  authorOf: (book: ThinkRecord) => string,
): LibraryHit[] {
  const needle = normalizeSearch(query);
  if (needle === "") return [];
  const hits: LibraryHit[] = [];
  for (const table of boards) {
    if (isVaultBoard(table) || table.deletedAt !== null) continue;
    if (normalizeSearch(`${table.name} ${table.purpose ?? ""}`).includes(needle)) hits.push({ kind: "board", table, detail: table.purpose });
  }
  for (const book of books) {
    const author = authorOf(book);
    if (normalizeSearch(`${book.title} ${author}`).includes(needle)) hits.push({ kind: "book", record: book, detail: author === "" ? null : author });
  }
  return hits.slice(0, 20);
}

/**
 * Where Kế hoạch opens when nothing names a shelf: a computer opens kệ 02 beside the cards; a phone
 * shows the six shelves as a list first (B1).
 */
export function initialShelf(requested: string | null, isPhone: boolean): ShelfId | null {
  if (isShelfId(requested)) return requested;
  return isPhone ? null : "hoach-dinh";
}
