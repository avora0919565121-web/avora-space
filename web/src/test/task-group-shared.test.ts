import { describe, expect, it, vi } from "vitest";

// These authority rules are pure, but they live in the module that owns the Supabase client.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  canConfirmSharedTask,
  canDeleteTask,
  canMarkSharedDone,
  canReturnSharedTask,
  canReviewSharedDone,
  deleteIsPermanent,
  groupSharedByConversation,
  isDeletedByOther,
  isDeletedFor,
  isSharedTask,
  isTaskAssignee,
  isTaskBystander,
  sharedTaskNote,
  taskTier,
  type TaskItem,
} from "@/lib/tasks";

const CREATOR = "u-creator";
const ASSIGNEE = "u-assignee";
const BYSTANDER = "u-bystander";

function groupTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "t-group",
    type: "group-shared",
    creatorId: CREATOR,
    assigneeId: ASSIGNEE,
    contextSnapshot: null,
    conversationId: "conv-group",
    title: "Chuẩn bị tài liệu họp",
    description: "Bản PDF, gửi trước 9h sáng",
    status: "pending_confirmation",
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
    createdAt: "2026-09-09T00:00:00Z",
    ...overrides,
  };
}

/** A 1-1 row written before assignees were recorded: the peer is whoever is not the creator. */
function legacyDirectTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return groupTask({
    id: "t-direct",
    type: "1-1-shared",
    assigneeId: null,
    conversationId: "conv-direct",
    ...overrides,
  });
}

describe("isSharedTask", () => {
  it("counts both kinds of two-party task and no others", () => {
    expect(isSharedTask(groupTask())).toBe(true);
    expect(isSharedTask(legacyDirectTask())).toBe(true);
    expect(isSharedTask(groupTask({ type: "personal", conversationId: null }))).toBe(false);
  });
});

describe("isTaskAssignee", () => {
  it("names the one person carrying a group task", () => {
    const task = groupTask();
    expect(isTaskAssignee(task, ASSIGNEE)).toBe(true);
    expect(isTaskAssignee(task, CREATOR)).toBe(false);
    expect(isTaskAssignee(task, BYSTANDER)).toBe(false);
    expect(isTaskAssignee(task, undefined)).toBe(false);
  });

  it("still reads an older 1-1 task, where the assignee is simply the other person", () => {
    expect(isTaskAssignee(legacyDirectTask(), ASSIGNEE)).toBe(true);
    expect(isTaskAssignee(legacyDirectTask(), CREATOR)).toBe(false);
  });

  it("never guesses an assignee for a group task that has none", () => {
    // A group has many candidates, so silence must not be read as "everyone".
    const unassigned = groupTask({ assigneeId: null });
    expect(isTaskAssignee(unassigned, ASSIGNEE)).toBe(false);
    expect(isTaskAssignee(unassigned, BYSTANDER)).toBe(false);
  });
});

describe("isTaskBystander", () => {
  it("recognises a group member who was not asked for anything", () => {
    expect(isTaskBystander(groupTask(), BYSTANDER)).toBe(true);
    expect(isTaskBystander(groupTask(), CREATOR)).toBe(false);
    expect(isTaskBystander(groupTask(), ASSIGNEE)).toBe(false);
  });
});

