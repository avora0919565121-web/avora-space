import { describe, expect, it } from "vitest";

import {
  DANH_NGON,
  DAILY_THOUGHT_OPTIONS,
  DANH_NGON_YEAR_KEY,
  dailyStride,
  dailyThoughtView,
  dayNumber,
  dayOfYear,
  DEFAULT_DAILY_THOUGHT_CATEGORY,
  isDailyThoughtCategory,
  KINH_THANH,
  maximOffset,
  pickDailyThought,
  thoughtPool,
  type DailyThoughtCategory,
} from "@/lib/daily-thoughts";
import { MAXIM_SECTIONS } from "@/lib/daily-thought-maxims";

/** Local noon on a given day: far from both midnights, so no timezone can shift the date. */
function noon(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0);
}

describe("the lists themselves", () => {
  it("holds exactly the 30 scripture lines and the 365 maxims that were given", () => {
    expect(KINH_THANH).toHaveLength(30);
    expect(DANH_NGON).toHaveLength(365);
  });

  it("keeps the wording verbatim, first maxim to last", () => {
    expect(KINH_THANH[0].text).toBe(
      "Yêu Đức Chúa Trời hết lòng, hết linh hồn, hết trí khôn — và yêu người lân cận như chính mình.",
    );
    expect(DANH_NGON[0].text).toBe(
      "Niềm tin không phải là biết chắc mọi thứ sẽ ổn — mà là dám bước tiếp khi chưa biết.",
    );
    expect(DANH_NGON[30].text).toBe(
      'Cuối ngày, câu hỏi không phải "mình đã hiểu hết chưa" mà là "mình đã tin đủ để bước tiếp chưa".',
    );
    expect(DANH_NGON[364].text).toBe(
      'Cuối năm nhìn lại, câu hỏi quan trọng không phải là "mình đã đạt được gì", mà là "mình đã trở thành ai, và mình đã sống có trách nhiệm, có yêu thương, có trọn vẹn hay chưa".',
    );
  });

  it("has no blank or duplicated lines in either list", () => {
    for (const thought of [...KINH_THANH, ...DANH_NGON]) {
      expect(thought.text.trim().length).toBeGreaterThan(0);
    }
    const scripture = KINH_THANH.map((thought) => thought.text);
    const maxims = DANH_NGON.map((thought) => thought.text);
    expect(new Set(scripture).size).toBe(scripture.length);
    // One line per day of the year: a repeat would give two days the same thought.
    expect(new Set(maxims).size).toBe(365);
  });

  it("carries each maxim's section as its theme, in the order the sections were given", () => {
    const themes = new Set(DANH_NGON.map((thought) => thought.theme));
    expect(themes.size).toBe(MAXIM_SECTIONS.length);
    let at = 0;
    for (const section of MAXIM_SECTIONS) {
      for (const line of section.lines) {
        expect(DANH_NGON[at].text).toBe(line);
        expect(DANH_NGON[at].theme).toBe(section.theme);
        at += 1;
      }
    }
  });

  it("names a speaker for every scripture line and none for any maxim", () => {
    for (const thought of KINH_THANH) {
      expect(thought.speaker).not.toBeNull();
      expect((thought.speaker ?? "").trim().length).toBeGreaterThan(0);
    }
    for (const thought of DANH_NGON) {
      expect(thought.speaker).toBeNull();
      expect(thought.ref).toBeNull();
    }
  });

  it("offers only the maxims and Ẩn for choosing — scripture is paused, not gone", () => {
    expect(DAILY_THOUGHT_OPTIONS.map((option) => option.value)).toEqual([
      "danh_ngon",
      "khong_chon",
    ]);
    expect(DAILY_THOUGHT_OPTIONS.map((option) => option.label)).toEqual(["Danh ngôn", "Ẩn"]);
    // But it remains a real category: people who chose it before keep their daily verse.
    expect(isDailyThoughtCategory("kinh_thanh")).toBe(true);
    expect(thoughtPool("kinh_thanh")).toHaveLength(30);
    expect(isDailyThoughtCategory("bible")).toBe(false);
  });

  it("opens someone who never chose on the maxims, not on a blank", () => {
    expect(DEFAULT_DAILY_THOUGHT_CATEGORY).toBe("danh_ngon");
  });
});

