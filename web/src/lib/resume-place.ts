import { isGuestMachine } from "@/lib/guest-machine";

/**
 * AVORA-93 · PHẦN 1 · 5 (ADR-059) — where the app reopens on a phone.
 *
 * On a phone AVORA is the daily tool for three things: what I owe, chat, reading. So:
 * - first open ever, or the first open of a new day (the day turns at 04:00 local) → Avora Space;
 * - away ≥ 1 hour (same day) → Kết nối › 1-1, list at the top;
 * - away < 1 hour → exactly where it was left (path + scroll; drafts are kept per conversation);
 * - opened from a notification or a link → wherever that points (beats every rule above);
 * - a computer keeps the old behaviour (each tab remembers its place, AVORA-77 · G).
 *
 * Pure: the hook in `use-resume-place.ts` feeds it the clock and storage.
 */
export const NEW_DAY_HOUR = 4;
export const AWAY_LIMIT_MS = 60 * 60 * 1000;
export const CONNECT_RESUME_PATH = "/tin-nhan?tab=1-1";

export type LeftPlace = { at: number; path: string; scroll: number };

export type ResumeDecision =
  | { kind: "keep" }
  | { kind: "home" }
  | { kind: "connect"; path: string }
  | { kind: "restore"; path: string; scroll: number };

/** The "day" a moment belongs to: before 04:00 still counts as the day before. */
export function resumeDayOf(at: number): string {
  const shifted = new Date(at - NEW_DAY_HOUR * 60 * 60 * 1000);
  const month = `${shifted.getMonth() + 1}`.padStart(2, "0");
  const day = `${shifted.getDate()}`.padStart(2, "0");
  return `${shifted.getFullYear()}-${month}-${day}`;
}

export function decideResume(input: {
  now: number;
  left: LeftPlace | null;
  isPhone: boolean;
  /** Opened from a notification or a link (not the app's own front door). */
  isExplicit: boolean;
  /** Where the app stands right now. */
  currentPath: string;
  homePath: string;
}): ResumeDecision {
  const { now, left, isPhone, isExplicit, currentPath, homePath } = input;
  if (!isPhone || isExplicit) return { kind: "keep" };
  if (left === null || resumeDayOf(left.at) !== resumeDayOf(now)) {
    return currentPath === homePath ? { kind: "keep" } : { kind: "home" };
  }
  if (now - left.at >= AWAY_LIMIT_MS) {
    return currentPath === CONNECT_RESUME_PATH ? { kind: "keep" } : { kind: "connect", path: CONNECT_RESUME_PATH };
  }
  if (left.path === currentPath) return { kind: "keep" };
  return { kind: "restore", path: left.path, scroll: left.scroll };
}

// Same prefix as tab-memory, so signing out (clearTabMemory) forgets this too.
const PREFIX = "avora.tab-memory.v1.resume";

function store(): Storage | null {
  try {
    return isGuestMachine() ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function readLeftPlace(userId: string): LeftPlace | null {
  try {
    const raw = store()?.getItem(`${PREFIX}:${userId}`);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as Partial<LeftPlace> | null;
    if (parsed === null || typeof parsed.at !== "number" || typeof parsed.path !== "string") return null;
    if (!parsed.path.startsWith("/") || parsed.path.startsWith("//")) return null;
    return { at: parsed.at, path: parsed.path, scroll: typeof parsed.scroll === "number" ? Math.max(0, parsed.scroll) : 0 };
  } catch {
    return null;
  }
}

export function writeLeftPlace(userId: string, place: LeftPlace): void {
  try {
    store()?.setItem(`${PREFIX}:${userId}`, JSON.stringify(place));
  } catch {
    // Not remembering means the next open follows the "first open" rule.
  }
}

/** Set by a notification tap that moved the app, so the resume rule steps aside for it. */
let explicitAt = 0;
export function markExplicitOpen(now: number = Date.now()): void {
  explicitAt = now;
}
export function wasExplicitOpen(now: number = Date.now()): boolean {
  return now - explicitAt < 3000;
}

/** Kết nối's strip slug for a conversation kind — where `‹` lands when there is no page behind. */
export function connectTabSlug(kind: "personal" | "direct" | "group" | "project" | string): string {
  if (kind === "personal") return "nhat-ky";
  if (kind === "group") return "nhom";
  if (kind === "project") return "du-an";
  return "1-1";
}
