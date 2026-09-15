import { describe, expect, it, vi } from "vitest";

// These rules are pure, but they live in the module that owns the Supabase client.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { groupTasksByAssignee } from "@/lib/group-task-list";
import type { GroupMember } from "@/lib/groups";
import {
  canConfirmSharedTask,
  canMarkSharedDone,
  canReviewSharedDone,
  involvesViewer,
  isSharedTask,
  upsertTask,
  type TaskItem,
} from "@/lib/tasks";

const ME = "u-me";
const BOSS = "u-boss";
const HOA = "u-hoa";
const DUNG = "u-dung";

function task(overrides: Partial<TaskItem> & { id: string }): TaskItem {
  return {
    type: "group-shared",
    creatorId: BOSS,
    assigneeId: ME,
    contextSnapshot: null,
    conversationId: "conv-group",
    title: "Chuẩn bị tài liệu",
    description: "Bản PDF",
    status: "pending_confirmation",
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
    createdAt: "2026-09-09T00:00:00Z",
    ...overrides,
  };
}

function member(userId: string, name: string, role: GroupMember["role"] = "member"): GroupMember {
  return { userId, displayName: name, email: `${userId}@avora.vn`, role, joinedAt: "2026-01-01T00:00:00Z" };
}

/** The panel inside a group chat, expressed as the filter the component applies. */
function myPanelTasks(tasks: readonly TaskItem[], viewerId: string): TaskItem[] {
  return tasks.filter((entry) => isSharedTask(entry) && involvesViewer(entry, viewerId));
}

describe("involvesViewer", () => {
  it("counts work the viewer was asked to do", () => {
    expect(involvesViewer(task({ id: "t1", creatorId: BOSS, assigneeId: ME }), ME)).toBe(true);
  });

  it("counts work the viewer asked somebody else for, because only they can close it", () => {
    expect(involvesViewer(task({ id: "t2", creatorId: ME, assigneeId: HOA }), ME)).toBe(true);
  });

  it("leaves out work between two other people in the same room", () => {
    expect(involvesViewer(task({ id: "t3", creatorId: BOSS, assigneeId: HOA }), ME)).toBe(false);
  });

  it("still recognises a legacy 1-1 task with no named assignee", () => {
    const legacy = task({ id: "t4", type: "1-1-shared", creatorId: BOSS, assigneeId: null });
    expect(involvesViewer(legacy, ME)).toBe(true);
  });

  it("says no when nobody is signed in", () => {
    expect(involvesViewer(task({ id: "t5" }), undefined)).toBe(false);
  });
});

describe("the panel inside a group chat", () => {
  const tasks = [
    task({ id: "mine", creatorId: BOSS, assigneeId: ME }),
    task({ id: "i-gave-it", creatorId: ME, assigneeId: HOA }),
    task({ id: "theirs", creatorId: BOSS, assigneeId: HOA }),
    task({ id: "also-theirs", creatorId: HOA, assigneeId: DUNG }),
  ];

  it("shows only what the viewer is carrying or waiting on", () => {
    expect(myPanelTasks(tasks, ME).map((entry) => entry.id)).toEqual(["mine", "i-gave-it"]);
  });

  it("hides other members' work, however much of it there is", () => {
    const ids = myPanelTasks(tasks, ME).map((entry) => entry.id);
    expect(ids).not.toContain("theirs");
    expect(ids).not.toContain("also-theirs");
  });

  it("never hides a task the viewer must act on", () => {
    const needsMe = [
      task({ id: "confirm", creatorId: BOSS, assigneeId: ME, status: "pending_confirmation" }),
      task({ id: "finish", creatorId: BOSS, assigneeId: ME, status: "confirmed" }),
      task({ id: "review", creatorId: ME, assigneeId: HOA, status: "done_pending_review" }),
    ];
    const visible = myPanelTasks(needsMe, ME).map((entry) => entry.id);

    expect(visible).toEqual(["confirm", "finish", "review"]);
    expect(canConfirmSharedTask(needsMe[0], ME)).toBe(true);
    expect(canMarkSharedDone(needsMe[1], ME)).toBe(true);
    expect(canReviewSharedDone(needsMe[2], ME)).toBe(true);
  });
});

