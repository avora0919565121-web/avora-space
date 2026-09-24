import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  TASK_VOICE_HINT,
  TASK_VOICE_TITLE_CLASS,
  taskVoice,
  type TaskVoice,
} from "@/lib/task-voice";
import {
  groupTasksByDeadlineDay,
  sortTasksByPriority,
  taskTier,
  type TaskItem,
} from "@/lib/tasks";

const ME = "u-me";
const PEER = "u-peer";
const OTHER = "u-other";

function makeTask(overrides: Partial<TaskItem> & { id: string }): TaskItem {
  return {
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
    deadline: "2026-09-20",
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

describe("whose move it is", () => {
  it("a personal task is always the reader's own", () => {
    expect(taskVoice(makeTask({ id: "a" }), ME)).toBe("mine");
  });

  it("work this person was asked to carry is theirs to do", () => {
    const task = makeTask({
      id: "b",
      type: "1-1-shared",
      creatorId: PEER,
      assigneeId: ME,
      conversationId: "conv-1",
    });
    expect(taskVoice(task, ME)).toBe("mine");
  });

  it("work this person asked for belongs to somebody else", () => {
    const task = makeTask({
      id: "c",
      type: "1-1-shared",
      creatorId: ME,
      assigneeId: PEER,
      conversationId: "conv-1",
    });
    expect(taskVoice(task, ME)).toBe("theirs");
  });

  it("an older 1-1 row with no named assignee still reads from both sides", () => {
    const task = makeTask({
      id: "d",
      type: "1-1-shared",
      creatorId: PEER,
      assigneeId: null,
      conversationId: "conv-1",
    });
    expect(taskVoice(task, ME)).toBe("mine");
    expect(taskVoice(task, PEER)).toBe("theirs");
  });

  it("a group task asked of another member is not the reader's move", () => {
    const task = makeTask({
      id: "e",
      type: "group-shared",
      creatorId: PEER,
      assigneeId: OTHER,
      conversationId: "conv-group",
    });
    expect(taskVoice(task, ME)).toBe("theirs");
    expect(taskVoice(task, OTHER)).toBe("mine");
  });

  it("with nobody signed in, no task is claimed as the reader's", () => {
    expect(taskVoice(makeTask({ id: "f" }), undefined)).toBe("theirs");
    expect(
      taskVoice(
        makeTask({ id: "g", type: "1-1-shared", creatorId: PEER, conversationId: "conv-1" }),
        undefined,
      ),
    ).toBe("theirs");
  });
});

describe("the voice is not the tier", () => {
  it("two tasks in the same tier can be in different hands", () => {
    // Both are "somebody else asked me" — tier 1 — but only one names this person.
    const mine = makeTask({
      id: "h",
      type: "group-shared",
      creatorId: PEER,
      assigneeId: ME,
      conversationId: "conv-group",
    });
    const theirs = makeTask({
      id: "i",
      type: "group-shared",
      creatorId: PEER,
      assigneeId: OTHER,
      conversationId: "conv-group",
    });
    expect(taskTier(mine, ME)).toBe(taskTier(theirs, ME));
    expect(taskVoice(mine, ME)).not.toBe(taskVoice(theirs, ME));
  });

  it("one voice can span two tiers", () => {
    const own = makeTask({ id: "j" });
    const asked = makeTask({
      id: "k",
      type: "1-1-shared",
      creatorId: PEER,
      assigneeId: ME,
      conversationId: "conv-1",
    });
    expect(taskTier(own, ME)).not.toBe(taskTier(asked, ME));
    expect(taskVoice(own, ME)).toBe(taskVoice(asked, ME));
  });
});

describe("how a row is set", () => {
  it("the reader's work is ink at semibold, other people's is lighter and italic", () => {
    expect(TASK_VOICE_TITLE_CLASS.mine).toContain("font-semibold");
    expect(TASK_VOICE_TITLE_CLASS.mine).toContain("text-foreground");
    expect(TASK_VOICE_TITLE_CLASS.theirs).toContain("italic");
    expect(TASK_VOICE_TITLE_CLASS.theirs).toContain("text-muted-foreground");
  });

  it("the lighter style never borrows the strike-through of a finished task", () => {
    expect(TASK_VOICE_TITLE_CLASS.theirs).not.toContain("line-through");
  });

  it("both voices say in words what the weight only hints at", () => {
    const voices: readonly TaskVoice[] = ["mine", "theirs"];
    for (const voice of voices) expect(TASK_VOICE_HINT[voice].trim().length).toBeGreaterThan(0);
    expect(TASK_VOICE_HINT.mine).not.toBe(TASK_VOICE_HINT.theirs);
  });
});

describe("showing whose work it is changes nothing about the order", () => {
  const today = "2026-09-15";
  const tasks = [
    makeTask({ id: "late", deadline: "2026-09-10" }),
    makeTask({
      id: "mine-soon",
      type: "1-1-shared",
      creatorId: PEER,
      assigneeId: ME,
      conversationId: "conv-1",
      deadline: "2026-09-16",
    }),
    makeTask({
      id: "theirs-soon",
      type: "1-1-shared",
      creatorId: ME,
      assigneeId: PEER,
      conversationId: "conv-1",
      deadline: "2026-09-16",
    }),
    makeTask({ id: "undated", deadline: null }),
  ];

  it("the deadline still decides, not the voice", () => {
    const order = sortTasksByPriority(tasks, today, ME).map((task) => task.id);
    expect(order[0]).toBe("late");
    expect(order[order.length - 1]).toBe("undated");
    // Same day, so the existing tie-break decides and the voice does not touch it: work
    // somebody else is waiting on ranks above work this person merely asked for.
    expect(order.indexOf("mine-soon")).toBeLessThan(order.indexOf("theirs-soon"));
  });

  it("nothing is filtered out — other people's work stays in the day it is due", () => {
    const groups = groupTasksByDeadlineDay(tasks, today, ME);
    const ids = groups.flatMap((group) => group.tasks.map((task) => task.id));
    expect(ids).toHaveLength(tasks.length);
    expect(ids).toContain("theirs-soon");
  });
});
