import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the modules pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  DURATION_PRESETS,
  durationPresetOf,
  formatDuration,
  parseDurationInput,
  toFlagIndex,
  upsertFlagRow,
  type TaskFlagRow,
} from "@/lib/task-flags";
import { GUIDANCE_TEXT, shouldShowGuidance } from "@/lib/guidance";
import {
  durationFor,
  heavyTasks,
  HEAVY_TASK_MINUTES,
  isHeavyDuration,
  isHeavyFor,
  isImportantFor,
  leadTimeMinutes,
  slackMinutes,
  TASK_VIEW_LABELS,
  type TaskFlagIndex,
  type TaskFlagValue,
  type TaskItem,
} from "@/lib/tasks";

const TODAY = "2026-09-08";
const ME = "u-me";

function makeTask(overrides: Partial<TaskItem>): TaskItem {
  return {
    id: "t1",
    type: "personal",
    creatorId: ME,
    assigneeId: null,
    contextSnapshot: null,
    conversationId: null,
    title: "Việc cần làm",
    description: "Mô tả cụ thể",
    status: "confirmed",
    confirmedAt: null,
    doneAt: null,
    completedConfirmedAt: null,
    skippedAt: null,
    skippedSilently: false,
    deadline: TODAY,
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

function flagsFor(entries: Record<string, Partial<TaskFlagValue>>): TaskFlagIndex {
  const index = new Map<string, TaskFlagValue>();
  for (const [taskId, value] of Object.entries(entries)) {
    index.set(taskId, {
      isImportant: value.isImportant ?? false,
      durationMinutes: value.durationMinutes ?? null,
      startedAt: value.startedAt ?? null,
    });
  }
  return index;
}

describe("reading one person's flags", () => {
  it("treats an absent row as unmarked and unestimated, never as unknown", () => {
    const empty = flagsFor({});
    expect(isImportantFor(empty, "t1")).toBe(false);
    expect(durationFor(empty, "t1")).toBeNull();
  });

  /**
   * The whole reason the flag moved off the task: two people hold different opinions about
   * the same work, and each is right about their own list.
   */
  it("lets two people disagree about the same task without touching each other", () => {
    const creator = flagsFor({ shared: { isImportant: true, durationMinutes: 30 } });
    const assignee = flagsFor({ shared: { isImportant: false, durationMinutes: 240 } });

    expect(isImportantFor(creator, "shared")).toBe(true);
    expect(isImportantFor(assignee, "shared")).toBe(false);
    // The person carrying the work thinks it is heavy; the person who asked does not.
    expect(isHeavyFor(creator, "shared")).toBe(false);
    expect(isHeavyFor(assignee, "shared")).toBe(true);
  });
});

describe("heavy is about effort, not urgency", () => {
  it("draws the line above an hour, not at it", () => {
    expect(isHeavyDuration(HEAVY_TASK_MINUTES)).toBe(false);
    expect(isHeavyDuration(HEAVY_TASK_MINUTES + 1)).toBe(true);
    expect(isHeavyDuration(null)).toBe(false);
  });

  it("never calls an unestimated task heavy", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    expect(heavyTasks(tasks, TODAY, flagsFor({}), ME)).toEqual([]);
  });
});

describe("leadTimeMinutes", () => {
  it("treats a day with no clock as due by the end of that day", () => {
    const task = makeTask({ deadline: TODAY, deadlineTime: null });
    expect(leadTimeMinutes(task, TODAY)).toBe(24 * 60);
  });

  it("uses the stated hour when there is one", () => {
    const task = makeTask({ deadline: TODAY, deadlineTime: "14:30" });
    expect(leadTimeMinutes(task, TODAY)).toBe(14 * 60 + 30);
  });

  it("goes negative for work already past its hour", () => {
    const task = makeTask({ deadline: "2026-09-07", deadlineTime: "09:00" });
    expect(leadTimeMinutes(task, TODAY)).toBe(-24 * 60 + 9 * 60);
  });

  it("has no answer for a task with no deadline", () => {
    expect(leadTimeMinutes(makeTask({ deadline: null }), TODAY)).toBeNull();
  });
});

describe("slack is lead time minus the work itself", () => {
  it("subtracts the estimate from the time available", () => {
    const task = makeTask({ id: "t", deadline: TODAY, deadlineTime: "10:00" });
    const flags = flagsFor({ t: { durationMinutes: 120 } });
    // Due at 600 minutes into the day, costs 120 → 480 minutes of room.
    expect(slackMinutes(task, TODAY, flags)).toBe(480);
  });

  it("gives a task with no deadline unlimited room so it sorts last without a special case", () => {
    const task = makeTask({ id: "t", deadline: null });
    const flags = flagsFor({ t: { durationMinutes: 600 } });
    expect(slackMinutes(task, TODAY, flags)).toBe(Number.POSITIVE_INFINITY);
  });

  it("counts an unestimated task as costing nothing, leaving its full lead time", () => {
    const task = makeTask({ id: "t", deadline: TODAY, deadlineTime: "10:00" });
    expect(slackMinutes(task, TODAY, flagsFor({}))).toBe(600);
  });
});

describe("heavyTasks ordering", () => {
  /**
   * The reason this view cannot just sort by deadline. The long job is due LATER but has
   * almost no room left; the short one is due sooner and is comfortable. Sorting by date
   * would put the wrong task on top, which is precisely the mistake the view exists to fix.
   */
  it("puts the task running out of room first, even when its deadline is later", () => {
    const tightLater = makeTask({ id: "tight", deadline: "2026-09-09", deadlineTime: "09:00" });
    const roomySooner = makeTask({ id: "roomy", deadline: TODAY, deadlineTime: "23:00" });
    const flags = flagsFor({
      // Due in 33 hours, needs 32 → one hour of room.
      tight: { durationMinutes: 32 * 60 },
      // Due in 23 hours, needs 2 → 21 hours of room.
      roomy: { durationMinutes: 120 },
    });
    expect(heavyTasks([roomySooner, tightLater], TODAY, flags, ME).map((t) => t.id)).toEqual([
      "tight",
      "roomy",
    ]);
  });

  it("keeps only what this person called heavy", () => {
    const heavy = makeTask({ id: "heavy" });
    const light = makeTask({ id: "light" });
    const flags = flagsFor({
      heavy: { durationMinutes: 90 },
      light: { durationMinutes: 20 },
    });
    expect(heavyTasks([heavy, light], TODAY, flags, ME).map((t) => t.id)).toEqual(["heavy"]);
  });

  it("sends a task with no deadline to the end, since it has all the room in the world", () => {
    const dated = makeTask({ id: "dated", deadline: "2026-09-20" });
    const undated = makeTask({ id: "undated", deadline: null });
    const flags = flagsFor({
      dated: { durationMinutes: 300 },
      undated: { durationMinutes: 300 },
    });
    expect(heavyTasks([undated, dated], TODAY, flags, ME).map((t) => t.id)).toEqual([
      "dated",
      "undated",
    ]);
  });

  it("sinks finished work below live work whatever its slack", () => {
    const doneTight = makeTask({
      id: "done",
      deadline: "2026-09-01",
      status: "done",
      doneAt: "2026-09-02T00:00:00Z",
    });
    const openRoomy = makeTask({ id: "open", deadline: "2026-09-30" });
    const flags = flagsFor({
      done: { durationMinutes: 600 },
      open: { durationMinutes: 600 },
    });
    expect(heavyTasks([doneTight, openRoomy], TODAY, flags, ME).map((t) => t.id)).toEqual([
      "open",
      "done",
    ]);
  });
});

describe("duration input", () => {
  it("offers a light and a heavy answer, one on each side of the hour", () => {
    const light = DURATION_PRESETS.find((preset) => preset.id === "light");
    const heavy = DURATION_PRESETS.find((preset) => preset.id === "heavy");
    expect(isHeavyDuration(light?.minutes ?? null)).toBe(false);
    expect(isHeavyDuration(heavy?.minutes ?? null)).toBe(true);
  });

  it("reads back which quick answer a stored estimate belongs to", () => {
    expect(durationPresetOf(null)).toBeNull();
    expect(durationPresetOf(45)).toBe("light");
    expect(durationPresetOf(HEAVY_TASK_MINUTES)).toBe("light");
    expect(durationPresetOf(HEAVY_TASK_MINUTES + 1)).toBe("heavy");
  });

  it("treats an empty or nonsense box as not estimated rather than as zero", () => {
    expect(parseDurationInput("")).toBeNull();
    expect(parseDurationInput("   ")).toBeNull();
    expect(parseDurationInput("abc")).toBeNull();
    expect(parseDurationInput("0")).toBeNull();
    expect(parseDurationInput("-5")).toBeNull();
    expect(parseDurationInput("90")).toBe(90);
  });

  it("says hours once an estimate passes one, and minutes below it", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(45)).toBe("45 phút");
    expect(formatDuration(60)).toBe("1 giờ");
    expect(formatDuration(150)).toBe("2 giờ 30 phút");
  });
});