describe("who may act on a group task", () => {
  it("lets only the assignee accept it", () => {
    const task = groupTask({ status: "pending_confirmation" });
    expect(canConfirmSharedTask(task, ASSIGNEE)).toBe(true);
    expect(canConfirmSharedTask(task, CREATOR)).toBe(false);
    expect(canConfirmSharedTask(task, BYSTANDER)).toBe(false);
  });

  it("lets only the assignee report it finished", () => {
    const task = groupTask({ status: "confirmed", confirmedAt: "2026-09-09T01:00:00Z" });
    expect(canMarkSharedDone(task, ASSIGNEE)).toBe(true);
    expect(canMarkSharedDone(task, CREATOR)).toBe(false);
    expect(canMarkSharedDone(task, BYSTANDER)).toBe(false);
  });

  it("lets only the creator answer the claim, either way", () => {
    const task = groupTask({
      status: "done_pending_review",
      confirmedAt: "2026-09-09T01:00:00Z",
      doneAt: "2026-09-09T02:00:00Z",
    });
    expect(canReviewSharedDone(task, CREATOR)).toBe(true);
    expect(canReturnSharedTask(task, CREATOR)).toBe(true);
    expect(canReviewSharedDone(task, ASSIGNEE)).toBe(false);
    expect(canReturnSharedTask(task, BYSTANDER)).toBe(false);
  });
});

describe("binning a group task", () => {
  it("lets the creator withdraw at any point", () => {
    expect(canDeleteTask(groupTask(), CREATOR)).toBe(true);
  });

  it("holds the assignee back until the work has been accepted", () => {
    expect(canDeleteTask(groupTask({ status: "confirmed" }), ASSIGNEE)).toBe(false);
    expect(canDeleteTask(groupTask({ status: "done" }), ASSIGNEE)).toBe(true);
  });

  it("gives a bystander nothing to delete", () => {
    expect(canDeleteTask(groupTask({ status: "done" }), BYSTANDER)).toBe(false);
  });

  it("warns that withdrawing an unaccepted request destroys it outright", () => {
    expect(deleteIsPermanent(groupTask({ status: "pending_confirmation" }), CREATOR)).toBe(true);
    expect(deleteIsPermanent(groupTask({ status: "confirmed" }), CREATOR)).toBe(false);
    expect(deleteIsPermanent(groupTask(), ASSIGNEE)).toBe(false);
  });

  it("keeps each side's bin separate, and gives a bystander none", () => {
    const assigneeBinned = groupTask({ deletedByPeer: true });
    expect(isDeletedFor(assigneeBinned, ASSIGNEE)).toBe(true);
    expect(isDeletedFor(assigneeBinned, CREATOR)).toBe(false);
    // The other members' view of the task must not follow the assignee into the bin.
    expect(isDeletedFor(assigneeBinned, BYSTANDER)).toBe(false);
  });

  it("tells the surviving party when the other side let go", () => {
    expect(isDeletedByOther(groupTask({ deletedByPeer: true }), CREATOR)).toBe(true);
    expect(isDeletedByOther(groupTask({ deletedByCreator: true }), ASSIGNEE)).toBe(true);
    expect(isDeletedByOther(groupTask({ deletedByCreator: true }), BYSTANDER)).toBe(false);
  });
});

describe("how a group task reads", () => {
  it("says whose turn it is from the reader's own side", () => {
    const pending = groupTask({ status: "pending_confirmation" });
    expect(sharedTaskNote(pending, ASSIGNEE)).toBe("Chờ bạn nhận việc");
    expect(sharedTaskNote(pending, CREATOR)).toBe("Chờ nhận việc");
    expect(sharedTaskNote(pending, BYSTANDER)).toBe("Chờ nhận việc");
  });

  it("ranks work other people are waiting on above your own", () => {
    expect(taskTier(groupTask(), ASSIGNEE)).toBe(1);
    expect(taskTier(groupTask(), CREATOR)).toBe(2);
  });
});

describe("groupSharedByConversation", () => {
  it("gathers group tasks beside 1-1 ones, each under its own conversation", () => {
    const groups = groupSharedByConversation([
      legacyDirectTask({ id: "d1" }),
      groupTask({ id: "g1" }),
      groupTask({ id: "g2" }),
      groupTask({ id: "p1", type: "personal", conversationId: null }),
    ]);
    expect(groups.map((group) => group.conversationId)).toEqual(["conv-direct", "conv-group"]);
    expect(groups[1]?.tasks.map((task) => task.id)).toEqual(["g1", "g2"]);
  });
});
