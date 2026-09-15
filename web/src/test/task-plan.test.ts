import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the modules pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  dependenciesOf,
  dependencyCandidates,
  dependentsOf,
  removeDependency,
  toVietnameseDependencyError,
  upsertDependency,
  wouldCycle,
  type TaskDependency,
} from "@/lib/task-dependencies";
import {
  canStartTask,
  formatProgress,
  isStartedFor,
  parseProgressInput,
  startedAtFor,
  toVietnameseTaskError,
  type TaskFlagIndex,
  type TaskFlagValue,
  type TaskItem,
} from "@/lib/tasks";

const ME = "u-me";
const PEER = "u-peer";

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
    progressPercent: null,
    recurrence: "none",
    recurrencePattern: null,
    recurrenceSpawnedAt: null,
    deletedByCreator: false,
    deletedByPeer: false,
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

function link(taskId: string, dependsOnTaskId: string): TaskDependency {
  return { taskId, dependsOnTaskId, createdBy: ME, createdAt: "2026-09-01T00:00:00Z" };
}

describe("progress is optional, and empty is not zero", () => {
  /**
   * The distinction the whole field rests on: a task nobody has estimated is not a task
   * somebody reported as untouched. Collapsing the two would turn every new task into a
   * public claim of 0% done.
   */
  it("reads an empty box as not tracked rather than as no progress", () => {
    expect(parseProgressInput("")).toBeNull();
    expect(parseProgressInput("   ")).toBeNull();
    expect(parseProgressInput("0")).toBe(0);
    expect(formatProgress(null)).toBeNull();
    expect(formatProgress(0)).toBe("0%");
  });

  it("keeps the whole range and refuses anything outside it", () => {
    expect(parseProgressInput("100")).toBe(100);
    expect(parseProgressInput("101")).toBeNull();
    expect(parseProgressInput("-1")).toBeNull();
    expect(parseProgressInput("abc")).toBeNull();
  });

  it("says the same thing about a bad percentage however the refusal arrives", () => {
    // The RPC name and the table constraint name are different strings for one rule; a
    // person who typed 150 should not get two different explanations of it.
    expect(toVietnameseTaskError("P0001", "avora_task_progress_range")).toContain("0 đến 100");
    expect(toVietnameseTaskError("23514", "tasks_progress_percent_range")).toContain("0 đến 100");
  });
});

describe("a milestone is a property of a task, starting is a property of a person", () => {
  it("leaves a new task with neither flag set", () => {
    const task = makeTask({ id: "t1" });
    expect(task.isMilestone).toBe(false);
    expect(task.progressPercent).toBeNull();
  });

  /**
   * The reason started_at lives on task_flags and not on tasks: two people carry the same
   * shared task, and one of them picking it up says nothing about the other.
   */
  it("lets one person have a shared task underway while the other has not", () => {
    const mine = flagsFor({ shared: { startedAt: "2026-09-10T08:00:00Z" } });
    const theirs = flagsFor({ shared: {} });

    expect(isStartedFor(mine, "shared")).toBe(true);
    expect(isStartedFor(theirs, "shared")).toBe(false);
    expect(startedAtFor(mine, "shared")).toBe("2026-09-10T08:00:00Z");
    expect(startedAtFor(theirs, "shared")).toBeNull();
  });

  it("treats an absent row as not started, never as unknown", () => {
    expect(isStartedFor(flagsFor({}), "t1")).toBe(false);
    expect(startedAtFor(flagsFor({}), "t1")).toBeNull();
  });

  /**
   * Starting is about live work. A suggestion has not been agreed to, and something already
   * filed done or declined has nothing left to pick up.
   */
  it("only offers to start work that is actually live", () => {
    expect(canStartTask(makeTask({ id: "t1", status: "confirmed" }))).toBe(true);
    expect(canStartTask(makeTask({ id: "t1", status: "pending_confirmation" }))).toBe(false);
    expect(canStartTask(makeTask({ id: "t1", status: "done_pending_review" }))).toBe(false);
    expect(canStartTask(makeTask({ id: "t1", status: "done" }))).toBe(false);
    expect(canStartTask(makeTask({ id: "t1", status: "skipped" }))).toBe(false);
  });
});

