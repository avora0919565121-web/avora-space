import { normalizeSearch } from "@/lib/normalize-search";
import type { ThinkTable } from "@/lib/think-hub";

/**
 * AVORA-81 · PHẦN 2 (AVORA-79, ADR-050) — Bàn nghĩ and the three ways to lay out the shelves.
 *
 * The desk is personal (think_hub_desk, at most 5); the arrangements only change how the same
 * boards are laid out — never what they are. Every board appears exactly once in each.
 */
export const DESK_LIMIT = 5;

export type Arrangement = "noi" | "tien-trinh" | "cach-nghi";

export const ARRANGEMENTS: readonly { id: Arrangement; label: string; question: string }[] = [
  { id: "noi", label: "Theo nơi", question: "Mình đang nghĩ cùng ai?" },
  { id: "tien-trinh", label: "Theo tiến trình", question: "Mỗi điều đang nghĩ tới đâu?" },
  { id: "cach-nghi", label: "Theo cách nghĩ", question: "Mình đang dùng cách nghĩ nào?" },
];

/** `?bay=` on the address. */
export const ARRANGEMENT_PARAM = "bay";
/** `?ngan=sach|avora` opens one drawer of `Theo nơi` straight away. */
export const DRAWER_PARAM = "ngan";

export function isArrangement(value: unknown): value is Arrangement {
  return value === "noi" || value === "tien-trinh" || value === "cach-nghi";
}

/** Fewer than three boards of one's own: nothing to arrange yet, so no `Bày theo`. */
export function showArrangePicker(ownBoards: number): boolean {
  return ownBoards >= 3;
}

export type ShelfGroup = { id: string; label: string; boards: ThinkTable[] };

export type PlaceKind = "personal" | "direct" | "group" | "project";

const PLACE_GROUPS: readonly { id: PlaceKind; label: string }[] = [
  { id: "personal", label: "Của tôi" },
  { id: "direct", label: "1-1" },
  { id: "group", label: "Nhóm" },
  { id: "project", label: "Dự án" },
];

const PROGRESS_GROUPS: readonly { id: "waiting" | "thinking" | "concluded"; label: string }[] = [
  { id: "waiting", label: "Đang chờ" },
  { id: "thinking", label: "Đang suy nghĩ" },
  { id: "concluded", label: "Đã chốt" },
];

const THINKING_GROUPS: readonly { id: string; label: string }[] = [
  { id: "track", label: "Theo dõi" },
  { id: "progress", label: "Tiến trình" },
  { id: "breakdown", label: "Phân rã" },
  { id: "weigh", label: "Cân nhắc" },
  { id: "learn", label: "Học hỏi" },
  { id: "none", label: "Chưa chọn kiểu" },
];

function laneOf(board: ThinkTable): "waiting" | "thinking" | "concluded" {
  return board.lifecycle === "thinking" || board.lifecycle === "concluded" ? board.lifecycle : "waiting";
}

/**
 * Lays the planned boards out. Archived boards are not on the shelves (they sit in `Kho`).
 * Groups keep their fixed order; empty groups are kept so a layout never jumps.
 */
export function arrangeBoards(boards: readonly ThinkTable[], arrangement: Arrangement, placeKind: (board: ThinkTable) => PlaceKind): ShelfGroup[] {
  const live = boards.filter((board) => board.archivedAt === null && board.lifecycle !== "archived").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (arrangement === "noi") return PLACE_GROUPS.map((group) => ({ ...group, boards: live.filter((board) => placeKind(board) === group.id) }));
  if (arrangement === "tien-trinh") return PROGRESS_GROUPS.map((group) => ({ ...group, boards: live.filter((board) => laneOf(board) === group.id) }));
  return THINKING_GROUPS.map((group) => ({ ...group, boards: live.filter((board) => (board.thinkingType ?? "none") === group.id) }));
}

/** Tên Bảng trùng câu hỏi → one line only (B2 · 2.A4). */
export function sameWords(a: string | null | undefined, b: string | null | undefined): boolean {
  const fold = (value: string | null | undefined): string => normalizeSearch(value).replace(/[?.!…\s]+/g, "");
  return fold(a) !== "" && fold(a) === fold(b);
}

/** What a board says on a shelf line / desk card: its question, else its name. */
export function boardQuestion(board: Pick<ThinkTable, "name" | "purpose">): string {
  return board.purpose !== null && board.purpose.trim() !== "" ? board.purpose : board.name;
}

/** Thirty days unopened → the line fades to half. */
export function isDusty(lastOpened: string | null, now: Date = new Date()): boolean {
  if (lastOpened === null) return false;
  return now.getTime() - new Date(lastOpened).getTime() >= 30 * 86_400_000;
}

/** `hôm nay` · `hôm qua` · `3 ngày trước` · `12/09`. */
export function openedAgo(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return "";
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(new Date(iso).toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return "hôm nay";
  if (days === 1) return "hôm qua";
  if (days < 30) return `${days} ngày trước`;
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Old `?ke=` addresses keep working: they become an arrangement (+ drawer). */
export function arrangementFromLegacy(ke: string | null): { arrangement: Arrangement; drawer: "sach" | "avora" | null } | null {
  switch (ke) {
    case "ke-sach":
      return { arrangement: "noi", drawer: "sach" };
    case "mac-dinh":
      return { arrangement: "noi", drawer: "avora" };
    case "trang-thai":
      return { arrangement: "tien-trinh", drawer: null };
    case "hoach-dinh":
    case "khac":
    case "nhat-ky":
      return { arrangement: "noi", drawer: null };
    default:
      return null;
  }
}
