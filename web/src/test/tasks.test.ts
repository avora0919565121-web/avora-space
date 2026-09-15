import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  canConfirmSharedTask,
  canDeleteTask,
  canMarkSharedDone,
  canPurgeTask,
  canReturnSharedTask,
  canReviewSharedDone,
  compareTaskPriority,
  countOpenTasks,
  countTasksNeedingAttention,
  daysUntilDeadline,
  deadlineLabel,
  deadlinePriority,
  deleteIsPermanent,
  deletedByOtherNote,
  groupSharedByConversation,
  highestOpenPriority,
  isDeletedByOther,
  isDeletedFor,
  isOpenTask,
  isTaskDraftComplete,
  isTaskGone,
  needsAttention,
  normalizeDeadline,
  partitionByBin,
  removeTask,
  sharedTaskNote,
  sortTasksByPriority,
  taskFromRealtimeRow,
  taskPriority,
  taskStatusLabel,
  todayIso,
  toVietnameseTaskError,
  upsertTask,
  validateTaskDeadline,
  validateTaskDescription,
  validateTaskDraft,
  validateTaskTitle,
  type TaskItem,
} from "@/lib/tasks";

const TODAY = "2026-09-07";

function makeTask(overrides: Partial<TaskItem>): TaskItem {
  return {
    id: "t1",
    type: "personal",
    creatorId: "u1",
    assigneeId: null,
    contextSnapshot: null,
    conversationId: null,
    title: "Việc cần làm",
    description: "Làm xong rồi gửi lại bản PDF",
    status: "confirmed",
    confirmedAt: null,
    doneAt: null,
    completedConfirmedAt: null,
    skippedAt: null,
    skippedSilently: false,
    deadline: null,
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
    createdAt: "2026-09-07T00:00:00Z",
    ...overrides,
  };
}

describe("validateTaskTitle", () => {
  it("trims surrounding whitespace", () => {
    expect(validateTaskTitle("  Gọi điện cho An  ")).toEqual({
      title: "Gọi điện cho An",
      error: null,
    });
  });

  it("rejects an empty title", () => {
    expect(validateTaskTitle("")?.title).toBeNull();
    expect(validateTaskTitle("")?.error).toContain("không được để trống");
  });

  it("rejects a whitespace-only title", () => {
    expect(validateTaskTitle("   ")?.title).toBeNull();
  });

  it("rejects a title over 200 characters", () => {
    const long = "x".repeat(201);
    expect(validateTaskTitle(long)?.title).toBeNull();
    expect(validateTaskTitle(long)?.error).toContain("200");
  });

  it("accepts a title of exactly 200 characters", () => {
    const exact = "x".repeat(200);
    expect(validateTaskTitle(exact)?.title).toBe(exact);
    expect(validateTaskTitle(exact)?.error).toBeNull();
  });
});

describe("a task needs a description and a deadline", () => {
  it("trims a description and keeps it", () => {
    expect(validateTaskDescription("  Gửi bản PDF cuối cùng  ")).toEqual({
      description: "Gửi bản PDF cuối cùng",
      error: null,
    });
  });

  it("refuses an empty or whitespace-only description, and says what is wanted", () => {
    for (const raw of ["", "   ", "\n"]) {
      const result = validateTaskDescription(raw);
      expect(result.description).toBeNull();
      expect(result.error).toContain("bắt buộc");
    }
  });

  it("refuses a description over 2000 characters", () => {
    expect(validateTaskDescription("x".repeat(2001)).description).toBeNull();
    expect(validateTaskDescription("x".repeat(2000)).description).toHaveLength(2000);
  });

  it("refuses a missing deadline", () => {
    for (const raw of ["", "   ", null, undefined]) {
      const result = validateTaskDeadline(raw, TODAY);
      expect(result.deadline).toBeNull();
      expect(result.error).toContain("hạn");
    }
  });

  it("refuses a day that has already passed", () => {
    const result = validateTaskDeadline("2026-09-06", TODAY);
    expect(result.deadline).toBeNull();
    expect(result.error).toContain("đã qua");
  });

  it("allows today — work promised for today is ordinary, not late", () => {
    expect(validateTaskDeadline(TODAY, TODAY)).toEqual({ deadline: TODAY, error: null });
  });

  it("allows any future day", () => {
    expect(validateTaskDeadline("2026-12-31", TODAY).deadline).toBe("2026-12-31");
  });
});

