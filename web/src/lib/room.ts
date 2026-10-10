/**
 * AVORA-89 · PHẦN 2 (ADR-057) — Kế hoạch as one room: three wall shelves above, three desk tops below.
 *
 *   KỆ TREO TƯỜNG  [1 Toàn cảnh] [2 Tổng quan] [3 Tiến trình]
 *   MẶT BÀN        [4 Bảng Avora] [5 Đọc & Nhật ký] [6 Bàn làm việc]
 *
 * One shelf at a time. Fixed positions so the room can be pictured; no wrap-around.
 */

export type RoomShelf = 1 | 2 | 3 | 4 | 5 | 6;

export const ROOM_PARAM = "ke";
/** First visit, and a press on the Kế hoạch tab while inside. */
export const ROOM_HOME: RoomShelf = 2;

export const ROOM_SHELVES: readonly { id: RoomShelf; name: string; short: string; row: "wall" | "desk" }[] = [
  { id: 1, name: "Toàn cảnh", short: "Toàn cảnh", row: "wall" },
  { id: 2, name: "Tổng quan", short: "Tổng quan", row: "wall" },
  { id: 3, name: "Tiến trình", short: "Tiến trình", row: "wall" },
  // AVORA-101C: `short` is the word on the strip, read after `Bàn` (Bàn › Avora · Đọc & Nhật ký · Làm việc).
  { id: 4, name: "Bảng Avora", short: "Avora", row: "desk" },
  { id: 5, name: "Đọc & Nhật ký", short: "Đọc & Nhật ký", row: "desk" },
  { id: 6, name: "Bàn làm việc", short: "Làm việc", row: "desk" },
];

export function shelfOfRoom(id: RoomShelf): (typeof ROOM_SHELVES)[number] {
  return ROOM_SHELVES[id - 1];
}

export function isRoomShelf(value: unknown): value is RoomShelf {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6;
}

/** Left / right on the same row; null at the ends (1, 4 have no left; 3, 6 no right). */
export function neighbour(id: RoomShelf, side: "left" | "right" | "up" | "down"): RoomShelf | null {
  const column = (id - 1) % 3;
  const isWall = id <= 3;
  switch (side) {
    case "left":
      return column === 0 ? null : ((id - 1) as RoomShelf);
    case "right":
      return column === 2 ? null : ((id + 1) as RoomShelf);
    case "down":
      return isWall ? ((id + 3) as RoomShelf) : null;
    case "up":
      return isWall ? null : ((id - 3) as RoomShelf);
  }
}

/** Shelves next to a shelf (for the edge arrows of a focused board). */
export function adjacentShelves(id: RoomShelf): { side: "left" | "right" | "up" | "down"; to: RoomShelf }[] {
  return (["left", "right", "up", "down"] as const).flatMap((side) => {
    const to = neighbour(id, side);
    return to === null ? [] : [{ side, to }];
  });
}

/**
 * `?ke=` now holds 1…6. Old addresses keep opening the right place:
 * `mac-dinh`→4 · `hoach-dinh`/`trang-thai`/`khac`→3 · `ke-sach`/`nhat-ky`→5 · `bay=*`→3 · `ngan=sach`→5 · `ngan=avora`→4.
 */
export function roomFromParams(params: URLSearchParams): { shelf: RoomShelf; focus: "store" | "books" | "diary" | null } | null {
  const ke = params.get(ROOM_PARAM);
  const ngan = params.get("ngan");
  if (ke !== null && /^[1-6]$/.test(ke)) return { shelf: Number(ke) as RoomShelf, focus: null };
  switch (ke) {
    case "mac-dinh":
      return { shelf: 4, focus: null };
    case "hoach-dinh":
    case "trang-thai":
      return { shelf: 3, focus: null };
    case "khac":
      return { shelf: 3, focus: "store" };
    case "ke-sach":
      return { shelf: 5, focus: "books" };
    case "nhat-ky":
      return { shelf: 5, focus: "diary" };
  }
  if (ngan === "sach") return { shelf: 5, focus: "books" };
  if (ngan === "avora") return { shelf: 4, focus: null };
  if (params.get("bay") !== null) return { shelf: 3, focus: null };
  return null;
}

