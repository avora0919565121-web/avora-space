import { vi } from "vitest";

// These are pure-logic tests; the client is never called, but importing the modules under
// test pulls it in, and it refuses to construct without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { validateTaskCategoryName, type TaskCategory } from "@/lib/task-categories";
import { dueReminders, type TaskReminder } from "@/lib/task-reminders";
import {
  compareTaskPriority,
  filterByCategories,
  groupTasksByDeadlineDay,
  importantTasks,
  sortTasksByPriority,
  taskTier,
  validateTaskDraft,
  type TaskFlagIndex,
  type TaskFlagValue,
  type TaskItem,
} from "@/lib/tasks";

const TODAY = "2026-09-08";
const ME = "u-me";
const THEM = "u-them";

/**
 * One reader's marks. Importance is no longer a property of the task, so these tests have to
 * say whose list they are describing — which is the point of the change.
 */
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

describe("taskTier", () => {
  it("puts what someone else asked of me first, then what I asked of them, then my own", () => {
    const askedOfMe = makeTask({ type: "1-1-shared", creatorId: THEM, conversationId: "c1" });
    const iAsked = makeTask({ type: "1-1-shared", creatorId: ME, conversationId: "c1" });
    const mine = makeTask({ type: "personal", creatorId: ME });

    expect(taskTier(askedOfMe, ME)).toBe(1);
    expect(taskTier(iAsked, ME)).toBe(2);
    expect(taskTier(mine, ME)).toBe(3);
  });

  it("reads the same shared task differently for each side", () => {
    const shared = makeTask({ type: "1-1-shared", creatorId: ME, conversationId: "c1" });
    expect(taskTier(shared, ME)).toBe(2);
    expect(taskTier(shared, THEM)).toBe(1);
  });
});