describe("groupTasksByAssignee", () => {
  const members = [member(BOSS, "Sếp Minh", "owner"), member(ME, "Chính tôi"), member(HOA, "Hoà")];

  it("gathers the whole room's work under the person carrying it", () => {
    const sections = groupTasksByAssignee(
      [
        task({ id: "a", assigneeId: ME }),
        task({ id: "b", assigneeId: HOA }),
        task({ id: "c", assigneeId: HOA }),
      ],
      members,
      ME,
    );

    expect(sections.map((section) => section.key)).toEqual([ME, HOA]);
    expect(sections[0].tasks.map((entry) => entry.id)).toEqual(["a"]);
    expect(sections[1].tasks.map((entry) => entry.id)).toEqual(["b", "c"]);
  });

  it("names the viewer as themselves so the list is readable at a glance", () => {
    const sections = groupTasksByAssignee([task({ id: "a", assigneeId: ME })], members, ME);
    expect(sections[0].name).toBe("Chính tôi (bạn)");
  });

  it("follows the group's own order: owner first", () => {
    const sections = groupTasksByAssignee(
      [task({ id: "a", assigneeId: HOA }), task({ id: "b", assigneeId: BOSS })],
      members,
      ME,
    );
    expect(sections.map((section) => section.key)).toEqual([BOSS, HOA]);
  });

  it("leaves out members with nothing on their plate", () => {
    const sections = groupTasksByAssignee([task({ id: "a", assigneeId: HOA })], members, ME);
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe(HOA);
  });

  it("keeps a task whose assignee is unknown rather than dropping it", () => {
    const sections = groupTasksByAssignee(
      [task({ id: "orphan", assigneeId: null }), task({ id: "left", assigneeId: "u-departed" })],
      members,
      ME,
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe("unassigned");
    expect(sections[0].tasks.map((entry) => entry.id)).toEqual(["orphan", "left"]);
  });
});

/**
 * The point of creating one row per person: the three tasks share a wording and a quoted
 * message, and nothing else. What one assignee does must leave the other two untouched.
 */
describe("three tasks made from one request", () => {
  const siblings = [
    task({ id: "t-hoa", creatorId: ME, assigneeId: HOA }),
    task({ id: "t-dung", creatorId: ME, assigneeId: DUNG }),
    task({ id: "t-boss", creatorId: ME, assigneeId: BOSS }),
  ];

  it("asks each person separately, and only that person", () => {
    expect(canConfirmSharedTask(siblings[0], HOA)).toBe(true);
    expect(canConfirmSharedTask(siblings[0], DUNG)).toBe(false);
    expect(canConfirmSharedTask(siblings[1], DUNG)).toBe(true);
    expect(canConfirmSharedTask(siblings[1], HOA)).toBe(false);
  });

  it("moves one task along without touching its siblings", () => {
    const confirmed: TaskItem = { ...siblings[0], status: "confirmed", confirmedAt: "2026-09-10T01:00:00Z" };
    const after = upsertTask(siblings, confirmed);

    expect(after.find((entry) => entry.id === "t-hoa")?.status).toBe("confirmed");
    expect(after.find((entry) => entry.id === "t-dung")?.status).toBe("pending_confirmation");
    expect(after.find((entry) => entry.id === "t-boss")?.status).toBe("pending_confirmation");
  });

  it("finishes one without finishing the others", () => {
    const done: TaskItem = { ...siblings[1], status: "done", doneAt: "2026-09-11T02:00:00Z" };
    const after = upsertTask(siblings, done);

    expect(after.filter((entry) => entry.status === "done").map((entry) => entry.id)).toEqual(["t-dung"]);
    expect(after).toHaveLength(3);
  });

  it("gives every sibling its own identity, so no two can be confused", () => {
    expect(new Set(siblings.map((entry) => entry.id)).size).toBe(3);
    expect(new Set(siblings.map((entry) => entry.assigneeId)).size).toBe(3);
  });
});
