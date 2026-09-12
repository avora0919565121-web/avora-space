import { describe, expect, it, vi } from "vitest";

// Scope rules are pure, but they reach `@/lib/tasks`, which owns the Supabase client.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  filterByScope,
  openCountsByScope,
  parseTaskScope,
  scopeLink,
  scopeOfTask,
  scopeSlug,
  TASK_SCOPE_PARAM,
} from "@/lib/task-scope";
import type { TaskItem } from "@/lib/tasks";

const ME = "u-me";
const THEM = "u-them";

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
    deadline: "2026-09-20",
    deadlineTime: null,
    deadlineTz: "Asia/Ho_Chi_Minh",
    categoryId: null,
    isImportant: false,
    recurrence: "none",
    recurrencePattern: null,
    recurrenceSpawnedAt: null,
    deletedByCreator: false,
    deletedByPeer: false,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("scopeOfTask", () => {
  it("sorts each task into the one place it belongs", () => {
    expect(scopeOfTask(makeTask({ type: "personal" }))).toBe("personal");
    expect(scopeOfTask(makeTask({ type: "1-1-shared", conversationId: "c1" }))).toBe("direct");
    expect(scopeOfTask(makeTask({ type: "group-shared", conversationId: "c2" }))).toBe("group");
  });
});

describe("parseTaskScope", () => {
  it("reads the three scopes out of the address bar", () => {
    expect(parseTaskScope("ca-nhan")).toBe("personal");
    expect(parseTaskScope("1-1")).toBe("direct");
    expect(parseTaskScope("nhom")).toBe("group");
  });

  it("treats anything else as no filter rather than an empty list", () => {
    expect(parseTaskScope(null)).toBeNull();
    expect(parseTaskScope("")).toBeNull();
    expect(parseTaskScope("tat-ca")).toBeNull();
  });
});

describe("filterByScope", () => {
  const tasks = [
    makeTask({ id: "p", type: "personal" }),
    makeTask({ id: "d", type: "1-1-shared", conversationId: "c1" }),
    makeTask({ id: "g", type: "group-shared", conversationId: "c2" }),
  ];

  it("narrows to the kind of work asked for", () => {
    expect(filterByScope(tasks, "personal").map((task) => task.id)).toEqual(["p"]);
    expect(filterByScope(tasks, "direct").map((task) => task.id)).toEqual(["d"]);
    expect(filterByScope(tasks, "group").map((task) => task.id)).toEqual(["g"]);
  });

  it("shows everything when no scope is chosen", () => {
    expect(filterByScope(tasks, null)).toHaveLength(3);
  });
});

describe("openCountsByScope", () => {
  it("counts what is still outstanding in each of the three", () => {
    const counts = openCountsByScope(
      [
        makeTask({ id: "p1", type: "personal" }),
        makeTask({ id: "p2", type: "personal", status: "done" }),
        makeTask({ id: "d1", type: "1-1-shared", conversationId: "c1", status: "pending_confirmation" }),
        makeTask({ id: "d2", type: "1-1-shared", conversationId: "c1", status: "done_pending_review" }),
        makeTask({ id: "g1", type: "group-shared", conversationId: "c2", assigneeId: THEM }),
      ],
      ME,
    );
    // A claim awaiting review is still someone's responsibility, so it still counts.
    expect(counts).toEqual({ personal: 1, direct: 2, group: 1 });
  });

  it("leaves out what this person has already binned", () => {
    const binned = makeTask({ id: "p1", type: "personal", deletedByCreator: true });
    expect(openCountsByScope([binned], ME).personal).toBe(0);
  });

  it("counts nothing when there is nothing", () => {
    expect(openCountsByScope([], ME)).toEqual({ personal: 0, direct: 0, group: 0 });
  });
});

describe("scopeLink", () => {
  it("leads to Tab Nhiệm vụ already narrowed to that block", () => {
    expect(scopeLink("personal")).toBe(`/nhiem-vu?${TASK_SCOPE_PARAM}=ca-nhan`);
    expect(scopeLink("direct")).toBe(`/nhiem-vu?${TASK_SCOPE_PARAM}=1-1`);
    expect(scopeLink("group")).toBe(`/nhiem-vu?${TASK_SCOPE_PARAM}=nhom`);
  });

  it("uses a slug the filter can read back", () => {
    // The number tapped and the list landed on must always be the same set of tasks.
    expect(parseTaskScope(scopeSlug("group"))).toBe("group");
  });
});