describe("ordering", () => {
  it("puts an earlier day first, whatever else is true of the tasks", () => {
    const early = makeTask({ id: "early", deadline: "2026-09-08" });
    const late = makeTask({ id: "late", deadline: "2026-09-12" });
    expect(sortTasksByPriority([late, early], TODAY, ME).map((t) => t.id)).toEqual(["early", "late"]);
  });

  it("sorts by the clock inside a single day", () => {
    const morning = makeTask({ id: "0900", deadline: "2026-09-12", deadlineTime: "09:00" });
    const afternoon = makeTask({ id: "1400", deadline: "2026-09-12", deadlineTime: "14:00" });
    const evening = makeTask({ id: "1900", deadline: "2026-09-12", deadlineTime: "19:00" });
    const order = sortTasksByPriority([evening, morning, afternoon], TODAY, ME).map((t) => t.id);
    expect(order).toEqual(["0900", "1400", "1900"]);
  });

  /** A day-only deadline means "by the end of that day", so it comes after timed work. */
  it("puts an untimed task after everything timed on the same day", () => {
    const timed = makeTask({ id: "timed", deadline: "2026-09-12", deadlineTime: "19:00" });
    const untimed = makeTask({ id: "untimed", deadline: "2026-09-12", deadlineTime: null });
    expect(sortTasksByPriority([untimed, timed], TODAY, ME).map((t) => t.id)).toEqual([
      "timed",
      "untimed",
    ]);
  });

  it("breaks a tie at the same moment by whose work is waiting on whom", () => {
    const mine = makeTask({
      id: "mine",
      type: "personal",
      deadline: "2026-09-12",
      deadlineTime: "14:00",
    });
    const theirs = makeTask({
      id: "theirs",
      type: "1-1-shared",
      creatorId: THEM,
      conversationId: "c1",
      deadline: "2026-09-12",
      deadlineTime: "14:00",
    });
    expect(sortTasksByPriority([mine, theirs], TODAY, ME).map((t) => t.id)).toEqual(["theirs", "mine"]);
  });

  it("ignores tier when nobody is looking, so the old two-argument ordering still holds", () => {
    const a = makeTask({ id: "a", deadline: "2026-09-12", deadlineTime: "14:00", createdAt: "2026-09-01T00:00:00Z" });
    const b = makeTask({
      id: "b",
      type: "1-1-shared",
      creatorId: THEM,
      conversationId: "c1",
      deadline: "2026-09-12",
      deadlineTime: "14:00",
      createdAt: "2026-09-02T00:00:00Z",
    });
    // Without a viewer the tie falls through to creation order, not to tier.
    expect(compareTaskPriority(a, b, TODAY)).toBeLessThan(0);
  });

  /**
   * The rule the brief is most emphatic about: starring a task must not let it jump ahead of
   * work that is genuinely due sooner.
   */
  it("never lets the importance mark outrank an earlier deadline", () => {
    const starredLater = makeTask({ id: "starred", deadline: "2026-09-15" });
    const plainSooner = makeTask({ id: "plain", deadline: "2026-09-10" });
    const flags = flagsFor({ starred: { isImportant: true } });
    expect(
      sortTasksByPriority([starredLater, plainSooner], TODAY, ME, flags).map((t) => t.id),
    ).toEqual(["plain", "starred"]);
  });

  it("uses the importance mark only when everything else already matches", () => {
    const starred = makeTask({ id: "starred", deadline: "2026-09-12", deadlineTime: "14:00" });
    const plain = makeTask({ id: "plain", deadline: "2026-09-12", deadlineTime: "14:00" });
    const flags = flagsFor({ starred: { isImportant: true } });
    expect(sortTasksByPriority([plain, starred], TODAY, ME, flags).map((t) => t.id)).toEqual([
      "starred",
      "plain",
    ]);
  });

  /**
   * The heart of the split: the same two tasks, ordered from two people's points of view,
   * come out in opposite orders because each is reading their own marks. Before this change
   * one person's star silently reordered everybody's list.
   */
  it("orders the same pair differently for two people who marked different things", () => {
    const a = makeTask({ id: "a", deadline: "2026-09-12", deadlineTime: "14:00" });
    const b = makeTask({ id: "b", deadline: "2026-09-12", deadlineTime: "14:00" });
    const mine = flagsFor({ a: { isImportant: true } });
    const theirs = flagsFor({ b: { isImportant: true } });
    expect(sortTasksByPriority([a, b], TODAY, ME, mine).map((t) => t.id)).toEqual(["a", "b"]);
    expect(sortTasksByPriority([a, b], TODAY, ME, theirs).map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("still sinks finished work to the bottom even when it is overdue", () => {
    const doneOverdue = makeTask({ id: "done", deadline: "2026-09-01", status: "done", doneAt: "2026-09-02T00:00:00Z" });
    const openLater = makeTask({ id: "open", deadline: "2026-09-20" });
    expect(sortTasksByPriority([doneOverdue, openLater], TODAY, ME).map((t) => t.id)).toEqual([
      "open",
      "done",
    ]);
  });
});

describe("groupTasksByDeadlineDay", () => {
  it("buckets tasks by the day they are due, in order, with each day sorted by clock", () => {
    const tasks = [
      makeTask({ id: "d12-late", deadline: "2026-09-12", deadlineTime: "19:00" }),
      makeTask({ id: "d09", deadline: "2026-09-09", deadlineTime: "14:00" }),
      makeTask({ id: "d12-early", deadline: "2026-09-12", deadlineTime: "09:00" }),
    ];
    const groups = groupTasksByDeadlineDay(tasks, TODAY, ME);
    expect(groups.map((group) => group.date)).toEqual(["2026-09-09", "2026-09-12"]);
    expect(groups[1]?.tasks.map((task) => task.id)).toEqual(["d12-early", "d12-late"]);
  });

  it("gives an empty list no groups at all", () => {
    expect(groupTasksByDeadlineDay([], TODAY, ME)).toEqual([]);
  });
});

describe("importantTasks", () => {
  it("keeps only work this person marked, still in deadline order", () => {
    const tasks = [
      makeTask({ id: "plain", deadline: "2026-09-09" }),
      makeTask({ id: "star-late", deadline: "2026-09-20" }),
      makeTask({ id: "star-soon", deadline: "2026-09-10" }),
    ];
    const flags = flagsFor({
      "star-late": { isImportant: true },
      "star-soon": { isImportant: true },
    });
    expect(importantTasks(tasks, TODAY, flags, ME).map((task) => task.id)).toEqual([
      "star-soon",
      "star-late",
    ]);
  });

  /** Someone who marked nothing sees an empty list, even on tasks others starred. */
  it("shows nothing to a person who marked nothing", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    expect(importantTasks(tasks, TODAY, flagsFor({}), ME)).toEqual([]);
  });
});

describe("filterByCategories", () => {
  const tasks = [
    makeTask({ id: "work", categoryId: "cat-work" }),
    makeTask({ id: "family", categoryId: "cat-family" }),
    makeTask({ id: "none", categoryId: null }),
  ];

  it("treats an empty selection as no filter at all", () => {
    expect(filterByCategories(tasks, []).map((task) => task.id)).toEqual(["work", "family", "none"]);
  });

  it("narrows to one shelf", () => {
    expect(filterByCategories(tasks, ["cat-work"]).map((task) => task.id)).toEqual(["work"]);
  });

  it("accepts several shelves at once and excludes unfiled work", () => {
    expect(filterByCategories(tasks, ["cat-work", "cat-family"]).map((task) => task.id)).toEqual([
      "work",
      "family",
    ]);
  });
});

describe("validateTaskDraft with a schedule", () => {
  const base = { title: "Họp", description: "Họp đầu tuần", deadline: "2026-09-12" };

  it("accepts a clock, a shelf and a repeat", () => {
    const result = validateTaskDraft(
      { ...base, deadlineTime: "09:00", categoryId: "cat-work", isImportant: true, recurrence: "weekly" },
      TODAY,
    );
    expect(result.value).not.toBeNull();
    expect(result.value?.deadlineTime).toBe("09:00");
    expect(result.value?.categoryId).toBe("cat-work");
    expect(result.value?.isImportant).toBe(true);
    expect(result.value?.recurrence).toBe("weekly");
  });

  it("treats a missing clock as 'that day' rather than refusing the task", () => {
    const result = validateTaskDraft({ ...base }, TODAY);
    expect(result.error).toBeNull();
    expect(result.value?.deadlineTime).toBeNull();
    expect(result.value?.recurrence).toBe("none");
  });

  it("refuses a malformed clock", () => {
    const result = validateTaskDraft({ ...base, deadlineTime: "9pm" }, TODAY);
    expect(result.value).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it("requires a usable pattern before accepting a custom repeat", () => {
    expect(validateTaskDraft({ ...base, recurrence: "custom" }, TODAY).value).toBeNull();
    expect(
      validateTaskDraft(
        { ...base, recurrence: "custom", recurrencePattern: { interval: 0, frequency: "weekly" } },
        TODAY,
      ).value,
    ).toBeNull();
    expect(
      validateTaskDraft(
        { ...base, recurrence: "custom", recurrencePattern: { interval: 2, frequency: "weekly" } },
        TODAY,
      ).value?.recurrencePattern,
    ).toEqual({ interval: 2, frequency: "weekly" });
  });

  it("drops a pattern that belongs to no custom repeat", () => {
    const result = validateTaskDraft(
      { ...base, recurrence: "weekly", recurrencePattern: { interval: 3, frequency: "daily" } },
      TODAY,
    );
    expect(result.value?.recurrencePattern).toBeNull();
  });

  it("still enforces the three required fields", () => {
    expect(validateTaskDraft({ title: "", description: "x", deadline: TODAY }, TODAY).value).toBeNull();
    expect(validateTaskDraft({ title: "x", description: "", deadline: TODAY }, TODAY).value).toBeNull();
    expect(validateTaskDraft({ title: "x", description: "y", deadline: "" }, TODAY).value).toBeNull();
  });
});

describe("task category names", () => {
  const existing: TaskCategory[] = [
    { id: "c1", name: "Công việc", slug: "work", color: "#5B7B8A", isDefault: true, sortOrder: 1 },
  ];

  it("rejects a duplicate regardless of case", () => {
    expect(validateTaskCategoryName("công việc", existing).error).not.toBeNull();
    expect(validateTaskCategoryName("CÔNG VIỆC", existing).error).not.toBeNull();
  });

  it("lets a category keep its own name while being edited", () => {
    expect(validateTaskCategoryName("Công việc", existing, "c1").name).toBe("Công việc");
  });

  it("rejects blank and over-long names", () => {
    expect(validateTaskCategoryName("   ", existing).error).not.toBeNull();
    expect(validateTaskCategoryName("x".repeat(51), existing).error).not.toBeNull();
    expect(validateTaskCategoryName("x".repeat(50), existing).name).not.toBeNull();
  });
});

describe("dueReminders", () => {
  function reminder(overrides: Partial<TaskReminder>): TaskReminder {
    return {
      id: "r1",
      taskId: "t1",
      at: "2026-09-08T01:00:00Z",
      timezone: "Asia/Ho_Chi_Minh",
      offsetMinutes: 30,
      isSent: false,
      ...overrides,
    };
  }

  const now = new Date("2026-09-08T02:00:00Z");

  it("surfaces a reminder whose moment has arrived", () => {
    expect(dueReminders([reminder({})], now)).toHaveLength(1);
  });

  it("leaves a future reminder alone", () => {
    expect(dueReminders([reminder({ at: "2026-09-08T05:00:00Z" })], now)).toEqual([]);
  });

  it("does not replay one that has already been shown", () => {
    expect(dueReminders([reminder({ isSent: true })], now)).toEqual([]);
  });
});
