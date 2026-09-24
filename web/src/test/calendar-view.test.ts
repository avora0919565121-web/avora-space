import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  CALENDAR_MODES,
  calendarModeSlug,
  monthGrid,
  parseCalendarMode,
  parseIsoDay,
  rangeContains,
  rangeFor,
  rangeLabel,
  shiftAnchor,
  startOfWeek,
  weekdayIndex,
  yearMonths,
} from "@/lib/calendar-view";
import { calendarProjection } from "@/lib/task-hub";
import type { TaskItem } from "@/lib/tasks";

const TODAY = "2026-09-24"; // a Thursday

function makeTask(overrides: Partial<TaskItem> & { id: string }): TaskItem {
  return {
    type: "personal",
    creatorId: "me",
    assigneeId: null,
    contextSnapshot: null,
    conversationId: null,
    title: "Việc",
    description: "",
    status: "confirmed",
    confirmedAt: null,
    doneAt: null,
    completedConfirmedAt: null,
    skippedAt: null,
    skippedSilently: false,
    deadline: "2026-09-30",
    deadlineTime: null,
    deadlineTz: "Asia/Ho_Chi_Minh",
    categoryId: null,
    isImportant: false,
    isMilestone: false,
    outputValue: null,
    progressPercent: null,
    recurrence: "none",
    recurrencePattern: null,
    recurrenceSpawnedAt: null,
    deletedByCreator: false,
    deletedByPeer: false,
    estimatedDurationMinutes: null,
    requiresPresence: false,
    startAt: null,
    endAt: null,
    location: null,
    latitude: null,
    longitude: null,
    travelDurationMinutes: null,
    departureReminderAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("Lịch modes", () => {
  it("offers Ngày / Tuần / Tháng / Năm, each with a one-line description", () => {
    expect(CALENDAR_MODES.map((mode) => mode.label)).toEqual(["Ngày", "Tuần", "Tháng", "Năm"]);
    for (const mode of CALENDAR_MODES) expect(mode.description.length).toBeGreaterThan(0);
  });

  it("round-trips slugs and falls back to Tháng", () => {
    expect(parseCalendarMode("ngay")).toBe("day");
    expect(parseCalendarMode(calendarModeSlug("year"))).toBe("year");
    expect(parseCalendarMode("nonsense")).toBe("month");
    expect(parseCalendarMode(null)).toBe("month");
  });

  it("only accepts real calendar days", () => {
    expect(parseIsoDay("2026-09-24")).toBe("2026-09-24");
    expect(parseIsoDay("2026-02-30")).toBeNull();
    expect(parseIsoDay("24/09/2026")).toBeNull();
  });
});

describe("Lịch ranges", () => {
  it("starts weeks on Monday", () => {
    expect(weekdayIndex("2026-09-21")).toBe(0);
    expect(weekdayIndex("2026-09-27")).toBe(6);
    expect(startOfWeek(TODAY)).toBe("2026-09-21");
    expect(rangeFor("week", TODAY)).toEqual({ from: "2026-09-21", to: "2026-09-27" });
  });

  it("asks for the whole month grid, padded to full weeks", () => {
    const range = rangeFor("month", TODAY);
    expect(range).toEqual({ from: "2026-08-31", to: "2026-10-04" });
    const weeks = monthGrid(TODAY);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0][0]).toBe("2026-08-31");
  });

  it("covers a whole year and a single day", () => {
    expect(rangeFor("year", TODAY)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(rangeFor("day", TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(yearMonths(TODAY)).toHaveLength(12);
  });

  it("steps in the unit being read, clamping at month end", () => {
    expect(shiftAnchor("day", TODAY, 1)).toBe("2026-09-25");
    expect(shiftAnchor("week", TODAY, -1)).toBe("2026-09-17");
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftAnchor("year", TODAY, 1)).toBe("2027-09-24");
  });

  it("labels ranges in Vietnamese", () => {
    expect(rangeLabel("month", TODAY, TODAY)).toBe("Tháng 9, 2026");
    expect(rangeLabel("day", TODAY, TODAY)).toBe("Hôm nay · Thứ Năm, 24 tháng 9");
    expect(rangeLabel("week", TODAY, TODAY)).toBe("21 – 27 thg 9, 2026");
    expect(rangeContains("month", "2026-10-02", TODAY)).toBe(false);
  });
});

describe("Lịch projection", () => {
  it("draws an Event as a block on its start day and a deadline as a marker", () => {
    const start = new Date(2026, 8, 25, 9, 0).toISOString();
    const days = calendarProjection(
      [
        makeTask({ id: "ev", requiresPresence: true, startAt: start, deadline: "2026-09-30" }),
        makeTask({ id: "due", deadline: "2026-09-24" }),
      ],
      "me",
      "2026-09-21",
      7,
      { includeDone: true },
    );
    const byDay = new Map(days.map((day) => [day.day, day]));
    expect(byDay.get("2026-09-25")?.entries.map((entry) => entry.kind)).toEqual(["block"]);
    expect(byDay.get("2026-09-24")?.entries.map((entry) => entry.kind)).toEqual(["marker"]);
  });

  it("keeps finished work in Lịch but leaves skipped work out", () => {
    const tasks = [
      makeTask({ id: "done", deadline: "2026-09-22", status: "done", doneAt: "2026-09-22T05:00:00Z" }),
      makeTask({ id: "skipped", type: "1-1-shared", conversationId: "c", deadline: "2026-09-22", status: "skipped", skippedAt: "2026-09-21T00:00:00Z" }),
    ];
    const withDone = calendarProjection(tasks, "me", "2026-09-21", 7, { includeDone: true });
    expect(withDone.flatMap((day) => day.entries).map((entry) => entry.task.id)).toEqual(["done"]);
    const upcoming = calendarProjection(tasks, "me", "2026-09-21", 7);
    expect(upcoming.flatMap((day) => day.entries)).toHaveLength(0);
  });
});
