import { describe, expect, it } from "vitest";

import {
  composeTime,
  HOUR_OPTIONS,
  MINUTE_OPTIONS,
  MINUTE_STEP,
  padTwo,
  snapToMinuteStep,
  splitTime,
  validateDeadlineTime,
} from "@/lib/task-schedule";

describe("MINUTE_OPTIONS", () => {
  it("offers only five-minute marks, twelve of them", () => {
    expect(MINUTE_STEP).toBe(5);
    expect(MINUTE_OPTIONS).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });

  it("contains no minute that is not a multiple of five", () => {
    expect(MINUTE_OPTIONS.every((minute) => minute % 5 === 0)).toBe(true);
    for (const forbidden of [1, 7, 13, 29, 44, 59]) {
      expect(MINUTE_OPTIONS).not.toContain(forbidden);
    }
  });

  it("stays inside one hour", () => {
    expect(Math.min(...MINUTE_OPTIONS)).toBe(0);
    expect(Math.max(...MINUTE_OPTIONS)).toBe(55);
  });
});

describe("HOUR_OPTIONS", () => {
  it("covers a full day, midnight to eleven at night", () => {
    expect(HOUR_OPTIONS).toHaveLength(24);
    expect(HOUR_OPTIONS[0]).toBe(0);
    expect(HOUR_OPTIONS[23]).toBe(23);
  });
});

describe("composeTime", () => {
  it("writes the two-digit clock the rest of the app stores", () => {
    expect(composeTime(16, 5)).toBe("16:05");
    expect(composeTime(9, 0)).toBe("09:00");
    expect(composeTime(23, 55)).toBe("23:55");
    expect(padTwo(7)).toBe("07");
  });

  it("refuses anything that is not a real time", () => {
    expect(composeTime(24, 0)).toBeNull();
    expect(composeTime(-1, 0)).toBeNull();
    expect(composeTime(12, 60)).toBeNull();
    expect(composeTime(1.5, 0)).toBeNull();
  });

  it("produces only values the validator accepts", () => {
    for (const hour of HOUR_OPTIONS) {
      for (const minute of MINUTE_OPTIONS) {
        const time = composeTime(hour, minute);
        expect(time).not.toBeNull();
        expect(validateDeadlineTime(time as string).error).toBeNull();
      }
    }
  });
});

describe("splitTime", () => {
  it("reads a stored time back into the grid", () => {
    expect(splitTime("16:05")).toEqual({ hour: 16, minute: 5 });
  });

  it("snaps an off-grid time down to the mark before it, rather than losing it", () => {
    // Times can arrive from the database, or from rows written before the five-minute rule.
    expect(splitTime("16:07")).toEqual({ hour: 16, minute: 5 });
    expect(splitTime("16:59")).toEqual({ hour: 16, minute: 55 });
    expect(snapToMinuteStep("16:07")).toBe("16:05");
  });

  it("copes with the seconds Postgres hands back", () => {
    expect(splitTime("08:30:00")).toEqual({ hour: 8, minute: 30 });
  });

  it("treats no time as no time, which is a real answer", () => {
    expect(splitTime(null)).toBeNull();
    expect(splitTime("")).toBeNull();
    expect(snapToMinuteStep(null)).toBeNull();
  });

  it("always lands on a mark the picker actually shows", () => {
    for (const raw of ["00:00", "07:03", "13:38", "23:59"]) {
      const parts = splitTime(raw);
      expect(parts).not.toBeNull();
      expect(MINUTE_OPTIONS).toContain((parts as { minute: number }).minute);
    }
  });
});
