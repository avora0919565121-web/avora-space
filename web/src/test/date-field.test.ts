import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { hasExternalLayer, layerMarkStyle, orderDayEntries, toCalendarEntry } from "@/lib/calendar-layers";
import {
  dateFieldLabel,
  isDayAllowed,
  joinLocalDateTime,
  orderRange,
  parseMinute,
  pickHint,
  quickRanges,
  splitLocalDateTime,
  yearChoices,
} from "@/lib/date-field";

const TODAY = "2026-09-27";

describe("dateFieldLabel", () => {
  it("says today and tomorrow in words, other days with weekday and full date", () => {
    expect(dateFieldLabel("2026-09-27", TODAY)).toBe("Hôm nay · 27/09");
    expect(dateFieldLabel("2026-09-28", TODAY)).toBe("Ngày mai · 28/09");
    expect(dateFieldLabel("2026-09-30", TODAY)).toBe("Thứ Tư, 30/09/2026");
    expect(dateFieldLabel("", TODAY)).toBe("");
    expect(dateFieldLabel("2026-02-30", TODAY)).toBe("");
  });
});

describe("isDayAllowed — allow / min / max", () => {
  it("future refuses the past, past refuses the future, any takes both", () => {
    expect(isDayAllowed("2026-09-26", { allow: "future", today: TODAY })).toBe(false);
    expect(isDayAllowed("2026-09-27", { allow: "future", today: TODAY })).toBe(true);
    expect(isDayAllowed("2026-09-28", { allow: "past", today: TODAY })).toBe(false);
    expect(isDayAllowed("1965-04-12", { allow: "past", today: TODAY })).toBe(true);
    expect(isDayAllowed("2026-09-20", { allow: "any", today: TODAY })).toBe(true);
  });

  it("min and max are inclusive and stack on top of allow", () => {
    const rule = { allow: "any" as const, today: TODAY, min: "2026-09-10", max: "2026-09-27" };
    expect(isDayAllowed("2026-09-09", rule)).toBe(false);
    expect(isDayAllowed("2026-09-10", rule)).toBe(true);
    expect(isDayAllowed("2026-09-27", rule)).toBe(true);
    expect(isDayAllowed("2026-09-28", rule)).toBe(false);
  });

  it("says 'từ hôm nay trở đi' only when that is the rule", () => {
    expect(pickHint("future", null)).toContain("từ hôm nay trở đi");
    expect(pickHint("any", null)).not.toContain("từ hôm nay");
    expect(pickHint("past", null)).not.toContain("từ hôm nay");
  });
});

describe("ranges", () => {
  it("swaps a range picked backwards", () => {
    expect(orderRange("2026-09-30", "2026-09-10")).toEqual({ from: "2026-09-10", to: "2026-09-30" });
    expect(orderRange("2026-09-10", "2026-09-30")).toEqual({ from: "2026-09-10", to: "2026-09-30" });
  });

  it("works out Tháng này · Tháng trước · Quý này · Năm nay", () => {
    expect(quickRanges(TODAY).map((range) => [range.label, range.from, range.to])).toEqual([
      ["Tháng này", "2026-09-01", "2026-09-30"],
      ["Tháng trước", "2026-08-01", "2026-08-31"],
      ["Quý này", "2026-07-01", "2026-09-30"],
      ["Năm nay", "2026-01-01", "2026-12-31"],
    ]);
  });

  it("offers far enough back for a birthday", () => {
    const years = yearChoices("past", TODAY, TODAY);
    expect(years[0]).toBe(1900);
    expect(years[years.length - 1]).toBe(2026);
    expect(years).toContain(1965);
    expect(yearChoices("future", TODAY, TODAY)[0]).toBe(2026);
  });
});