describe("flag cache", () => {
  const base: TaskFlagRow[] = [
    { taskId: "a", isImportant: true, durationMinutes: null, startedAt: null, myDayOn: null },
    { taskId: "b", isImportant: false, durationMinutes: 120, startedAt: null, myDayOn: null },
  ];

  it("indexes rows by task", () => {
    const index = toFlagIndex(base);
    expect(index.get("a")?.isImportant).toBe(true);
    expect(index.get("b")?.durationMinutes).toBe(120);
    expect(index.get("missing")).toBeUndefined();
  });

  it("adds a row the first time a task is marked", () => {
    const next = upsertFlagRow(base, {
      taskId: "c",
      isImportant: true,
      durationMinutes: 30,
      startedAt: null,
      myDayOn: null,
    });
    expect(next).toHaveLength(3);
    expect(next[2]?.taskId).toBe("c");
  });

  it("replaces a row in place rather than duplicating it", () => {
    const next = upsertFlagRow(base, {
      taskId: "a",
      isImportant: false,
      durationMinutes: 15,
      startedAt: null,
      myDayOn: null,
    });
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual({
      taskId: "a",
      isImportant: false,
      durationMinutes: 15,
      startedAt: null,
      myDayOn: null,
    });
  });
});

describe("one-time guidance", () => {
  it("stops showing an explanation once it has been dismissed", () => {
    expect(shouldShowGuidance([], "task_important_flag")).toBe(true);
    expect(shouldShowGuidance(["task_important_flag"], "task_important_flag")).toBe(false);
    // Dismissing one says nothing about the others.
    expect(shouldShowGuidance(["task_important_flag"], "task_duration_field")).toBe(true);
  });

  /**
   * The importance note exists to separate three things the old label ran together: urgency,
   * effort, and mattering. The example is deliberately something small, undated and important.
   */
  it("explains importance with an example that is neither urgent nor heavy", () => {
    const text = GUIDANCE_TEXT.task_important_flag;
    expect(text).toContain("không phải vì gấp");
    expect(text).toContain("vài phút");
    expect(text).toContain("không có hạn");
  });

  it("tells people an estimate does not have to be accurate", () => {
    expect(GUIDANCE_TEXT.task_duration_field).toContain("không cần chính xác");
  });
});

describe("the label change", () => {
  /** "Urgent" was the wrong word: the deadline already answers urgency. */
  it("calls the tab Quan trọng, not Khẩn cấp", () => {
    expect(TASK_VIEW_LABELS.important).toBe("Quan trọng");
    expect(TASK_VIEW_LABELS.heavy).toBe("Nhiệm vụ nặng");
  });
});
