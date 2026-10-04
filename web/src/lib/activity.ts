/**
 * AVORA-93 · PHẦN 2 (ADR-058) — pure helpers for the activity meter. Only time the page was
 * visible AND touched within the last 2 minutes counts; nothing here leaves the device except
 * through `log_activity` (kind, key, day, seconds).
 */
export const ACTIVITY_FLUSH_MS = 60_000;
export const IDLE_AFTER_MS = 2 * 60_000;
export const MAX_SECONDS_PER_CALL = 120;

export type ActivityKind = "board" | "book";

/** Seconds that count between two ticks: visible and touched recently, capped by the idle window. */
export function countableMs(input: { from: number; to: number; lastInteraction: number; isVisible: boolean }): number {
  const { from, to, lastInteraction, isVisible } = input;
  if (!isVisible || to <= from) return 0;
  const activeUntil = Math.min(to, lastInteraction + IDLE_AFTER_MS);
  return Math.max(0, activeUntil - Math.max(from, Math.min(lastInteraction, to)));
}

/** The device's own day (`YYYY-MM-DD`), which the server accepts within ± 1 day. */
export function localDay(at: number = Date.now()): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

/** `48 phút`, `1 giờ 10 phút`, `3 giờ 5 phút`, `0 phút`. */
export function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} giờ` : `${hours} giờ ${rest} phút`;
}

/** Splits a pending pile of seconds into ≤ 120 s calls (the server's clamp). */
export function chunkSeconds(total: number): number[] {
  const out: number[] = [];
  let left = Math.max(0, Math.floor(total));
  while (left > 0) {
    const part = Math.min(MAX_SECONDS_PER_CALL, left);
    out.push(part);
    left -= part;
  }
  return out;
}

/** Monday-first week of `today` (T2 … CN) as `YYYY-MM-DD`. */
export function weekDays(today: string): string[] {
  const date = new Date(`${today}T12:00:00`);
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return localDay(day.getTime());
  });
}

const VAULT_BOARDS: ReadonlySet<string> = new Set(["cashflow", "loans", "payment_calendar", "expiring_docs", "assets"]);

/** Két sắt boards count only that they were opened (ADR-034). */
export function countsTime(kind: ActivityKind, key: string): boolean {
  return !(kind === "board" && VAULT_BOARDS.has(key));
}