describe("dependencies read from both ends", () => {
  const links = [link("b", "a"), link("c", "a"), link("b", "x")];

  it("says what a task waits on, and what waits on it", () => {
    expect(dependenciesOf(links, "b").map((row) => row.dependsOnTaskId)).toEqual(["a", "x"]);
    expect(dependentsOf(links, "a").map((row) => row.taskId)).toEqual(["b", "c"]);
  });

  it("is many-to-many in both directions", () => {
    // One task waiting on two things, and one thing blocking two tasks — the same rows read
    // from opposite ends.
    expect(dependenciesOf(links, "b")).toHaveLength(2);
    expect(dependentsOf(links, "a")).toHaveLength(2);
  });

  it("reports nothing rather than failing for a task with no links", () => {
    expect(dependenciesOf(links, "zzz")).toEqual([]);
    expect(dependentsOf(links, "zzz")).toEqual([]);
  });
});

describe("a task that can never start", () => {
  it("refuses a task waiting on itself", () => {
    expect(wouldCycle([], "a", "a")).toBe(true);
  });

  /**
   * The database constraint only catches the direct case. A→B→A is two perfectly legal rows
   * that together describe work nobody can ever begin, so the loop is closed here too.
   */
  it("refuses a loop that closes through another task", () => {
    const links = [link("a", "b")];
    expect(wouldCycle(links, "b", "a")).toBe(true);
  });

  it("refuses a longer loop", () => {
    const links = [link("a", "b"), link("b", "c")];
    expect(wouldCycle(links, "c", "a")).toBe(true);
  });

  it("allows two tasks to wait on the same third one", () => {
    const links = [link("a", "c")];
    expect(wouldCycle(links, "b", "c")).toBe(false);
  });

  it("does not hang on a loop that somehow already exists", () => {
    const links = [link("a", "b"), link("b", "a")];
    expect(wouldCycle(links, "a", "b")).toBe(true);
  });
});

describe("what may be offered as something to wait on", () => {
  const tasks = [
    makeTask({ id: "a", title: "Việc A" }),
    makeTask({ id: "b", title: "Việc B" }),
    makeTask({ id: "c", title: "Việc C", status: "done" }),
  ];

  it("never offers the task itself", () => {
    expect(dependencyCandidates(tasks, [], "a").map((task) => task.id)).toEqual(["b", "c"]);
  });

  it("does not offer what is already linked", () => {
    const links = [link("a", "b")];
    expect(dependencyCandidates(tasks, links, "a").map((task) => task.id)).toEqual(["c"]);
  });

  it("does not offer anything that would close a loop", () => {
    const links = [link("b", "a")];
    expect(dependencyCandidates(tasks, links, "a").map((task) => task.id)).toEqual(["c"]);
  });

  /**
   * Finished work stays offerable on purpose: "this waited on that, which is now delivered"
   * is exactly the history a dependency is for.
   */
  it("still offers work that is already finished", () => {
    expect(dependencyCandidates(tasks, [], "b").map((task) => task.id)).toContain("c");
  });
});

describe("dependency cache", () => {
  const base = [link("b", "a")];

  it("adds a link the first time", () => {
    expect(upsertDependency(base, link("b", "x"))).toHaveLength(2);
  });

  it("does not duplicate a link that is already there", () => {
    expect(upsertDependency(base, link("b", "a"))).toHaveLength(1);
  });

  it("drops exactly one end of the relation, not the task's other links", () => {
    const links = [link("b", "a"), link("b", "x")];
    const next = removeDependency(links, "b", "a");
    expect(next.map((row) => row.dependsOnTaskId)).toEqual(["x"]);
  });

  it("leaves the list alone when the link is unknown", () => {
    expect(removeDependency(base, "b", "zzz")).toHaveLength(1);
  });
});

describe("dependency errors in plain words", () => {
  it("names the self-dependency case for what it is", () => {
    expect(
      toVietnameseDependencyError("23514", 'violates check constraint "task_dependencies_not_self"'),
    ).toContain("chờ chính nó");
  });

  it("says a link already exists rather than showing a key violation", () => {
    expect(toVietnameseDependencyError("23505", "duplicate key value")).toContain("đã có rồi");
  });

  it("explains who may attach a dependency when the database refuses", () => {
    expect(
      toVietnameseDependencyError("42501", "new row violates row-level security policy"),
    ).toContain("người giao và người nhận");
  });

  it("falls back to the shared task vocabulary for everything else", () => {
    expect(toVietnameseDependencyError("P0001", "avora_task_not_found")).toBe(
      toVietnameseTaskError("P0001", "avora_task_not_found"),
    );
  });
});

describe("planning fields are optional everywhere", () => {
  it("leaves a shared task exactly as unset as a personal one", () => {
    const personal = makeTask({ id: "p" });
    const shared = makeTask({ id: "s", type: "1-1-shared", assigneeId: PEER, conversationId: "c1" });
    expect([personal.isMilestone, shared.isMilestone]).toEqual([false, false]);
    expect([personal.progressPercent, shared.progressPercent]).toEqual([null, null]);
  });
});
