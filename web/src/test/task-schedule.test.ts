import {
  addDaysIso,
  addMonthsIso,
  deadlineInstant,
  DEFAULT_REMINDER_PRESET,
  feasibleReminderPresets,
  formatDeadlineTime,
  isDeadlinePast,
  nextOccurrence,
  normalizeDeadlineTime,
  reminderInstant,
  reminderOffsetMinutes,
  reminderPresetById,
  validateDeadlineTime,
  type RecurrencePattern,
} from "@/lib/task-schedule";

describe("deadline clock", () => {
  it("accepts a plain HH:MM and trims seconds Postgres adds", () => {
    expect(normalizeDeadlineTime("14:00")).toBe("14:00");
    expect(normalizeDeadlineTime("09:30:00")).toBe("09:30");
    expect(normalizeDeadlineTime(" 23:59 ")).toBe("23:59");
  });

  it("treats an empty clock as 'any time that day' rather than as an error", () => {
    expect(normalizeDeadlineTime("")).toBeNull();
    expect(normalizeDeadlineTime(null)).toBeNull();
    expect(validateDeadlineTime("")).toEqual({ time: null, error: null });
  });

  it("rejects impossible clocks", () => {
    expect(normalizeDeadlineTime("24:00")).toBeNull();
    expect(normalizeDeadlineTime("12:60")).toBeNull();
    expect(normalizeDeadlineTime("9:00")).toBeNull();
    expect(validateDeadlineTime("25:00").error).not.toBeNull();
  });

  it("formats back only what it would accept", () => {
    expect(formatDeadlineTime("08:05")).toBe("08:05");
    expect(formatDeadlineTime(null)).toBeNull();
  });
});

describe("deadlineInstant", () => {
  it("makes a day-only deadline due at the END of that day, not the start", () => {
    const due = deadlineInstant("2026-09-12", null);
    expect(due?.getHours()).toBe(23);
    expect(due?.getMinutes()).toBe(59);
    expect(due?.getDate()).toBe(12);
  });

  it("uses the stated clock when there is one", () => {
    const due = deadlineInstant("2026-09-12", "14:00");
    expect(due?.getHours()).toBe(14);
    expect(due?.getMinutes()).toBe(0);
  });

  /**
   * The regression the nullable column exists to prevent: backfilling 09:00 onto day-only
   * deadlines would make work promised for today read as late by mid-morning.
   */
  it("does not treat work due later today as already late", () => {
    const noon = new Date(2026, 8, 12, 12, 0, 0);
    expect(isDeadlinePast("2026-09-12", null, noon)).toBe(false);
    expect(isDeadlinePast("2026-09-12", "09:00", noon)).toBe(true);
    expect(isDeadlinePast("2026-09-12", "14:00", noon)).toBe(false);
  });
});