describe("validateTaskDraft", () => {
  const good = { title: "Gửi báo cáo", description: "Bản PDF, kèm số liệu tháng 8", deadline: "2026-09-20" };

  it("accepts a complete draft and returns the cleaned values", () => {
    const result = validateTaskDraft({ title: "  Gửi báo cáo ", description: "  Bản PDF ", deadline: "2026-09-20" }, TODAY);
    expect(result.error).toBeNull();
    expect(result.value).toEqual({
      title: "Gửi báo cáo",
      description: "Bản PDF",
      deadline: "2026-09-20",
      // Phase 3B's optional half: absent here, and absent means "that day, unfiled, once".
      deadlineTime: null,
      categoryId: null,
      isImportant: false,
      // Not estimated, which is the ordinary resting state — never zero.
      durationMinutes: null,
      recurrence: "none",
      recurrencePattern: null,
    });
  });

  it("reports the first missing part in reading order, one thing at a time", () => {
    expect(validateTaskDraft({ ...good, title: "" }, TODAY).error).toContain("Tên nhiệm vụ");
    expect(validateTaskDraft({ ...good, description: "" }, TODAY).error).toContain("Mô tả");
    expect(validateTaskDraft({ ...good, deadline: "" }, TODAY).error).toContain("hạn");
  });

  it("never returns a value alongside an error", () => {
    for (const draft of [
      { ...good, title: "" },
      { ...good, description: "" },
      { ...good, deadline: "" },
      { ...good, deadline: "2026-01-01" },
    ]) {
      const result = validateTaskDraft(draft, TODAY);
      expect(result.value).toBeNull();
      expect(result.error).not.toBeNull();
    }
  });

  it("keeps the submit button inert until all three fields carry something", () => {
    expect(isTaskDraftComplete(good)).toBe(true);
    expect(isTaskDraftComplete({ ...good, title: "  " })).toBe(false);
    expect(isTaskDraftComplete({ ...good, description: "" })).toBe(false);
    expect(isTaskDraftComplete({ ...good, deadline: "" })).toBe(false);
  });
});

describe("canConfirmSharedTask", () => {
  it("lets the peer confirm a pending shared task", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "pending_confirmation" });
    expect(canConfirmSharedTask(task, "u2")).toBe(true);
  });

  it("never lets the creator confirm their own shared task", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "pending_confirmation" });
    expect(canConfirmSharedTask(task, "u1")).toBe(false);
  });

  it("does not offer confirmation once the task is confirmed", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "confirmed" });
    expect(canConfirmSharedTask(task, "u2")).toBe(false);
  });

  it("never applies to personal tasks", () => {
    const task = makeTask({ type: "personal", creatorId: "u1", status: "pending_confirmation" });
    expect(canConfirmSharedTask(task, "u2")).toBe(false);
  });

  it("is false when nobody is signed in", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "pending_confirmation" });
    expect(canConfirmSharedTask(task, undefined)).toBe(false);
  });
});

describe("canMarkSharedDone", () => {
  it("lets the assignee claim a confirmed task is finished", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "confirmed" });
    expect(canMarkSharedDone(task, "u2")).toBe(true);
  });

  it("never lets the creator file the done claim — they are the reviewer", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "confirmed" });
    expect(canMarkSharedDone(task, "u1")).toBe(false);
  });

  it("is unavailable before the task is accepted", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "pending_confirmation" });
    expect(canMarkSharedDone(task, "u2")).toBe(false);
  });

  it("is unavailable once the claim is already filed", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "done_pending_review" });
    expect(canMarkSharedDone(task, "u2")).toBe(false);
  });

  it("is false when nobody is signed in", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "confirmed" });
    expect(canMarkSharedDone(task, undefined)).toBe(false);
  });
});

describe("canReviewSharedDone", () => {
  it("lets the creator review a filed claim", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "done_pending_review" });
    expect(canReviewSharedDone(task, "u1")).toBe(true);
  });

  it("never lets the assignee review their own claim", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "done_pending_review" });
    expect(canReviewSharedDone(task, "u2")).toBe(false);
  });

  it("has nothing to review before the assignee claims done", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "confirmed" });
    expect(canReviewSharedDone(task, "u1")).toBe(false);
  });

  it("is unavailable once the task is closed", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "done" });
    expect(canReviewSharedDone(task, "u1")).toBe(false);
  });

  it("never applies to personal tasks", () => {
    const task = makeTask({ type: "personal", creatorId: "u1", status: "done_pending_review" });
    expect(canReviewSharedDone(task, "u1")).toBe(false);
  });

  it("is false when nobody is signed in", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "done_pending_review" });
    expect(canReviewSharedDone(task, undefined)).toBe(false);
  });
});

describe("canReturnSharedTask", () => {
  it("gives the creator both answers to a claim: approve it, or send it back", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "done_pending_review" });
    expect(canReturnSharedTask(task, "u1")).toBe(true);
    expect(canReviewSharedDone(task, "u1")).toBe(true);
  });

  it("never lets the assignee send their own claim back", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: "u1", status: "done_pending_review" });
    expect(canReturnSharedTask(task, "u2")).toBe(false);
  });

  it("has nothing to send back before a claim exists, or after the task closes", () => {
    for (const status of ["pending_confirmation", "confirmed", "done"] as TaskItem["status"][]) {
      const task = makeTask({ type: "1-1-shared", creatorId: "u1", status });
      expect(canReturnSharedTask(task, "u1")).toBe(false);
    }
  });
});

describe("the two-step completion hand-off", () => {
  it("offers exactly one action to exactly one person at each step", () => {
    const creator = "u1";
    const assignee = "u2";
    const steps: { status: TaskItem["status"]; actor: string | null }[] = [
      { status: "pending_confirmation", actor: assignee },
      { status: "confirmed", actor: assignee },
      { status: "done_pending_review", actor: creator },
      { status: "done", actor: null },
    ];

    for (const step of steps) {
      const task = makeTask({ type: "1-1-shared", creatorId: creator, status: step.status });
      const actionsFor = (userId: string): number =>
        [canConfirmSharedTask, canMarkSharedDone, canReviewSharedDone].filter((can) => can(task, userId))
          .length;

      expect(actionsFor(creator) + actionsFor(assignee)).toBe(step.actor === null ? 0 : 1);
      if (step.actor) expect(actionsFor(step.actor)).toBe(1);
    }
  });
});

