import { describe, expect, it } from "vitest";

import {
  DANH_NGON,
  DAILY_THOUGHT_OPTIONS,
  dailyStride,
  dailyThoughtView,
  dayNumber,
  isDailyThoughtCategory,
  KINH_THANH,
  pickDailyThought,
  thoughtPool,
  type DailyThoughtCategory,
} from "@/lib/daily-thoughts";

/** Local noon on a given day: far from both midnights, so no timezone can shift the date. */
function noon(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0);
}

describe("the lists themselves", () => {
  it("holds exactly the 30 scripture lines and 20 maxims that were given", () => {
    expect(KINH_THANH).toHaveLength(30);
    expect(DANH_NGON).toHaveLength(20);
  });

  it("keeps the wording verbatim", () => {
    expect(KINH_THANH[0].text).toBe(
      "Yêu Đức Chúa Trời hết lòng, hết linh hồn, hết trí khôn — và yêu người lân cận như chính mình.",
    );
    expect(KINH_THANH[29].text).toBe(
      "Đức Giê-hô-va đã ban cho, Đức Giê-hô-va lại cất đi; đáng chúc tụng danh Đức Giê-hô-va.",
    );
    expect(DANH_NGON[0].text).toBe("Một ngày sống tử tế là một ngày không phí hoài.");
    expect(DANH_NGON[19].text).toBe(
      "Thành thật với chính mình là bước đầu để sống một cuộc đời ngay thẳng.",
    );
  });

  it("has no blank or duplicated lines", () => {
    for (const thought of [...KINH_THANH, ...DANH_NGON]) {
      expect(thought.text.trim().length).toBeGreaterThan(0);
    }
    const all = [...KINH_THANH, ...DANH_NGON].map((thought) => thought.text);
    expect(new Set(all).size).toBe(all.length);
  });

  it("names a speaker for every scripture line and none for any maxim", () => {
    for (const thought of KINH_THANH) {
      expect(thought.speaker).not.toBeNull();
      expect((thought.speaker ?? "").trim().length).toBeGreaterThan(0);
    }
    for (const thought of DANH_NGON) {
      expect(thought.speaker).toBeNull();
    }
  });

  it("offers the three choices the settings screen needs", () => {
    expect(DAILY_THOUGHT_OPTIONS.map((option) => option.value)).toEqual([
      "khong_chon",
      "kinh_thanh",
      "danh_ngon",
    ]);
    expect(isDailyThoughtCategory("kinh_thanh")).toBe(true);
    expect(isDailyThoughtCategory("danh_ngon")).toBe(true);
    expect(isDailyThoughtCategory("khong_chon")).toBe(true);
    expect(isDailyThoughtCategory("bible")).toBe(false);
  });
});