/** Remembered on the account (`profiles.prefs.think_hub_room`). */
export function roomFromPref(value: unknown): RoomShelf | null {
  return isRoomShelf(value) ? value : null;
}

/** The six spines of kệ 1, each its own kind of file (not six identical columns). */
export type SpineKind = "binder" | "box" | "book" | "notebook";
export const SPINES: readonly { id: "avora" | "desk" | "progress" | "books" | "diary" | "templates"; label: string; kind: SpineKind; tone: string; opens: RoomShelf | "templates" }[] = [
  { id: "avora", label: "Bảng Avora", kind: "binder", tone: "hsl(22 34% 42%)", opens: 4 },
  { id: "desk", label: "Bàn làm việc", kind: "box", tone: "hsl(184 34% 32%)", opens: 6 },
  { id: "progress", label: "Tiến trình", kind: "binder", tone: "hsl(282 18% 46%)", opens: 3 },
  { id: "books", label: "Sách", kind: "book", tone: "hsl(12 62% 40%)", opens: 5 },
  { id: "diary", label: "Nhật ký", kind: "notebook", tone: "hsl(108 22% 40%)", opens: 5 },
  { id: "templates", label: "Mẫu bảng", kind: "box", tone: "hsl(30 8% 48%)", opens: "templates" },
];

/** A ≥ 40 px horizontal swipe, mostly sideways, decides a shelf change. */
export function swipeDirection(dx: number, dy: number): "left" | "right" | null {
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) return null;
  return dx < 0 ? "right" : "left";
}

/** Does a touch start inside something that scrolls sideways on its own (chips, desk cards, a wide table)? */
export function startsInHorizontalScroller(target: EventTarget | null, stopAt: Element | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node !== null && node !== stopAt) {
    if (node instanceof HTMLElement) {
      if (node.dataset.noRoomSwipe !== undefined) return true;
      const style = window.getComputedStyle(node);
      if ((style.overflowX === "auto" || style.overflowX === "scroll") && node.scrollWidth > node.clientWidth + 1) return true;
    }
    node = node.parentElement;
  }
  return false;
}

// ------------------------------------------------------------------ AVORA-101C · Kệ | Bàn

export type RoomRow = "wall" | "desk";
/** First time on each row (VMT 08/10 23:17): wall → kệ 2, desk → kệ 6. */
export const ROW_HOME: Readonly<Record<RoomRow, RoomShelf>> = { wall: 2, desk: 6 };
const LAST_KEY = "avora-room-last";

export function rowOf(id: RoomShelf): RoomRow {
  return id <= 3 ? "wall" : "desk";
}

/** The three shelves of a row, always in the same order (1 2 3 · 4 5 6) so places never move. */
export function shelvesOfRow(row: RoomRow): readonly (typeof ROOM_SHELVES)[number][] {
  return ROOM_SHELVES.filter((item) => item.row === row);
}

function readLast(storage: Pick<Storage, "getItem"> | null): Partial<Record<RoomRow, unknown>> {
  try {
    const raw = storage?.getItem(LAST_KEY) ?? null;
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? (parsed as Partial<Record<RoomRow, unknown>>) : {};
  } catch {
    return {};
  }
}

function deviceStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Where `Kệ | Bàn` lands: the shelf last stood on in that row (device memory), else the row's home. */
export function lastShelfOfRow(row: RoomRow, storage: Pick<Storage, "getItem"> | null = deviceStorage()): RoomShelf {
  const value = readLast(storage)[row];
  return isRoomShelf(value) && rowOf(value) === row ? value : ROW_HOME[row];
}

/** Remembers the shelf as the last one of its row. Device memory only — no column, no server call. */
export function rememberShelf(id: RoomShelf, storage: Pick<Storage, "getItem" | "setItem"> | null = deviceStorage()): void {
  try {
    storage?.setItem(LAST_KEY, JSON.stringify({ ...readLast(storage), [rowOf(id)]: id }));
  } catch {
    // Private mode or full storage: the row's home is a fine answer.
  }
}