describe("deadlines", () => {
  it("counts whole calendar days, forwards and backwards", () => {
    expect(daysUntilDeadline("2026-09-07", TODAY)).toBe(0);
    expect(daysUntilDeadline("2026-09-10", TODAY)).toBe(3);
    expect(daysUntilDeadline("2026-09-05", TODAY)).toBe(-2);
  });

  it("counts across a month boundary", () => {
    expect(daysUntilDeadline("2026-10-01", "2026-09-30")).toBe(1);
  });

  it("treats an unparsable date as no deadline rather than crashing", () => {
    expect(daysUntilDeadline("07/09/2026", TODAY)).toBeNull();
    expect(deadlinePriority("not-a-date", TODAY)).toBe("none");
    expect(deadlineLabel("not-a-date", TODAY)).toBeNull();
  });

  it("sorts a day into one of four bands", () => {
    expect(deadlinePriority("2026-09-06", TODAY)).toBe("overdue");
    expect(deadlinePriority(TODAY, TODAY)).toBe("due_soon");
    expect(deadlinePriority("2026-09-09", TODAY)).toBe("due_soon");
    expect(deadlinePriority("2026-09-10", TODAY)).toBe("routine");
    expect(deadlinePriority(null, TODAY)).toBe("none");
  });

  it("keeps today out of the overdue band — a day is not late until it has passed", () => {
    expect(deadlinePriority(TODAY, TODAY)).not.toBe("overdue");
  });

  it("reads a task's deadline off the task itself", () => {
    expect(taskPriority(makeTask({ deadline: "2026-09-01" }), TODAY)).toBe("overdue");
    expect(taskPriority(makeTask({ deadline: null }), TODAY)).toBe("none");
  });

  it("says the deadline the way a person would", () => {
    expect(deadlineLabel("2026-09-06", TODAY)).toBe("Quá hạn 1 ngày");
    expect(deadlineLabel("2026-09-04", TODAY)).toBe("Quá hạn 3 ngày");
    expect(deadlineLabel(TODAY, TODAY)).toBe("Hôm nay");
    expect(deadlineLabel("2026-09-08", TODAY)).toBe("Mai");
    expect(deadlineLabel("2026-09-09", TODAY)).toBe("Còn 2 ngày");
    expect(deadlineLabel("2026-09-20", TODAY)).toBe("20/09");
    expect(deadlineLabel(null, TODAY)).toBeNull();
  });

  it("reports today in the viewer's own timezone, zero-padded", () => {
    expect(todayIso(new Date(2026, 8, 7))).toBe("2026-09-07");
    expect(todayIso(new Date(2026, 0, 1))).toBe("2026-01-01");
  });

  it("treats a blank date field as no deadline", () => {
    expect(normalizeDeadline("")).toBeNull();
    expect(normalizeDeadline("  ")).toBeNull();
    expect(normalizeDeadline(null)).toBeNull();
    expect(normalizeDeadline(undefined)).toBeNull();
    expect(normalizeDeadline("2026-09-20")).toBe("2026-09-20");
  });
});

describe("sortTasksByPriority", () => {
  it("reads late first, then nearly late, then scheduled, then undated", () => {
    const tasks = [
      makeTask({ id: "none", deadline: null }),
      makeTask({ id: "routine", deadline: "2026-09-30" }),
      makeTask({ id: "overdue", deadline: "2026-09-01" }),
      makeTask({ id: "soon", deadline: "2026-09-08" }),
    ];
    expect(sortTasksByPriority(tasks, TODAY).map((task) => task.id)).toEqual([
      "overdue",
      "soon",
      "routine",
      "none",
    ]);
  });

  it("puts the nearer deadline first inside a band", () => {
    const tasks = [
      makeTask({ id: "later", deadline: "2026-10-30" }),
      makeTask({ id: "sooner", deadline: "2026-09-20" }),
    ];
    expect(sortTasksByPriority(tasks, TODAY).map((task) => task.id)).toEqual(["sooner", "later"]);
  });

  it("sinks finished work below live work, however overdue it was", () => {
    const tasks = [
      makeTask({ id: "done-overdue", status: "done", deadline: "2026-08-01" }),
      makeTask({ id: "open-undated", status: "confirmed", deadline: null }),
    ];
    expect(sortTasksByPriority(tasks, TODAY).map((task) => task.id)).toEqual([
      "open-undated",
      "done-overdue",
    ]);
  });

  it("settles a dead heat by creation time, then id, so both people see one order", () => {
    const a = makeTask({ id: "a", deadline: "2026-09-20", createdAt: "2026-09-01T00:00:00Z" });
    const b = makeTask({ id: "b", deadline: "2026-09-20", createdAt: "2026-09-01T00:00:00Z" });
    expect(compareTaskPriority(a, b, TODAY)).toBeLessThan(0);
    expect(compareTaskPriority(b, a, TODAY)).toBeGreaterThan(0);
    expect(compareTaskPriority(a, a, TODAY)).toBe(0);
  });

  it("leaves the caller's array untouched", () => {
    const tasks = [makeTask({ id: "b", deadline: null }), makeTask({ id: "a", deadline: "2026-09-01" })];
    sortTasksByPriority(tasks, TODAY);
    expect(tasks.map((task) => task.id)).toEqual(["b", "a"]);
  });
});

