import { describe, expect, it } from "vitest";

import { AWAY_LIMIT_MS, CONNECT_RESUME_PATH, connectTabSlug, decideResume, resumeDayOf } from "@/lib/resume-place";

const HOME = "/tong-quan";
const at = (day: number, hour: number, minute = 0): number => new Date(2026, 9, day, hour, minute).getTime();
const base = { isPhone: true, isExplicit: false, currentPath: "/tin-nhan/abc", homePath: HOME };

describe("91.10 · resume-place", () => {
  it("first open ever → Avora Space", () => {
    expect(decideResume({ ...base, now: at(4, 9), left: null })).toEqual({ kind: "home" });
  });

  it("new day turns at 04:00: 03:59 is still yesterday, 04:01 is a new day", () => {
    const left = { at: at(3, 23, 30), path: "/tin-nhan/abc", scroll: 0 };
    expect(resumeDayOf(at(4, 3, 59))).toBe(resumeDayOf(at(3, 23, 30)));
    expect(decideResume({ ...base, now: at(4, 3, 59), left: { ...left, at: at(4, 3, 30) } }).kind).toBe("keep");
    expect(decideResume({ ...base, now: at(4, 4, 1), left: { ...left, at: at(4, 3, 50) } })).toEqual({ kind: "home" });
  });

  it("away 59 minutes → the same place, with its scroll", () => {
    const left = { at: at(4, 10, 0), path: "/ke-hoach?ke=3", scroll: 420 };
    expect(decideResume({ ...base, currentPath: "/tin-nhan", now: at(4, 10, 59), left })).toEqual({ kind: "restore", path: "/ke-hoach?ke=3", scroll: 420 });
  });

  it("away 61 minutes → Kết nối › 1-1", () => {
    const left = { at: at(4, 10, 0), path: "/ke-hoach?ke=3", scroll: 0 };
    expect(decideResume({ ...base, now: at(4, 10, 0) + AWAY_LIMIT_MS + 60_000, left })).toEqual({ kind: "connect", path: CONNECT_RESUME_PATH });
  });

  it("opened from a notification → wherever it points", () => {
    expect(decideResume({ ...base, isExplicit: true, now: at(5, 9), left: null })).toEqual({ kind: "keep" });
  });

  it("a computer keeps the old behaviour", () => {
    expect(decideResume({ ...base, isPhone: false, now: at(5, 9), left: null })).toEqual({ kind: "keep" });
  });

  it("91.13 · ‹ with nothing behind lands on the conversation's own section", () => {
    expect(connectTabSlug("group")).toBe("nhom");
    expect(connectTabSlug("direct")).toBe("1-1");
    expect(connectTabSlug("project")).toBe("du-an");
    expect(connectTabSlug("personal")).toBe("nhat-ky");
  });
});
