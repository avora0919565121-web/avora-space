import type { ToneSet } from "@/lib/theme";

/**
 * AVORA-110 — Ngày nghỉ: on a rest day the whole app's accents turn one calm, shared tone; only
 * the inward-facing places keep the person's own colours. Private: only this device's colours
 * change, nothing is blocked, no counts, no streaks, no push. The label is only `Ngày nghỉ`.
 */

/** The tone of a rest day — one for everybody. Not a `FixedTone`: it never appears in the picker. */
export type RestTone = "nghi";

const hsl = (h: number, s: number, l: number) => ({ h, s, l });

/** Sage / muted teal. Every pair is held at AA (4.5:1) on both canvases in rest-day.test.ts. */
export const REST_TONE: ToneSet = {
  light: { personal: hsl(168, 24, 30), personalFg: hsl(15, 100, 97), soft: hsl(168, 20, 92), softFg: hsl(168, 26, 26) },
  dark: { personal: hsl(168, 22, 66), personalFg: hsl(30, 10, 8), soft: hsl(168, 14, 19), softFg: hsl(168, 24, 76) },
};

/**
 * The inward places that keep their own colours (VMT 09/10 + 09/10 20:57). One list, so a place is
 * added or removed with one line; each screen marks itself with `useRestScope(<id>)`.
 */
export const REST_INNER_SCOPES = ["reading", "direct-chat", "daily-thought", "journal", "notes"] as const;
export type RestInnerScope = (typeof REST_INNER_SCOPES)[number];

export const REST_INNER_LABEL: Readonly<Record<RestInnerScope, string>> = {
  reading: "Đọc sách",
  "direct-chat": "Trò chuyện 1-1",
  "daily-thought": "Suy gẫm hằng ngày",
  journal: "Nhật ký của tôi",
  notes: "Ghi chép",
};

export type RestPrefs = { restWeekday: number; restSaturday: boolean };

/** Whether `now` (the device's own day, 00:00 → 24:00) is a rest day. */
export function isRestDay(now: Date, prefs: RestPrefs): boolean {
  const day = now.getDay();
  const chosen = ((prefs.restWeekday % 7) + 7) % 7;
  return day === chosen || (prefs.restSaturday && day === 6);
}

/** Milliseconds to the device's next midnight — when the rest colours may need to change. */
export function msUntilMidnight(now: Date): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

/** A local `YYYY-MM-DD` for "hidden until the end of that day". */
export function localDay(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Cached so index.html can paint the rest colours before React starts (no flash at launch). */
export const REST_CACHE_KEY = "avora.rest";
const CARD_HIDDEN_KEY = "avora.rest-card-hidden";

export function cacheRestPrefs(prefs: RestPrefs & { enabled: boolean }): void {
  try {
    window.localStorage.setItem(REST_CACHE_KEY, JSON.stringify(prefs));
  } catch {
    // No storage: the first frame shows the usual colours, then the rest tone.
  }
}

export function isRestCardHidden(now: Date): boolean {
  try {
    return window.localStorage.getItem(CARD_HIDDEN_KEY) === localDay(now);
  } catch {
    return false;
  }
}

export function hideRestCard(now: Date): void {
  try {
    window.localStorage.setItem(CARD_HIDDEN_KEY, localDay(now));
  } catch {
    // Harmless: the card comes back next visit.
  }
}