describe("highestOpenPriority", () => {
  it("reports the most pressing open task, which is what colours a collapsed branch", () => {
    const tasks = [
      makeTask({ id: "a", deadline: "2026-09-30" }),
      makeTask({ id: "b", deadline: "2026-09-01" }),
    ];
    expect(highestOpenPriority(tasks, TODAY)).toBe("overdue");
  });

  it("ignores finished work, so a closed overdue task stops shouting", () => {
    const tasks = [
      makeTask({ id: "a", status: "done", deadline: "2026-09-01" }),
      makeTask({ id: "b", status: "confirmed", deadline: "2026-09-30" }),
    ];
    expect(highestOpenPriority(tasks, TODAY)).toBe("routine");
  });

  it("is 'none' when nothing is open", () => {
    expect(highestOpenPriority([makeTask({ status: "done", deadline: "2026-09-01" })], TODAY)).toBe("none");
    expect(highestOpenPriority([], TODAY)).toBe("none");
  });
});

describe("needsAttention", () => {
  const creator = "u1";
  const assignee = "u2";

  it("opens a branch for the person whose move it is", () => {
    const pending = makeTask({ type: "1-1-shared", creatorId: creator, status: "pending_confirmation" });
    expect(needsAttention(pending, assignee, TODAY)).toBe(true);
    expect(needsAttention(pending, creator, TODAY)).toBe(false);

    const review = makeTask({ type: "1-1-shared", creatorId: creator, status: "done_pending_review" });
    expect(needsAttention(review, creator, TODAY)).toBe(true);
    expect(needsAttention(review, assignee, TODAY)).toBe(false);
  });

  it("opens a branch for overdue work even when nobody has a button to press", () => {
    const task = makeTask({ type: "personal", creatorId: creator, deadline: "2026-09-01" });
    expect(needsAttention(task, creator, TODAY)).toBe(true);
  });

  it("stays quiet about finished and binned work", () => {
    expect(needsAttention(makeTask({ status: "done", deadline: "2026-09-01" }), "u1", TODAY)).toBe(false);
    expect(
      needsAttention(makeTask({ deadline: "2026-09-01", deletedByCreator: true }), "u1", TODAY),
    ).toBe(false);
  });
});

describe("the number on the Nhiệm vụ badge", () => {
  const me = "u1";
  const them = "u2";

  it("counts only what is late or waiting on this person", () => {
    const count = countTasksNeedingAttention(
      [
        makeTask({ id: "late", creatorId: me, deadline: "2026-09-01" }),
        makeTask({ id: "mine-to-accept", type: "1-1-shared", creatorId: them, status: "pending_confirmation" }),
        makeTask({ id: "just-scheduled", creatorId: me, deadline: "2026-12-01" }),
        makeTask({ id: "no-deadline", creatorId: me }),
      ],
      me,
      TODAY,
    );
    expect(count).toBe(2);
  });

  it("goes out entirely when nothing is asking — a badge always lit says nothing", () => {
    const calm = [
      makeTask({ id: "a", creatorId: me, deadline: "2026-12-01" }),
      makeTask({ id: "b", creatorId: me }),
      makeTask({ id: "c", creatorId: me, status: "done", deadline: "2026-09-01" }),
    ];
    expect(countTasksNeedingAttention(calm, me, TODAY)).toBe(0);
    expect(countTasksNeedingAttention([], me, TODAY)).toBe(0);
  });

  it("does not count what is waiting on somebody else", () => {
    const theirMove = makeTask({
      type: "1-1-shared",
      creatorId: me,
      assigneeId: them,
      status: "pending_confirmation",
    });
    expect(countTasksNeedingAttention([theirMove], me, TODAY)).toBe(0);
    expect(countTasksNeedingAttention([theirMove], them, TODAY)).toBe(1);
  });

  it("leaves out work this person has binned", () => {
    const binned = makeTask({ creatorId: me, deadline: "2026-09-01", deletedByCreator: true });
    expect(countTasksNeedingAttention([binned], me, TODAY)).toBe(0);
  });
});

describe("the bin", () => {
  const creator = "u1";
  const peer = "u2";
  const shared = (overrides: Partial<TaskItem>): TaskItem =>
    makeTask({ type: "1-1-shared", conversationId: "c1", creatorId: creator, ...overrides });

  it("gives each side of a shared task its own bin", () => {
    const task = shared({ deletedByCreator: true });
    expect(isDeletedFor(task, creator)).toBe(true);
    expect(isDeletedFor(task, peer)).toBe(false);
  });

  it("tells the surviving party that the other side let go", () => {
    const task = shared({ deletedByCreator: true });
    expect(isDeletedByOther(task, peer)).toBe(true);
    expect(deletedByOtherNote(task, peer)).toBe("Người giao đã xoá");

    const dropped = shared({ deletedByPeer: true });
    expect(isDeletedByOther(dropped, creator)).toBe(true);
    expect(deletedByOtherNote(dropped, creator)).toBe("Người nhận đã xoá");
  });

  it("never claims the other side deleted a personal task — there is no other side", () => {
    const task = makeTask({ type: "personal", deletedByCreator: true });
    expect(isDeletedByOther(task, creator)).toBe(false);
  });

  it("knows a row is gone from the database once both sides delete it", () => {
    expect(isTaskGone(shared({ deletedByCreator: true, deletedByPeer: true }))).toBe(true);
    expect(isTaskGone(shared({ deletedByCreator: true }))).toBe(false);
  });

  it("splits the list into what is kept and what is binned, per person", () => {
    const tasks = [
      shared({ id: "a" }),
      shared({ id: "b", deletedByCreator: true }),
      shared({ id: "c", deletedByPeer: true }),
      shared({ id: "d", deletedByCreator: true, deletedByPeer: true }),
    ];

    const forCreator = partitionByBin(tasks, creator);
    expect(forCreator.kept.map((task) => task.id)).toEqual(["a", "c"]);
    expect(forCreator.binned.map((task) => task.id)).toEqual(["b"]);

    const forPeer = partitionByBin(tasks, peer);
    expect(forPeer.kept.map((task) => task.id)).toEqual(["a", "b"]);
    expect(forPeer.binned.map((task) => task.id)).toEqual(["c"]);
  });

  it("drops a doubly-deleted row from both lists, since it no longer exists", () => {
    const gone = shared({ id: "d", deletedByCreator: true, deletedByPeer: true });
    for (const viewer of [creator, peer]) {
      const split = partitionByBin([gone], viewer);
      expect(split.kept).toEqual([]);
      expect(split.binned).toEqual([]);
    }
  });

  it("offers 'Xoá hẳn' only where one person owns the row outright", () => {
    expect(canPurgeTask(makeTask({ type: "personal" }))).toBe(true);
    expect(canPurgeTask(shared({}))).toBe(false);
  });
});

