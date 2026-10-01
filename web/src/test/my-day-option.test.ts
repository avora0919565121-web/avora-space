import { describe, expect, it, vi } from "vitest";

// task-hub reaches lib/tasks, which reaches the Supabase client — no env in the unit runner.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { localDayOf } from "@/lib/space-blocks";
import { myDayCardNote, myDayOption } from "@/lib/task-hub";
import { todayIso, type TaskItem } from "@/lib/tasks";

/**
 * AVORA-55 · 4 — the "Hôm nay" offer reads the task's own time first (VMT 01/10 16:33).
 *
 * Hôm nay = việc được gắn nhãn Hôm nay + việc có hạn hôm nay (+ sự kiện diễn ra hôm nay). The
 * button may only add the day's own mark; a presence Event never gets one, and a task already
 * carried by today's deadline needs none. No branch moves a deadline.
 */

function task(over: Partial<TaskItem> & { id: string }): TaskItem {
  return {
    type: "personal",
    title: "Việc",
    description: "",
    deadline: null,
    deadlineTime: null,
    startAt: null,
    endAt: null,
    location: null,
    requiresPresence: false,
    status: "todo",
    priority: "normal",
    creatorId: "u-me",
    assigneeId: "u-me",
    contextSnapshot: null,
    sourceTransactionId: null,
    outputValue: null,
    isMilestone: false,
    progressPercent: null,
    createdAt: "2026-10-01T00:00:00Z",
    doneAt: null,
    completedConfirmedAt: null,
    ...over,
  } as TaskItem;
}

const TODAY = "2026-10-01";
const TOMORROW = "2026-10-02";
const YESTERDAY = "2026-09-30";
const NEXT_MONDAY = "2026-10-05";

describe("myDayOption — the five branches (55.4a–d)", () => {
  it("55.4a · a presence Event, next week or last week, gets no button at all", () => {
    expect(myDayOption(task({ id: "e1", requiresPresence: true, startAt: `${NEXT_MONDAY}T09:00:00` }), TODAY)).toBe("none");
    expect(myDayOption(task({ id: "e2", requiresPresence: true, startAt: `${YESTERDAY}T09:00:00` }), TODAY)).toBe("none");
  });

  it("55.4b · due yesterday is overdue", () => {
    expect(myDayOption(task({ id: "o1", deadline: YESTERDAY }), TODAY)).toBe("overdue");
  });

  it("55.4c · due next Monday is early", () => {
    expect(myDayOption(task({ id: "f1", deadline: NEXT_MONDAY }), TODAY)).toBe("early");
  });

  it("55.4d · due today is already in Hôm nay", () => {
    expect(myDayOption(task({ id: "t1", deadline: TODAY }), TODAY)).toBe("today-auto");
  });

  it("no deadline at all is plain", () => {
    expect(myDayOption(task({ id: "p1" }), TODAY)).toBe("plain");
  });

  it("a start without a presence requirement reads by its start day like a deadline", () => {
    expect(myDayOption(task({ id: "s1", startAt: `${TODAY}T15:00:00` }), TODAY)).toBe("today-auto");
    expect(myDayOption(task({ id: "s2", startAt: `${TOMORROW}T15:00:00` }), TODAY)).toBe("early");
    expect(myDayOption(task({ id: "s3", startAt: `${YESTERDAY}T15:00:00` }), TODAY)).toBe("overdue");
  });

  it("presence without a start falls back to the deadline (the composer forbids it, data may still hold it)", () => {
    expect(myDayOption(task({ id: "x1", requiresPresence: true, deadline: YESTERDAY }), TODAY)).toBe("overdue");
    expect(myDayOption(task({ id: "x2", requiresPresence: true }), TODAY)).toBe("plain");
  });
});

describe("myDayOption — midnight boundary follows the machine's clock", () => {
  it("todayIso stays one day from 23:59 to 00:01 across the month edge", () => {
    expect(todayIso(new Date(2026, 9, 31, 23, 59))).toBe("2026-10-31");
    expect(todayIso(new Date(2026, 10, 1, 0, 1))).toBe("2026-11-01");
  });

  it("localDayOf puts an event at 23:59 on its own day and 00:01 on the next", () => {
    expect(localDayOf("2026-10-31T23:59:00")).toBe("2026-10-31");
    expect(localDayOf("2026-11-01T00:01:00")).toBe("2026-11-01");
  });

  it("an event at 23:59 today is in Hôm nay; the same hour tomorrow is not its day yet", () => {
    const event = task({ id: "ev", requiresPresence: true, startAt: "2026-10-01T23:59:00" });
    expect(myDayOption(event, "2026-10-01")).toBe("none");
    // The 'none' branch hides the button whatever the day — Hôm nay admits it through startAt.
    const lateEvent = task({ id: "ev2", requiresPresence: false, startAt: "2026-10-01T23:59:00" });
    expect(myDayOption(lateEvent, "2026-10-01")).toBe("today-auto");
    expect(myDayOption(lateEvent, "2026-10-02")).toBe("overdue");
  });
});

describe("myDayCardNote — the line inside the Hôm nay list", () => {
  it("an Event names its hour and day", () => {
    const note = myDayCardNote(task({ id: "e", requiresPresence: true, startAt: `${TODAY}T09:30:00` }), TODAY);
    expect(note?.text).toBe("Sự kiện lúc 09:30 · Hôm nay · 1/10");
  });

  it("carried-by-deadline says so", () => {
    expect(myDayCardNote(task({ id: "t", deadline: TODAY }), TODAY)?.text).toBe("Đã ở Hôm nay vì hạn hôm nay");
  });

  it("overdue keeps its original day, in the warning tone", () => {
    expect(myDayCardNote(task({ id: "o", deadline: YESTERDAY }), TODAY)).toEqual({ text: "Quá hạn từ 30/9", tone: "overdue" });
  });

  it("early keeps its future day", () => {
    expect(myDayCardNote(task({ id: "f", deadline: NEXT_MONDAY }), TODAY)?.text).toBe("Hạn 5/10");
  });

  it("plain (no date) adds nothing", () => {
    expect(myDayCardNote(task({ id: "p" }), TODAY)).toBeNull();
  });
});
