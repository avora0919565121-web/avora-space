import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { chunkSeconds, countableMs, countsTime, formatMinutes, weekDays } from "@/lib/activity";
import { policyShortTitle } from "@/lib/policy-content";
import { readerZone, sentenceAround } from "@/lib/reader-settings";
import { rankBookNotes } from "@/lib/room-stats";
import { normalizeRoomStats } from "@/lib/use-activity";
import type { Note } from "@/lib/notes";

const zone = (x: number, y: number, isPaged = true) => readerZone({ x, y, width: 390, height: 844, safeTop: 47, isPaged });

describe("93.1 / 93.7 · reader zones", () => {
  it("splits exactly in the middle, ±10 px either side", () => {
    expect(zone(185, 400)).toBe("back");
    expect(zone(205, 400)).toBe("forward");
  });
  it("top band under the notch = tools, bottom band = tabs", () => {
    expect(zone(200, 47 + 70)).toBe("tools");
    expect(zone(100, 47 + 80)).toBe("back");
    expect(zone(200, 844 - 90)).toBe("tabs");
  });
  it("continuous scroll: halves do nothing, bands still work", () => {
    expect(zone(20, 400, false)).toBe("none");
    expect(zone(20, 60, false)).toBe("tools");
    expect(zone(20, 830, false)).toBe("tabs");
  });
});

describe("90.2 / 90.9 · only visible, recently touched time counts", () => {
  const t0 = 1_000_000;
  it("idle beyond 2 minutes stops counting", () => {
    expect(countableMs({ from: t0, to: t0 + 5 * 60_000, lastInteraction: t0, isVisible: true })).toBe(2 * 60_000);
  });
  it("a hidden tab counts nothing", () => {
    expect(countableMs({ from: t0, to: t0 + 60_000, lastInteraction: t0 + 30_000, isVisible: false })).toBe(0);
  });
  it("a page turn mid-way keeps the clock running", () => {
    expect(countableMs({ from: t0, to: t0 + 60_000, lastInteraction: t0 + 50_000, isVisible: true })).toBe(10_000);
  });
  it("chunks ≤ 120 s, Két sắt boards count no time, minutes read in Vietnamese", () => {
    expect(chunkSeconds(300)).toEqual([120, 120, 60]);
    expect(countsTime("board", "cashflow")).toBe(false);
    expect(countsTime("board", "decisions")).toBe(true);
    expect([formatMinutes(48 * 60), formatMinutes(70 * 60), formatMinutes(185 * 60)]).toEqual(["48 phút", "1 giờ 10 phút", "3 giờ 5 phút"]);
    expect(weekDays("2026-10-04")[0]).toBe("2026-09-28");
  });
});

describe("90.10 · book notes order: pinned → my own words → last 7 days", () => {
  const note = (id: string, extra: Partial<Note>): Note => ({
    id, folderId: null, title: "", blocks: [{ id: "b1", level: null, text: "“trích”" }], tags: [], pinnedAt: null,
    bookRecordId: "r1", bookTitle: "Sách", deletedAt: null, createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z", ...extra,
  });
  it("orders and drops old quote-only notes", () => {
    const now = new Date("2026-10-04T12:00:00Z").getTime();
    const ranked = rankBookNotes([
      note("quote", {}),
      note("mine", { blocks: [{ id: "a", level: null, text: "“trích”" }, { id: "b", level: null, text: "Ý của tôi" }] }),
      note("pinned", { pinnedAt: "2026-10-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" }),
      note("old", { createdAt: "2026-01-01T00:00:00Z" }),
    ], now);
    expect(ranked.map((item) => item.id)).toEqual(["pinned", "mine", "quote"]);
  });
});

describe("misc · AVORA-93", () => {
  it("a single word is looked up with its sentence", () => {
    expect(sentenceAround("It was cold. A melancholy wind blew. Then rain.", "melancholy")).toBe("A melancholy wind blew.");
  });
  it("policy chip on a phone: Điều khoản", () => {
    expect(policyShortTitle("Điều khoản sử dụng — giai đoạn thử nghiệm")).toBe("Điều khoản");
  });
  it("room stats read defensively", () => {
    expect(normalizeRoomStats(null).viewed).toEqual([]);
    expect(normalizeRoomStats({ boards_by_status: { thinking: 2 } }).boards_by_status).toEqual({ waiting: 0, thinking: 2, concluded: 0 });
  });
});