describe("canDeleteTask", () => {
  const creator = "u1";
  const assignee = "u2";
  const at = (status: TaskItem["status"]): TaskItem =>
    makeTask({ type: "1-1-shared", conversationId: "c1", creatorId: creator, status });

  it("lets the creator withdraw their own request at any point", () => {
    for (const status of [
      "pending_confirmation",
      "confirmed",
      "done_pending_review",
      "done",
    ] as TaskItem["status"][]) {
      expect(canDeleteTask(at(status), creator)).toBe(true);
    }
  });

  it("refuses the assignee any way to make unfinished work disappear", () => {
    expect(canDeleteTask(at("pending_confirmation"), assignee)).toBe(false);
    expect(canDeleteTask(at("confirmed"), assignee)).toBe(false);
  });

  it("still refuses right after the assignee claims done — a claim is not a confirmation", () => {
    expect(canDeleteTask(at("done_pending_review"), assignee)).toBe(false);
  });

  it("lets the assignee clear the task once the creator has confirmed it", () => {
    expect(canDeleteTask(at("done"), assignee)).toBe(true);
  });

  it("leaves a personal task entirely to its owner, at any status", () => {
    expect(canDeleteTask(makeTask({ type: "personal", creatorId: creator }), creator)).toBe(true);
    expect(
      canDeleteTask(makeTask({ type: "personal", creatorId: creator, status: "done" }), creator),
    ).toBe(true);
    expect(canDeleteTask(makeTask({ type: "personal", creatorId: creator }), assignee)).toBe(false);
  });

  it("offers nothing to a signed-out viewer", () => {
    expect(canDeleteTask(at("done"), undefined)).toBe(false);
  });
});

describe("deleteIsPermanent", () => {
  const creator = "u1";
  const assignee = "u2";
  const at = (status: TaskItem["status"]): TaskItem =>
    makeTask({ type: "1-1-shared", conversationId: "c1", creatorId: creator, status });

  it("warns the creator that withdrawing an unaccepted request destroys it", () => {
    expect(deleteIsPermanent(at("pending_confirmation"), creator)).toBe(true);
  });

  it("is an ordinary bin once the other person has taken the task on", () => {
    for (const status of ["confirmed", "done_pending_review", "done"] as TaskItem["status"][]) {
      expect(deleteIsPermanent(at(status), creator)).toBe(false);
    }
  });

  it("never applies to the assignee, who has no unaccepted request to withdraw", () => {
    expect(deleteIsPermanent(at("pending_confirmation"), assignee)).toBe(false);
    expect(deleteIsPermanent(at("done"), assignee)).toBe(false);
  });

  it("never applies to a personal task, which has its own bin and its own 'Xoá hẳn'", () => {
    expect(deleteIsPermanent(makeTask({ type: "personal", status: "pending_confirmation" }), creator)).toBe(
      false,
    );
  });
});

describe("groupSharedByConversation", () => {
  it("groups shared tasks by conversation in arrival order", () => {
    const groups = groupSharedByConversation([
      makeTask({ id: "a", type: "1-1-shared", conversationId: "conv-1" }),
      makeTask({ id: "b", type: "1-1-shared", conversationId: "conv-2" }),
      makeTask({ id: "c", type: "1-1-shared", conversationId: "conv-1" }),
    ]);
    expect(groups.map((group) => group.conversationId)).toEqual(["conv-1", "conv-2"]);
    expect(groups[0]?.tasks.map((task) => task.id)).toEqual(["a", "c"]);
  });

  it("skips personal tasks", () => {
    expect(groupSharedByConversation([makeTask({ type: "personal" })])).toEqual([]);
  });

  it("skips shared tasks without a conversation", () => {
    expect(groupSharedByConversation([makeTask({ type: "1-1-shared", conversationId: null })])).toEqual([]);
  });
});

const ALL_STATUSES: TaskItem["status"][] = [
  "pending_confirmation",
  "confirmed",
  "done_pending_review",
  "done",
];

