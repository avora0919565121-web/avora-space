import { describe, expect, it } from "vitest";

import { decideDayOpen, isLinkEntry, isNewDay } from "@/lib/day-open";

const HOME = "/tong-quan";

describe("new-day landing", () => {
  it("treats a different calendar day as new, however little time passed", () => {
    expect(isNewDay("2026-09-23", "2026-09-24")).toBe(true);
    expect(isNewDay("2026-09-24", "2026-09-24")).toBe(false);
  });

  it("treats someone never recorded as opening on a new day", () => {
    expect(isNewDay(null, "2026-09-24")).toBe(true);
  });

  it("sends a new-day open to Avora Space from any screen", () => {
    expect(decideDayOpen("2026-09-23", "2026-09-24", "/tin-nhan/abc", HOME)).toBe("go-home");
    expect(decideDayOpen("2026-09-23", "2026-09-24", "/nhiem-vu", HOME)).toBe("go-home");
  });

  it("leaves a same-day return exactly where it was", () => {
    expect(decideDayOpen("2026-09-24", "2026-09-24", "/tin-nhan/abc", HOME)).toBe("stay");
  });

  it("records without navigating when already on Avora Space", () => {
    expect(decideDayOpen("2026-09-23", "2026-09-24", HOME, HOME)).toBe("record-only");
  });

  it("honours an invite link opened on a new day", () => {
    expect(isLinkEntry("/loi-moi/tok")).toBe(true);
    expect(isLinkEntry("/loi-moi-lien-he/tok")).toBe(true);
    expect(isLinkEntry("/tin-nhan")).toBe(false);
    expect(decideDayOpen(null, "2026-09-24", "/loi-moi/tok", HOME)).toBe("record-only");
  });
});
