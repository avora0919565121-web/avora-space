/**
 * 112-E · LOI-03 (VMT 14/10): the time zone in the profile is the ONLY source for a task's day, deadlines,
 * "hôm nay", the end of the day at 24:00 and habits — never the device clock's zone. Two devices of one
 * account therefore always see the same day. Default Asia/Ho_Chi_Minh; the last known value is kept on the
 * device so the first frame already uses it.
 */
export const DEFAULT_TIME_ZONE = "Asia/Ho_Chi_Minh";
const CACHE_KEY = "avora.tz";

function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function readCached(): string {
  try {
    const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(CACHE_KEY);
    return stored !== null && isValidZone(stored) ? stored : DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

let current: string = readCached();
const listeners = new Set<() => void>();

/** The profile's zone, as last told by the profile (or the cached copy before it loads). */
export function appTimeZone(): string {
  return current;
}

/** Called when the profile loads or changes. Unknown zones are ignored. */
export function setAppTimeZone(zone: string | null | undefined): void {
  const next = zone !== null && zone !== undefined && isValidZone(zone) ? zone : DEFAULT_TIME_ZONE;
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(CACHE_KEY, next);
  } catch {
    // Not remembered; the profile tells it again next time.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeAppTimeZone(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The device's own zone — only to notice that it differs from the profile, never to compute a day. */
export function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone !== "" ? zone : DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (found === undefined) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, found);
  }
  return found;
}

/** The wall clock in `zone` at `instant`. */
export function zonedParts(instant: Date, zone: string = current): Parts {
  const out: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(instant)) {
    if (part.type !== "literal") out[part.type] = Number.parseInt(part.value, 10);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour === 24 ? 0 : out.hour, minute: out.minute, second: out.second };
}

const pad = (value: number): string => `${value}`.padStart(2, "0");

/** The calendar day in `zone` at `instant`, `YYYY-MM-DD`. */
export function zonedDayIso(instant: Date = new Date(), zone: string = current): string {
  const p = zonedParts(instant, zone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Milliseconds `zone` is ahead of UTC at `instant`. */
function offsetMs(instant: Date, zone: string): number {
  const p = zonedParts(instant, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant a wall-clock time happens in `zone` (a time skipped by a DST jump lands just after it). */
export function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, second: number = 0, ms: number = 0, zone: string = current): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const first = guess - offsetMs(new Date(guess), zone);
  const second_ = guess - offsetMs(new Date(first), zone);
  return new Date(second_);
}

/** The next 00:00:01 of the profile's day after `now` — when "hôm nay" turns over. */
export function nextZonedMidnight(now: Date = new Date(), zone: string = current): Date {
  const p = zonedParts(now, zone);
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return zonedInstant(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), 0, 0, 1, 0, zone);
}