describe("taskStatusLabel", () => {
  it("labels acceptance with nhận việc wording", () => {
    expect(taskStatusLabel("pending_confirmation")).toBe("Chờ nhận việc");
    expect(taskStatusLabel("confirmed")).toBe("Đã nhận việc");
  });

  it("labels completion with hoàn thành wording", () => {
    expect(taskStatusLabel("done_pending_review")).toBe("Chờ xác nhận hoàn thành");
    expect(taskStatusLabel("done")).toBe("Đã hoàn thành");
  });

  it("never prints one phrase for two different states", () => {
    const labels = ALL_STATUSES.map(taskStatusLabel);
    expect(new Set(labels).size).toBe(ALL_STATUSES.length);
  });

  it("never labels an accepted task with the word hoàn thành, nor a finished one with nhận việc", () => {
    expect(taskStatusLabel("confirmed")).not.toContain("hoàn thành");
    expect(taskStatusLabel("done")).not.toContain("nhận việc");
  });
});

describe("countOpenTasks", () => {
  it("counts the three unfinished states and excludes done", () => {
    expect(isOpenTask(makeTask({ status: "pending_confirmation" }))).toBe(true);
    expect(isOpenTask(makeTask({ status: "confirmed" }))).toBe(true);
    expect(isOpenTask(makeTask({ status: "done_pending_review" }))).toBe(true);
    expect(isOpenTask(makeTask({ status: "done" }))).toBe(false);
  });

  it("holds the count steady through accepting and reporting done, then drops it on confirmation", () => {
    const stages: TaskItem["status"][] = ["pending_confirmation", "confirmed", "done_pending_review"];
    for (const status of stages) {
      expect(countOpenTasks([makeTask({ id: "t1", status })])).toBe(1);
    }
    expect(countOpenTasks([makeTask({ id: "t1", status: "done" })])).toBe(0);
  });

  it("counts personal and shared tasks the same way", () => {
    const tasks = [
      makeTask({ id: "p1", type: "personal", status: "confirmed" }),
      makeTask({ id: "p2", type: "personal", status: "done" }),
      makeTask({ id: "s1", type: "1-1-shared", status: "pending_confirmation" }),
      makeTask({ id: "s2", type: "1-1-shared", status: "done_pending_review" }),
      makeTask({ id: "s3", type: "1-1-shared", status: "done" }),
    ];
    expect(countOpenTasks(tasks)).toBe(3);
  });

  it("is zero for an empty list", () => {
    expect(countOpenTasks([])).toBe(0);
  });

  it("leaves out what this person has binned, but still counts it for the other side", () => {
    const tasks = [
      makeTask({ id: "a", type: "1-1-shared", creatorId: "u1", status: "confirmed" }),
      makeTask({
        id: "b",
        type: "1-1-shared",
        creatorId: "u1",
        status: "confirmed",
        deletedByCreator: true,
      }),
    ];
    expect(countOpenTasks(tasks, "u1")).toBe(1);
    expect(countOpenTasks(tasks, "u2")).toBe(2);
  });

  it("never counts a row both sides deleted, whoever is looking", () => {
    const gone = makeTask({
      id: "a",
      type: "1-1-shared",
      creatorId: "u1",
      status: "confirmed",
      deletedByCreator: true,
      deletedByPeer: true,
    });
    expect(countOpenTasks([gone], "u1")).toBe(0);
    expect(countOpenTasks([gone], "u2")).toBe(0);
    expect(countOpenTasks([gone])).toBe(0);
  });

  it("sums per-conversation counts to the section total", () => {
    const tasks = [
      makeTask({ id: "a1", type: "1-1-shared", conversationId: "c1", status: "confirmed" }),
      makeTask({ id: "a2", type: "1-1-shared", conversationId: "c1", status: "done" }),
      makeTask({ id: "b1", type: "1-1-shared", conversationId: "c2", status: "done_pending_review" }),
    ];
    const groups = groupSharedByConversation(tasks);
    const perGroup = groups.reduce((total, group) => total + countOpenTasks(group.tasks), 0);
    expect(perGroup).toBe(countOpenTasks(tasks));
    expect(perGroup).toBe(2);
  });
});