describe("calendar arithmetic", () => {
  it("clamps a month-end date into a shorter month, the way Postgres does", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsIso("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("crosses a year boundary", () => {
    expect(addMonthsIso("2026-11-30", 2)).toBe("2027-01-30");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("nextOccurrence", () => {
  it("does nothing for a task that does not repeat", () => {
    expect(nextOccurrence("2026-09-08", "none", null, "2026-09-08")).toBeNull();
  });

  it("steps a daily, weekly and monthly task forward once when it is finished on time", () => {
    expect(nextOccurrence("2026-09-08", "daily", null, "2026-09-08")).toBe("2026-09-09");
    expect(nextOccurrence("2026-09-08", "weekly", null, "2026-09-08")).toBe("2026-09-15");
    expect(nextOccurrence("2026-09-08", "monthly", null, "2026-09-08")).toBe("2026-10-08");
  });

  /**
   * The important one. A weekly task finished three weeks late must not produce a successor
   * in the past: the database refuses a past deadline outright, so "deadline + one interval"
   * would make completing the task fail rather than merely produce a stale date.
   */
  it("rolls a late completion forward into the future, keeping the weekday", () => {
    const next = nextOccurrence("2026-08-17", "weekly", null, "2026-09-08");
    expect(next).toBe("2026-09-14");
    expect(next! > "2026-09-08").toBe(true);
    // 17 Aug 2026 and 14 Sep 2026 are both Mondays.
    expect(new Date(`${next}T00:00:00`).getDay()).toBe(new Date("2026-08-17T00:00:00").getDay());
  });

  it("keeps a month-end task at month-end instead of drifting earlier each time", () => {
    // Stepping one month at a time from 31 Jan would land on 28 Feb and then 28 Mar.
    expect(nextOccurrence("2026-01-31", "monthly", null, "2026-02-28")).toBe("2026-03-31");
  });

  it("honours a custom interval", () => {
    const everyTwoDays: RecurrencePattern = { interval: 2, frequency: "daily" };
    expect(nextOccurrence("2026-09-08", "custom", everyTwoDays, "2026-09-08")).toBe("2026-09-10");

    const everyThreeWeeks: RecurrencePattern = { interval: 3, frequency: "weekly" };
    expect(nextOccurrence("2026-09-08", "custom", everyThreeWeeks, "2026-09-08")).toBe("2026-09-29");

    const everyTwoMonths: RecurrencePattern = { interval: 2, frequency: "monthly" };
    expect(nextOccurrence("2026-09-08", "custom", everyTwoMonths, "2026-09-08")).toBe("2026-11-08");
  });

  it("falls back to weekly when a custom pattern is unusable", () => {
    expect(nextOccurrence("2026-09-08", "custom", null, "2026-09-08")).toBe("2026-09-15");
  });
});

describe("reminders", () => {
  const DEADLINE = "2026-09-12";

  it("suggests 30 minutes before by default", () => {
    expect(DEFAULT_REMINDER_PRESET).toBe("m30");
  });

  it("places a fixed-offset reminder the stated distance before the deadline", () => {
    const preset = reminderPresetById("m30");
    const at = reminderInstant(preset!, DEADLINE, "09:00");
    expect(at?.getHours()).toBe(8);
    expect(at?.getMinutes()).toBe(30);
    expect(reminderOffsetMinutes(preset!, DEADLINE, "09:00")).toBe(30);
  });

  it("places 'same morning' at 09:00 on the day itself, whatever the deadline hour", () => {
    const preset = reminderPresetById("morning");
    const at = reminderInstant(preset!, DEADLINE, "17:00");
    expect(at?.getHours()).toBe(9);
    expect(at?.getDate()).toBe(12);
    // Stored as a distance so a repeat can re-place it against the next occurrence.
    expect(reminderOffsetMinutes(preset!, DEADLINE, "17:00")).toBe(8 * 60);
  });

  it("measures the offset from the end of the day when no clock was set", () => {
    const preset = reminderPresetById("h1");
    const at = reminderInstant(preset!, DEADLINE, null);
    expect(at?.getHours()).toBe(22);
    expect(at?.getMinutes()).toBe(59);
  });

  /**
   * "Same morning 09:00" on a task due at 08:00 would fire AFTER its own deadline, and the
   * server refuses that outright — so the picker must not offer it.
   */
  it("hides a preset that would fire after the deadline it belongs to", () => {
    const now = new Date(2026, 8, 11, 6, 0, 0);
    const offered = feasibleReminderPresets(DEADLINE, "08:00", now).map((preset) => preset.id);
    expect(offered).not.toContain("morning");
    expect(offered).toContain("m30");
  });

  it("hides a preset that is already in the past", () => {
    // Due in 20 minutes, so the 30-minute, 1-hour and 1-day nudges have all been missed.
    // "Same morning" survives because 09:00 IS the deadline here, which is a legitimate
    // "due now" alert rather than a warning that arrives too late to act on.
    const now = new Date(2026, 8, 12, 8, 40, 0);
    const offered = feasibleReminderPresets(DEADLINE, "09:00", now).map((preset) => preset.id);
    expect(offered).toContain("m15");
    expect(offered).not.toContain("m30");
    expect(offered).not.toContain("h1");
    expect(offered).not.toContain("d1");
  });

  it("offers nothing at all once the deadline itself has passed", () => {
    const now = new Date(2026, 8, 13, 10, 0, 0);
    expect(feasibleReminderPresets(DEADLINE, "09:00", now)).toEqual([]);
  });

  it("offers nothing when there is no deadline to measure from", () => {
    expect(feasibleReminderPresets("", null)).toEqual([]);
  });
});
