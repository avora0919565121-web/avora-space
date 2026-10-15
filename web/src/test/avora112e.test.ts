import { describe, expect, test } from "vitest";

import { nextZonedMidnight, zonedDayIso, zonedInstant, zonedParts } from "@/lib/app-time-zone";
import { shouldAskZone, zoneLabel } from "@/lib/time-zone-prompt";

describe("112-E · múi giờ hồ sơ", () => {
  test("ngày theo múi giờ, không theo giờ máy", () => {
    const at = new Date("2026-10-13T17:00:00Z"); // 14/10 00:00 VN · 13/10 10:00 LA
    expect(zonedDayIso(at, "Asia/Ho_Chi_Minh")).toBe("2026-10-14");
    expect(zonedDayIso(at, "America/Los_Angeles")).toBe("2026-10-13");
  });

  test("giờ tường → thời điểm, kể cả quanh đổi giờ mùa hè", () => {
    expect(zonedInstant(2026, 10, 13, 23, 59, 59, 999, "Asia/Ho_Chi_Minh").toISOString()).toBe("2026-10-13T16:59:59.999Z");
    // Paris: 25/10/2026 03:00 CEST → 02:00 CET. 12:00 that day is UTC+1.
    expect(zonedInstant(2026, 10, 25, 12, 0, 0, 0, "Europe/Paris").toISOString()).toBe("2026-10-25T11:00:00.000Z");
    expect(zonedParts(zonedInstant(2026, 3, 29, 9, 30, 0, 0, "Europe/Paris"), "Europe/Paris")).toMatchObject({ hour: 9, minute: 30 });
  });

  test("hết ngày: nửa đêm kế tiếp của hồ sơ", () => {
    expect(nextZonedMidnight(new Date("2026-10-13T16:30:00Z"), "Asia/Ho_Chi_Minh").toISOString()).toBe("2026-10-13T17:00:01.000Z");
    expect(nextZonedMidnight(new Date("2026-10-13T17:30:00Z"), "Asia/Ho_Chi_Minh").toISOString()).toBe("2026-10-14T17:00:01.000Z");
  });

  test("máy khác múi giờ hồ sơ: hỏi một lần; Giữ được nhớ tới khi máy đổi múi giờ lần nữa", () => {
    expect(shouldAskZone({ profileZone: "Asia/Ho_Chi_Minh", deviceZone: "Asia/Ho_Chi_Minh", kept: null })).toBe(false);
    // Tên cũ của cùng múi giờ (iPhone ở Việt Nam hay báo Asia/Saigon) không phải lý do để hỏi.
    expect(shouldAskZone({ profileZone: "Asia/Ho_Chi_Minh", deviceZone: "Asia/Saigon", kept: null })).toBe(false);
    expect(shouldAskZone({ profileZone: "Asia/Ho_Chi_Minh", deviceZone: "Europe/Paris", kept: null })).toBe(true);
    expect(shouldAskZone({ profileZone: "Asia/Ho_Chi_Minh", deviceZone: "Europe/Paris", kept: "Europe/Paris" })).toBe(false);
    expect(shouldAskZone({ profileZone: "Asia/Ho_Chi_Minh", deviceZone: "Asia/Tokyo", kept: "Europe/Paris" })).toBe(true);
    expect(zoneLabel("America/New_York", [{ value: "America/New_York", label: "New York (GMT-5)" }])).toBe("New York (GMT-5)");
    expect(zoneLabel("America/Argentina/Buenos_Aires", [])).toBe("America/Argentina/Buenos Aires");
  });
});

import { elapsedMs, isExpired, markAway, recordedSeconds, startSession, stopSession } from "@/lib/habit-timer";

describe("112-E · đồng hồ thói quen theo thời điểm tích luỹ (đồng hồ giả)", () => {
  const t0 = Date.parse("2026-10-14T01:00:00Z");
  const start = (whenAway: "keep" | "stop") =>
    startSession({ habitId: "h", habitName: "Đọc", windowIndex: 0, windowTime: "08:00", localDate: "2026-10-14", targetMinutes: 30, whenAway }, t0);

  test("khoá máy 10 phút (không có nhịp nào chạy): mở lại thấy đúng 10:00, lệch ≤ 2 giây", () => {
    const session = start("keep");
    const away = markAway(session, t0 + 1_000);
    const drift = Math.abs(elapsedMs(away, t0 + 600_000) - 600_000);
    expect(drift).toBeLessThanOrEqual(2_000);
  });

  test("chuyển app với 'Dừng khi rời': thời gian dừng đúng lúc rời, không cộng thời gian vắng", () => {
    const stopped = stopSession(start("stop"), t0 + 120_000, "left");
    expect(elapsedMs(stopped, t0 + 3_600_000)).toBe(120_000);
    expect(recordedSeconds(stopped, t0 + 3_600_000)).toBe(120);
  });

  test("qua 24:00 của ngày hồ sơ: phiên tự huỷ (không ghi)", () => {
    expect(isExpired(start("keep"), "2026-10-15")).toBe(true);
    expect(isExpired(start("keep"), "2026-10-14")).toBe(false);
  });
});