describe("DateTimeField conversion", () => {
  it("round-trips the datetime-local string the forms already store", () => {
    expect(splitLocalDateTime("2026-09-30T14:35")).toEqual({ date: "2026-09-30", time: "14:35" });
    expect(joinLocalDateTime("2026-09-30", "14:35")).toBe("2026-09-30T14:35");
    const stored = "2026-10-01T08:05";
    const { date, time } = splitLocalDateTime(stored);
    expect(joinLocalDateTime(date, time)).toBe(stored);
  });

  it("no date means no value; a date before any time takes the fallback", () => {
    expect(joinLocalDateTime("", "14:00")).toBe("");
    expect(joinLocalDateTime("2026-09-30", "")).toBe("2026-09-30T09:00");
    expect(splitLocalDateTime("")).toEqual({ date: "", time: "" });
    expect(splitLocalDateTime("rubbish")).toEqual({ date: "", time: "" });
  });

  it("'Phút khác' accepts 0–59 only; anything else keeps the old value", () => {
    expect(parseMinute("37")).toBe(37);
    expect(parseMinute("0")).toBe(0);
    expect(parseMinute("60")).toBeNull();
    expect(parseMinute("3a")).toBeNull();
    expect(parseMinute("")).toBeNull();
    // 14 → "Phút khác" → 37 is stored as 14:37, never AM/PM.
    expect(joinLocalDateTime("2026-09-30", `14:${String(parseMinute("37")).padStart(2, "0")}`)).toBe("2026-09-30T14:37");
  });
});

describe("Calendar layers (A4)", () => {
  const avoraEvent = toCalendarEntry({ layer: "avora" }, { id: "t1", title: "Họp khách", day: TODAY, startTime: "14:00", avoraKind: "event" });
  const avoraDeadline = toCalendarEntry({ layer: "avora" }, { id: "t2", title: "Nộp báo cáo", day: TODAY });
  const outsideEarly = toCalendarEntry({ layer: "external", name: "Gia đình" }, { id: "e1", title: "Đón con", day: TODAY, startTime: "07:00", location: "Trường" });
  const outsideWork = toCalendarEntry({ layer: "external", name: "Công việc" }, { id: "e2", title: "", day: TODAY, url: "https://meet.example" });

  it("maps every source into one shape", () => {
    expect(outsideEarly).toMatchObject({ layer: "external", sourceName: "Gia đình", where: "Trường", avoraKind: null });
    expect(outsideWork.title).toBe("(Không có tiêu đề)");
    expect(outsideWork.where).toBe("https://meet.example");
    expect(avoraDeadline).toMatchObject({ layer: "avora", sourceName: "Avora", avoraKind: "deadline" });
  });

  it("lists Avora first, outside calendars after — even when those start earlier", () => {
    const ordered = orderDayEntries([outsideEarly, avoraEvent, outsideWork, avoraDeadline]);
    expect(ordered.map((entry) => entry.layer)).toEqual(["avora", "avora", "external", "external"]);
  });

  it("draws every outside calendar in the same faint neutral style, under Avora", () => {
    const a = layerMarkStyle(outsideEarly);
    const b = layerMarkStyle(outsideWork);
    expect(a).toEqual(b);
    expect(a.opacity).toBeLessThan(layerMarkStyle(avoraEvent).opacity);
    expect(a.z).toBeLessThan(layerMarkStyle(avoraDeadline).z);
    expect(hasExternalLayer([avoraEvent])).toBe(false);
    expect(hasExternalLayer([avoraEvent, outsideWork])).toBe(true);
  });
});

/** Lock: no browser date or time control anywhere in the app (AVORA-39 / Phần 2 · B). */
describe("no native date/time inputs", () => {
  const root = path.resolve(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (full !== path.join(root, "test")) walk(full);
      } else if (/\.(tsx?|jsx?)$/.test(name)) files.push(full);
    }
  };
  walk(root);

  it("finds zero type=date / datetime-local / time", () => {
    const pattern = /type=["'](date|datetime-local|time)["']/;
    const offenders = files.filter((file) => pattern.test(readFileSync(file, "utf8"))).map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });
});