describe("sharedTaskNote", () => {
  const creator = "u1";
  const assignee = "u2";

  it("tells the assignee it is the creator's turn once they report it done", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: creator, status: "done_pending_review" });
    expect(sharedTaskNote(task, assignee)).toBe("Chờ người giao xác nhận hoàn thành");
  });

  it("tells the creator the turn is theirs", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: creator, status: "done_pending_review" });
    expect(sharedTaskNote(task, creator)).toBe("Chờ bạn xác nhận hoàn thành");
  });

  it("shows the finished wording to both sides once closed", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: creator, status: "done" });
    expect(sharedTaskNote(task, creator)).toBe("Đã hoàn thành");
    expect(sharedTaskNote(task, assignee)).toBe("Đã hoàn thành");
  });

  it("says the task is taken on, not finished, while it is being worked", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: creator, status: "confirmed" });
    expect(sharedTaskNote(task, creator)).toBe("Đã nhận việc");
    expect(sharedTaskNote(task, assignee)).toBe("Đã nhận việc");
  });

  it("never reuses the finished wording for a task still awaiting review", () => {
    const review = makeTask({ type: "1-1-shared", creatorId: creator, status: "done_pending_review" });
    const closed = makeTask({ type: "1-1-shared", creatorId: creator, status: "done" });
    for (const viewer of [creator, assignee]) {
      expect(sharedTaskNote(review, viewer)).not.toBe(sharedTaskNote(closed, viewer));
    }
  });

  it("points at the right person while the task is still unclaimed", () => {
    const task = makeTask({ type: "1-1-shared", creatorId: creator, status: "pending_confirmation" });
    expect(sharedTaskNote(task, creator)).toBe("Chờ nhận việc");
    expect(sharedTaskNote(task, assignee)).toBe("Chờ bạn nhận việc");
  });

  it("never leaves a task without a note", () => {
    for (const status of ALL_STATUSES) {
      const task = makeTask({ type: "1-1-shared", creatorId: creator, status });
      for (const viewer of [creator, assignee, undefined]) {
        expect(sharedTaskNote(task, viewer).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("upsertTask", () => {
  it("inserts an arriving task in created_at order, not at the end", () => {
    const list = [
      makeTask({ id: "a", createdAt: "2026-09-01T00:00:00Z" }),
      makeTask({ id: "c", createdAt: "2026-09-03T00:00:00Z" }),
    ];
    const next = upsertTask(list, makeTask({ id: "b", createdAt: "2026-09-02T00:00:00Z" }));
    expect(next.map((task) => task.id)).toEqual(["a", "b", "c"]);
  });

  it("replaces an existing task instead of duplicating it", () => {
    const list = [makeTask({ id: "a", status: "pending_confirmation" })];
    const next = upsertTask(list, makeTask({ id: "a", status: "confirmed" }));
    expect(next).toHaveLength(1);
    expect(next[0]?.status).toBe("confirmed");
  });

  it("keeps the same array reference when the row is unchanged", () => {
    const list = [makeTask({ id: "a", status: "confirmed" })];
    expect(upsertTask(list, makeTask({ id: "a", status: "confirmed" }))).toBe(list);
  });

  it("carries done_at through to the cache when a task is finished", () => {
    const list = [makeTask({ id: "a", type: "1-1-shared", status: "confirmed" })];
    const next = upsertTask(
      list,
      makeTask({ id: "a", type: "1-1-shared", status: "done", doneAt: "2026-09-07T10:00:00Z" }),
    );
    expect(next[0]?.doneAt).toBe("2026-09-07T10:00:00Z");
  });

  it("repaints the row when a deadline or a delete flag is all that changed", () => {
    const list = [makeTask({ id: "a", deadline: null })];
    const dated = upsertTask(list, makeTask({ id: "a", deadline: "2026-09-20" }));
    expect(dated).not.toBe(list);
    expect(dated[0]?.deadline).toBe("2026-09-20");

    const binned = upsertTask(dated, makeTask({ id: "a", deadline: "2026-09-20", deletedByCreator: true }));
    expect(binned).not.toBe(dated);
    expect(binned[0]?.deletedByCreator).toBe(true);
  });

  it("repaints the row when only the review stamp lands", () => {
    const list = [
      makeTask({ id: "a", type: "1-1-shared", status: "done_pending_review", doneAt: "2026-09-07T10:00:00Z" }),
    ];
    const next = upsertTask(
      list,
      makeTask({
        id: "a",
        type: "1-1-shared",
        status: "done",
        doneAt: "2026-09-07T10:00:00Z",
        completedConfirmedAt: "2026-09-07T11:00:00Z",
      }),
    );
    expect(next).not.toBe(list);
    expect(next[0]?.status).toBe("done");
    expect(next[0]?.completedConfirmedAt).toBe("2026-09-07T11:00:00Z");
  });

  it("breaks created_at ties by id so both parties see the same order", () => {
    const list = [makeTask({ id: "b", createdAt: "2026-09-01T00:00:00Z" })];
    const next = upsertTask(list, makeTask({ id: "a", createdAt: "2026-09-01T00:00:00Z" }));
    expect(next.map((task) => task.id)).toEqual(["a", "b"]);
  });
});

describe("removeTask", () => {
  it("drops the task with the given id", () => {
    const list = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    expect(removeTask(list, "a").map((task) => task.id)).toEqual(["b"]);
  });

  it("keeps the same reference when the id is unknown", () => {
    const list = [makeTask({ id: "a" })];
    expect(removeTask(list, "zzz")).toBe(list);
  });
});

describe("taskFromRealtimeRow", () => {
  it("normalises raw Postgres timestamps from the socket to ISO instants", () => {
    const task = taskFromRealtimeRow({
      id: "a",
      type: "1-1-shared",
      creator_id: "u1",
      conversation_id: "conv-1",
      title: "Cùng làm",
      description: "Cùng rà soát số liệu tháng 8",
      status: "confirmed",
      confirmed_at: "2026-09-07 10:00:00",
      confirmed_by: "u2",
      assignee_id: "u2",
      done_at: null,
      completed_confirmed_at: null,
      skipped_at: null,
      skipped_silently: false,
      context_snapshot: null,
      task_list_id: null,
      objective_id: null,
      deliverable_id: null,
      deadline_date: "2026-09-20",
      deadline_time: null,
      deadline_tz: "Asia/Ho_Chi_Minh",
      task_category_id: null,
      is_important: false,
      is_milestone: false,
      progress_percent: null,
      output_value: null,
      recurrence: "none",
      recurrence_pattern: null,
      recurrence_spawned_at: null,
      recurrence_origin_id: null,
      deleted_by_creator: false,
      deleted_by_peer: false,
      created_at: "2026-09-07 09:00:00",
      updated_at: "2026-09-07 10:00:00",
    });

    expect(task.createdAt.endsWith("Z")).toBe(true);
    expect(Number.isNaN(Date.parse(task.createdAt))).toBe(false);
    expect(task.confirmedAt?.endsWith("Z")).toBe(true);
    expect(task.doneAt).toBeNull();
    expect(task.conversationId).toBe("conv-1");
    expect(task.status).toBe("confirmed");
    expect(task.completedConfirmedAt).toBeNull();
    // A deadline is a calendar day, so it must survive the socket unchanged — no zone shifting.
    expect(task.deadline).toBe("2026-09-20");
    expect(task.description).toBe("Cùng rà soát số liệu tháng 8");
    expect(task.deletedByCreator).toBe(false);
    expect(task.deletedByPeer).toBe(false);
  });

  it("normalises the review stamp when the creator closes the task", () => {
    const task = taskFromRealtimeRow({
      id: "a",
      type: "1-1-shared",
      creator_id: "u1",
      conversation_id: "conv-1",
      title: "Cùng làm",
      description: "Cùng rà soát số liệu tháng 8",
      status: "done",
      confirmed_at: "2026-09-07 10:00:00",
      confirmed_by: "u2",
      assignee_id: "u2",
      done_at: "2026-09-07 11:00:00",
      completed_confirmed_at: "2026-09-07 12:00:00",
      skipped_at: null,
      skipped_silently: false,
      context_snapshot: null,
      task_list_id: null,
      objective_id: null,
      deliverable_id: null,
      deadline_date: null,
      deadline_time: null,
      deadline_tz: "Asia/Ho_Chi_Minh",
      task_category_id: null,
      is_important: false,
      is_milestone: false,
      progress_percent: null,
      output_value: null,
      recurrence: "none",
      recurrence_pattern: null,
      recurrence_spawned_at: null,
      recurrence_origin_id: null,
      deleted_by_creator: false,
      deleted_by_peer: true,
      created_at: "2026-09-07 09:00:00",
      updated_at: "2026-09-07 12:00:00",
    });

    expect(task.status).toBe("done");
    expect(task.completedConfirmedAt?.endsWith("Z")).toBe(true);
    expect(Number.isNaN(Date.parse(task.completedConfirmedAt ?? ""))).toBe(false);
    expect(task.deadline).toBeNull();
    expect(task.deletedByPeer).toBe(true);
  });
});

describe("toVietnameseTaskError", () => {
  it("explains the self-confirmation block", () => {
    expect(toVietnameseTaskError("P0001", "avora_task_self_confirm")).toContain(
      "không thể tự xác nhận",
    );
  });

  it("explains completing an unconfirmed shared task", () => {
    expect(toVietnameseTaskError("P0001", "avora_task_not_confirmed")).toContain(
      "chưa được xác nhận",
    );
  });

  it("tells the creator that only the assignee reports the work finished", () => {
    expect(toVietnameseTaskError("P0001", "avora_task_only_assignee_marks_done")).toContain(
      "Chỉ người nhận việc",
    );
  });

  it("tells the assignee that only the creator approves completion", () => {
    expect(toVietnameseTaskError("P0001", "avora_task_only_creator_reviews")).toContain(
      "Chỉ người giao việc",
    );
  });

  it("says why the person doing the work cannot delete it yet, and whose word closes it", () => {
    expect(toVietnameseTaskError("P0001", "avora_task_assignee_delete_requires_done")).toBe(
      "Chỉ có thể xoá khi người giao xác nhận việc đã hoàn thành.",
    );
  });

  it("explains a task sent without a description or a deadline", () => {
    expect(toVietnameseTaskError("P0001", "avora_task_description_required")).toContain("bắt buộc");
    expect(toVietnameseTaskError("P0001", "avora_task_description_max_len")).toContain("2000");
    expect(toVietnameseTaskError("P0001", "avora_task_deadline_required")).toContain("hạn");
    expect(toVietnameseTaskError("P0001", "avora_task_deadline_past")).toContain("đã qua");
  });

  it("tells the assignee that only the creator can send work back", () => {
    expect(toVietnameseTaskError("P0001", "avora_task_only_creator_returns")).toContain("trả việc");
  });

  it("explains approving a task nobody has reported finished", () => {
    expect(toVietnameseTaskError("P0001", "avora_task_not_awaiting_review")).toContain(
      "chưa được báo xong",
    );
  });

  it("explains a blank title", () => {
    expect(toVietnameseTaskError("P0001", "avora_task_title_blank")).toContain("không được để trống");
  });

  it("explains a too-long title", () => {
    expect(toVietnameseTaskError("P0001", "avora_task_title_max_len")).toContain("200");
  });

  it("explains a permission denial by code", () => {
    expect(toVietnameseTaskError("42501", "new row violates row-level security policy")).toContain(
      "Máy chủ chưa cho phép",
    );
  });

  it("explains a lost connection", () => {
    expect(toVietnameseTaskError(undefined, "Failed to fetch")).toContain("Không kết nối được máy chủ");
  });

  it("falls back to a plain message for anything unrecognised", () => {
    expect(toVietnameseTaskError(undefined, "database explosion")).toBe("Có lỗi xảy ra. Vui lòng thử lại.");
  });
});
