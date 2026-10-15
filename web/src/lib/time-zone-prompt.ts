/**
 * 112-E · VMT 14/10: when the device's zone differs from the profile's, ask ONCE "Đổi múi giờ hồ sơ sang … ?"
 * (Đổi / Giữ) — never change it by itself. "Giữ" is remembered for that device zone until the device zone
 * changes again.
 */
const KEEP_PREFIX = "avora.tz-keep";

export function keptZone(userId: string): string | null {
  try {
    return localStorage.getItem(`${KEEP_PREFIX}:${userId}`);
  } catch {
    return null;
  }
}

export function rememberKeep(userId: string, deviceZone: string): void {
  try {
    localStorage.setItem(`${KEEP_PREFIX}:${userId}`, deviceZone);
  } catch {
    // Asked again next start; never changed silently.
  }
}

/**
 * Two zone names that keep the same clock all year (Asia/Saigon = Asia/Ho_Chi_Minh — iPhones in Vietnam
 * often report the old name) give the same days, so they are not a reason to ask.
 */
export function sameClock(a: string, b: string, year: number = new Date().getUTCFullYear()): boolean {
  if (a === b) return true;
  try {
    const samples = [0, 3, 6, 9].map((month) => new Date(Date.UTC(year, month, 15, 12)));
    const fmt = (zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", day: "2-digit" });
    const fa = fmt(a);
    const fb = fmt(b);
    return samples.every((at) => fa.format(at) === fb.format(at));
  } catch {
    return false;
  }
}

/** Whether to ask now. */
export function shouldAskZone(input: { profileZone: string; deviceZone: string; kept: string | null }): boolean {
  if (sameClock(input.profileZone, input.deviceZone)) return false;
  return input.kept !== input.deviceZone;
}

/** A zone name people read ("Việt Nam (GMT+7)", or the raw id when not in the short list). */
export function zoneLabel(zone: string, options: readonly { value: string; label: string }[]): string {
  return options.find((option) => option.value === zone)?.label ?? zone.replace(/_/g, " ");
}
