import { describe, expect, it } from "vitest";

import { isRestDay, localDay, msUntilMidnight, REST_INNER_LABEL, REST_INNER_SCOPES, REST_TONE } from "@/lib/rest-day";
import { AA, TONE_IDS, tonePairs } from "@/lib/theme";

/** A Date whose *local* fields read as given, whatever zone the test machine is in. */
const local = (y: number, m: number, d: number, h = 12, min = 0): Date => new Date(y, m - 1, d, h, min);

describe("AVORA-110 · Ngày nghỉ (pure)", () => {
  it("Chủ nhật is the default rest day; a chosen day replaces it", () => {
    expect(isRestDay(local(2026, 10, 11), { restWeekday: 0, restSaturday: false })).toBe(true); // Sunday
    expect(isRestDay(local(2026, 10, 12), { restWeekday: 0, restSaturday: false })).toBe(false); // Monday
    expect(isRestDay(local(2026, 10, 14), { restWeekday: 3, restSaturday: false })).toBe(true); // Wednesday chosen
    expect(isRestDay(local(2026, 10, 11), { restWeekday: 3, restSaturday: false })).toBe(false); // Sunday not added
  });

  it("Thứ Bảy is added only when switched on", () => {
    expect(isRestDay(local(2026, 10, 10), { restWeekday: 0, restSaturday: false })).toBe(false);
    expect(isRestDay(local(2026, 10, 10), { restWeekday: 0, restSaturday: true })).toBe(true);
  });

  it("the weekend across midnight: Saturday 23:59 → Sunday 00:00 → Monday 00:00", () => {
    const prefs = { restWeekday: 0, restSaturday: false };
    expect(isRestDay(local(2026, 10, 10, 23, 59), prefs)).toBe(false);
    expect(isRestDay(local(2026, 10, 11, 0, 0), prefs)).toBe(true);
    expect(isRestDay(local(2026, 10, 11, 23, 59), prefs)).toBe(true);
    expect(isRestDay(local(2026, 10, 12, 0, 0), prefs)).toBe(false);
    expect(msUntilMidnight(local(2026, 10, 11, 23, 59))).toBe(60_000);
  });

  it("uses the device's day, not UTC: the same instant is Sunday in UTC+7 and Saturday in UTC−8", () => {
    // 2026-10-11T02:00Z = Sun 09:00 in Hà Nội (UTC+7), Sat 19:00 in Los Angeles (UTC−8 standard).
    const instant = Date.parse("2026-10-11T02:00:00Z");
    const asZone = (offsetHours: number): Date => {
      const shifted = new Date(instant + offsetHours * 3_600_000);
      return local(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), shifted.getUTCHours(), shifted.getUTCMinutes());
    };
    const prefs = { restWeekday: 0, restSaturday: false };
    expect(isRestDay(asZone(7), prefs)).toBe(true);
    expect(isRestDay(asZone(-8), prefs)).toBe(false);
    expect(isRestDay(asZone(-8), { restWeekday: 0, restSaturday: true })).toBe(true);
    expect(localDay(asZone(7))).toBe("2026-10-11");
    expect(localDay(asZone(-8))).toBe("2026-10-10");
  });

  it("the rest tone `nghi` passes AA on both canvases, and is not a choosable tone", () => {
    for (const canvas of ["light", "dark"] as const) {
      for (const pair of tonePairs(REST_TONE[canvas], canvas)) expect([canvas, pair.name, pair.ratio >= AA]).toEqual([canvas, pair.name, true]);
    }
    expect((TONE_IDS as readonly string[]).includes("nghi")).toBe(false);
  });

  it("exactly five inward places", () => {
    expect([...REST_INNER_SCOPES]).toEqual(["reading", "direct-chat", "daily-thought", "journal", "notes"]);
    expect(Object.values(REST_INNER_LABEL)).toEqual(["Đọc sách", "Trò chuyện 1-1", "Suy gẫm hằng ngày", "Nhật ký của tôi", "Ghi chép"]);
  });
});