describe("the maxim calendar", () => {
  it("maps day N of the year to maxim N, turned by the year's offset", () => {
    for (const [year, month, day] of [
      [2026, 1, 1],
      [2027, 3, 15],
      [2028, 12, 30],
    ] as const) {
      const date = noon(year, month, day);
      const offset = maximOffset(year);
      const expected = DANH_NGON[(dayOfYear(date) - 1 + offset) % 365];
      expect(pickDailyThought("danh_ngon", date)?.text).toBe(expected.text);
    }
  });

  it("gives the same date a different line in different years", () => {
    const seen = new Set<string>();
    for (let year = 2025; year <= 2029; year += 1) {
      const line = pickDailyThought("danh_ngon", noon(year, 1, 1))?.text;
      expect(line).toBeDefined();
      seen.add(line ?? "");
    }
    expect(seen.size).toBe(5);
  });

  it("uses every maxim exactly once across a calendar year, in any year", () => {
    for (const year of [2026, 2027, 2033]) {
      const seen = new Set<string>();
      for (let day = 0; day < 365; day += 1) {
        const date = new Date(year, 0, 1 + day, 12, 0, 0);
        const line = pickDailyThought("danh_ngon", date)?.text;
        expect(line).toBeDefined();
        seen.add(line ?? "");
      }
      expect(seen.size).toBe(365);
    }
  });

  it("lets a leap year's 366th day repeat day 365's line, and nothing else", () => {
    expect(dayOfYear(noon(2028, 12, 31))).toBe(366);
    expect(pickDailyThought("danh_ngon", noon(2028, 12, 31))?.text).toBe(
      pickDailyThought("danh_ngon", noon(2028, 12, 30))?.text,
    );
    // Dec 30 is day 365: the real line of the year's end, not a repeat of Dec 29.
    expect(pickDailyThought("danh_ngon", noon(2028, 12, 30))?.text).not.toBe(
      pickDailyThought("danh_ngon", noon(2028, 12, 29))?.text,
    );
  });

  it("does not repeat across a year boundary either", () => {
    expect(pickDailyThought("danh_ngon", noon(2026, 12, 31))?.text).not.toBe(
      pickDailyThought("danh_ngon", noon(2027, 1, 1))?.text,
    );
  });

  it("turns the wheel by a fixed amount each year, so the calendar does not loop quickly", () => {
    expect(DANH_NGON_YEAR_KEY).toBeGreaterThan(1);
    expect(DANH_NGON_YEAR_KEY).toBeLessThan(365);
    // Coprime with 365 = 5 × 73: the same date takes 365 years to return to a maxim.
    expect(DANH_NGON_YEAR_KEY % 5).not.toBe(0);
    expect(DANH_NGON_YEAR_KEY % 73).not.toBe(0);
    expect(maximOffset(2026)).toBe(maximOffset(2026 + 365));
    const offsets = Array.from({ length: 10 }, (_, i) => maximOffset(2026 + i));
    expect(new Set(offsets).size).toBe(10);
  });

  it("counts a day by the reader's own clock, not UTC", () => {
    expect(dayOfYear(new Date(2026, 0, 1, 23, 45))).toBe(1);
    expect(dayOfYear(new Date(2026, 11, 31, 12, 0))).toBe(365);
    expect(dayOfYear(new Date(2028, 11, 31, 12, 0))).toBe(366);
  });
});

describe("choosing the day's line", () => {
  it("shows nothing when the reader chose to hide the thought", () => {
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

  it("never repeats yesterday's line today, across years too", () => {
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

  it("keeps scripture fair over ANY window of days, wherever it starts", () => {
    const size = thoughtPool("kinh_thanh").length;
    for (let start = 0; start < 90; start += 1) {
      const seen = new Set<string>();
      for (let step = 0; step < size; step += 1) {
        const day = new Date(2026, 0, 1 + start + step, 12, 0, 0);
        const thought = pickDailyThought("kinh_thanh", day);
        expect(thought).not.toBeNull();
        seen.add(thought?.text ?? "");
      }
      expect(seen.size).toBe(size);
    }
  });

  it("keeps the scripture stride away from both ends of the list", () => {
    const stride = dailyStride(thoughtPool("kinh_thanh").length);
    expect(stride).toBeGreaterThan(1);
    expect(stride).toBeLessThan(thoughtPool("kinh_thanh").length - 1);
  });

  it("repeats a scripture line only after the full list has been through", () => {
    const size = KINH_THANH.length;
    const first = pickDailyThought("kinh_thanh", new Date(2026, 0, 1, 12, 0));
    for (let offset = 1; offset < size; offset += 1) {
      expect(pickDailyThought("kinh_thanh", new Date(2026, 0, 1 + offset, 12, 0))).not.toBe(first);
    }
    expect(pickDailyThought("kinh_thanh", new Date(2026, 0, 1 + size, 12, 0))).toBe(first);
  });
});

describe("what the block says", () => {
  it("is the line and the name, with nothing introducing them", () => {
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
