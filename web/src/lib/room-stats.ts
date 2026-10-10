import type { Note } from "@/lib/notes";
import { useProfilePrefs } from "@/lib/use-default-boards";

/** AVORA-93 · PHẦN 2 (ADR-058) — helpers for kệ 2 / kệ 5 numbers (mine only, hideable). */
const RANGE_KEY = "room_stats_range";
const HIDDEN_KEY = "room_stats_hidden";
const DAY_MS = 86_400_000;
const VIEW_LABELS: Record<string, string> = {
  opportunities: "Cơ hội",
  decisions: "Quyết định",
  memorable_days: "Ngày đáng nhớ",
  my_projects: "Dự án của tôi",
  assigned_by_me: "Việc tôi giao",
  habits: "Thói quen",
  cashflow: "Dòng tiền",
  summary: "Tổng hợp",
  loans: "Khoản vay",
  payment_calendar: "Lịch thanh toán",
  expiring_docs: "Giấy tờ sắp hết hạn",
  assets: "Tài sản",
};

/** Name shown for a stat row: the board's own name, a Bảng Avora label, or the book title. */
export function statName(item: { board_key?: string; item_key?: string; name: string | null }): string {
  const key = item.board_key ?? item.item_key ?? "";
  return item.name ?? VIEW_LABELS[key] ?? "Bảng";
}

export function useStatsPrefs(): { hidden: boolean; setHidden: (next: boolean) => void; range: "today" | "week"; setRange: (next: "today" | "week") => void } {
  const { prefs, setPref } = useProfilePrefs();
  return {
    hidden: prefs[HIDDEN_KEY] === true,
    setHidden: (next) => void setPref(HIDDEN_KEY, next).catch(() => undefined),
    range: prefs[RANGE_KEY] === "today" ? "today" : "week",
    setRange: (next) => void setPref(RANGE_KEY, next).catch(() => undefined),
  };
}

/** A note's own words beyond the quoted passage (first block is the excerpt when saved from the reader). */
export function ownWords(note: Note): string {
  return note.blocks
    .slice(1)
    .map((block) => block.text.trim())
    .filter((text) => text !== "")
    .join(" ");
}

/** Kệ 5 order: pinned → with my own words → last 7 days; newest first within each. */
export function rankBookNotes(notes: readonly Note[], now: number = Date.now()): Note[] {
  const live = notes.filter((note) => note.bookRecordId !== null || note.bookTitle !== null).filter((note) => note.deletedAt === null);
  const tier = (note: Note): number => (note.pinnedAt !== null ? 0 : ownWords(note) !== "" ? 1 : now - new Date(note.createdAt).getTime() <= 7 * DAY_MS ? 2 : 3);
  return live
    .filter((note) => tier(note) < 3)
    .sort((a, b) => tier(a) - tier(b) || (tier(a) === 0 ? (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? "") : b.createdAt.localeCompare(a.createdAt)));
}