describe("choosing the day's line", () => {
  it("shows nothing when the reader chose not to", () => {
    expect(pickDailyThought("khong_chon", noon(2026, 9, 11))).toBeNull();
    expect(dailyThoughtView("khong_chon", noon(2026, 9, 11))).toBeNull();
    expect(thoughtPool("khong_chon")).toHaveLength(0);
  });

  it("gives the same line however many times the app is opened that day", () => {
    const morning = new Date(2026, 8, 11, 6, 30, 0);
    const afternoon = new Date(2026, 8, 11, 14, 5, 0);
    const night = new Date(2026, 8, 11, 23, 45, 0);

    for (const category of ["kinh_thanh", "danh_ngon"] as DailyThoughtCategory[]) {
      const first = pickDailyThought(category, morning);
      expect(pickDailyThought(category, afternoon)).toBe(first);
      expect(pickDailyThought(category, night)).toBe(first);
    }
  });

  it("never repeats yesterday's line today", () => {
    for (const category of ["kinh_thanh", "danh_ngon"] as DailyThoughtCategory[]) {
      const start = noon(2026, 1, 1);
      let previous = pickDailyThought(category, start);
      for (let offset = 1; offset < 400; offset += 1) {
        const day = new Date(2026, 0, 1 + offset, 12, 0, 0);
        const current = pickDailyThought(category, day);
        expect(current).not.toBe(previous);
        previous = current;
      }
    }
  });

  it("covers the whole list in ANY run of that many days, wherever it starts", () => {
    for (const category of ["kinh_thanh", "danh_ngon"] as DailyThoughtCategory[]) {
      const size = thoughtPool(category).length;
      // Not just windows aligned to some epoch — every possible starting day must work, which
      // is what stops a line being skipped for months or shown twice in a fortnight.
      for (let start = 0; start < 90; start += 1) {
        const seen = new Set<string>();
        for (let step = 0; step < size; step += 1) {
          const day = new Date(2026, 0, 1 + start + step, 12, 0, 0);
          const thought = pickDailyThought(category, day);
          expect(thought).not.toBeNull();
          seen.add(thought?.text ?? "");
        }
        expect(seen.size).toBe(size);
      }
    }
  });

  it("puts consecutive days far apart in the list, so it reads as chosen", () => {
    for (const category of ["kinh_thanh", "danh_ngon"] as DailyThoughtCategory[]) {
      const pool = thoughtPool(category);
      const stride = dailyStride(pool.length);
      expect(stride).toBeGreaterThan(1);
      expect(stride).toBeLessThan(pool.length - 1);
    }
  });

  it("repeats a line only after the full list has been through", () => {
    const size = KINH_THANH.length;
    const first = pickDailyThought("kinh_thanh", new Date(2026, 0, 1, 12, 0));
    for (let offset = 1; offset < size; offset += 1) {
      expect(pickDailyThought("kinh_thanh", new Date(2026, 0, 1 + offset, 12, 0))).not.toBe(first);
    }
    expect(pickDailyThought("kinh_thanh", new Date(2026, 0, 1 + size, 12, 0))).toBe(first);
  });

  it("counts a day by the reader's own clock, not UTC", () => {
    // 23:45 local is still today, even though it is already tomorrow in UTC.
    expect(dayNumber(new Date(2026, 8, 11, 23, 45))).toBe(dayNumber(new Date(2026, 8, 11, 0, 15)));
    expect(dayNumber(new Date(2026, 8, 12, 0, 15))).toBe(dayNumber(new Date(2026, 8, 11, 12, 0)) + 1);
  });
});

describe("what the block says", () => {
  it("is the line and the name, with nothing introducing them", () => {
    // The greeting above it has already spoken; a second voice saying "let us pause together"
    // before every quote turns one quiet line into a performance.
    const view = dailyThoughtView("kinh_thanh", noon(2026, 9, 11));
    expect(Object.keys(view ?? {}).sort()).toEqual(["speaker", "text"]);
  });

  it("reads the same at any hour, since nothing in it depends on the clock", () => {
    for (const category of ["kinh_thanh", "danh_ngon"] as DailyThoughtCategory[]) {
      const morning = dailyThoughtView(category, new Date(2026, 8, 11, 7, 0));
      const evening = dailyThoughtView(category, new Date(2026, 8, 11, 21, 0));
      expect(morning).toEqual(evening);
    }
  });
});

describe("what reaches the screen", () => {
  it("shows only text the lists contain", () => {
    const allowed = new Set([...KINH_THANH, ...DANH_NGON].map((thought) => thought.text));
    for (let offset = 0; offset < 200; offset += 1) {
      const day = new Date(2026, 0, 1 + offset, 12, 0);
      for (const category of ["kinh_thanh", "danh_ngon"] as DailyThoughtCategory[]) {
        const view = dailyThoughtView(category, day);
        expect(allowed.has(view?.text ?? "")).toBe(true);
      }
    }
  });

  it("carries a name for scripture and no name at all for a maxim", () => {
    for (let offset = 0; offset < 60; offset += 1) {
      const day = new Date(2026, 0, 1 + offset, 12, 0);
      expect(dailyThoughtView("kinh_thanh", day)?.speaker).toBeTruthy();
      expect(dailyThoughtView("danh_ngon", day)?.speaker).toBeNull();
    }
  });

  it("has nowhere to put a book, chapter or verse", () => {
    const view = dailyThoughtView("kinh_thanh", noon(2026, 9, 11));
    expect(view).not.toBeNull();
    expect(Object.keys(view ?? {}).sort()).toEqual(["speaker", "text"]);

    // Belt and braces: no rendered string may contain a reference from the data file.
    const references = KINH_THANH.map((thought) => thought.ref ?? "");
    for (let offset = 0; offset < 60; offset += 1) {
      const day = new Date(2026, 0, 1 + offset, 12, 0);
      const rendered = Object.values(dailyThoughtView("kinh_thanh", day) ?? {}).join(" ");
      for (const reference of references) {
        expect(rendered).not.toContain(reference);
      }
      expect(rendered).not.toMatch(/\d+:\d+/);
    }
  });
});
