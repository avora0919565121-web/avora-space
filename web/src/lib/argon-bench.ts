/**
 * S7 (VMT 02/10) — the two Argon2id costs measured on real devices before the vault KDF is
 * chosen. Pure helpers here; the page lives in `pages/ArgonBench.tsx`.
 */

export type ArgonProfile = "64m3" | "32m4";

export interface ArgonCost {
  readonly profile: ArgonProfile;
  readonly memoryKiB: number;
  readonly iterations: number;
  readonly label: string;
}

export const ARGON_COSTS: readonly ArgonCost[] = [
  { profile: "64m3", memoryKiB: 65536, iterations: 3, label: "64 MB · 3 vòng" },
  { profile: "32m4", memoryKiB: 32768, iterations: 4, label: "32 MB · 4 vòng" },
];

export type DeviceKind = "iphone" | "ipad" | "android" | "mac" | "windows" | "linux" | "other";

/** Coarse device kind from the user agent — only what the bench table keeps. */
export function deviceKindOf(ua: string, maxTouchPoints: number): DeviceKind {
  if (/iPhone|iPod/i.test(ua)) return "iphone";
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) return "ipad";
  if (/Android/i.test(ua)) return "android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux/i.test(ua)) return "linux";
  return "other";
}

/** Browser family only, never a version string that could fingerprint someone. */
export function browserOf(ua: string): string {
  if (/EdgiOS|Edg\//i.test(ua)) return "Edge";
  if (/CriOS|Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return "Chrome";
  if (/FxiOS|Firefox\//i.test(ua)) return "Firefox";
  if (/Safari\//i.test(ua)) return "Safari";
  return "Khác";
}

/** Median of a small sample; null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
