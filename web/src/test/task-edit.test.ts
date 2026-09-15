import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  canEditTask,
  editBlockedReason,
  isTaskEditUnchanged,
  toVietnameseTaskError,
  validateTaskEdit,
  type TaskItem,
  type TaskStatus,
} from "@/lib/tasks";

const TODAY = "2026-09-08";
const ME = "u-me";
const THEM = "u-them";
const BYSTANDER = "u-bystander";

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
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function sharedTask(status: TaskStatus, overrides: Partial<TaskItem> = {}): TaskItem {
  return makeTask({
    type: "1-1-shared",
    conversationId: "c1",
    creatorId: ME,
    assigneeId: THEM,
    status,
    ...overrides,
  });
}

describe("who may reword a task", () => {
  it("lets the owner of a personal task edit it, and nobody else", () => {
    const mine = makeTask({ type: "personal", creatorId: ME });
    expect(canEditTask(mine, ME)).toBe(true);
    expect(canEditTask(mine, THEM)).toBe(false);
  });

  /**
   * Both parties, not just the person who wrote it. A promise often needs its wording fixed
   * after it is made, and the person carrying the work is frequently the one who notices.
   */
  it("lets either party edit a live shared task", () => {
    const task = sharedTask("confirmed");
    expect(canEditTask(task, ME)).toBe(true);
    expect(canEditTask(task, THEM)).toBe(true);
  });

  it("lets either party edit before the work is even accepted", () => {
    const task = sharedTask("pending_confirmation");
    expect(canEditTask(task, ME)).toBe(true);
    expect(canEditTask(task, THEM)).toBe(true);
  });

  /**
   * The line that matters: once a done claim is filed, the description IS the thing being
   * reviewed. Rewriting it then would mean judging finished work against wording that changed
   * after the fact.
   */
  it("stops both parties once the work has been reported done", () => {
    const awaiting = sharedTask("done_pending_review");
    expect(canEditTask(awaiting, ME)).toBe(false);
    expect(canEditTask(awaiting, THEM)).toBe(false);
  });

  it("stops both parties once the task is closed", () => {
    const closed = sharedTask("done");
    expect(canEditTask(closed, ME)).toBe(false);
    expect(canEditTask(closed, THEM)).toBe(false);
  });

  /** A group member can read a task they were never party to; it is not theirs to reword. */
  it("never lets a group bystander edit", () => {
    const group = makeTask({
      type: "group-shared",
      conversationId: "g1",
      creatorId: ME,
      assigneeId: THEM,
      status: "confirmed",
    });
    expect(canEditTask(group, BYSTANDER)).toBe(false);
  });

  it("is false when nobody is signed in", () => {
    expect(canEditTask(sharedTask("confirmed"), undefined)).toBe(false);
  });
});

describe("saying why the button is absent", () => {
  it("says nothing when editing is available", () => {
    expect(editBlockedReason(sharedTask("confirmed"), ME)).toBeNull();
  });

  it("names the review as the reason, not a generic refusal", () => {
    expect(editBlockedReason(sharedTask("done_pending_review"), ME)).toContain(
      "xác nhận hoàn thành",
    );
  });

  it("says a finished task is finished", () => {
    expect(editBlockedReason(sharedTask("done"), ME)).toContain("hoàn thành");
  });

  it("tells a bystander it is not their task", () => {
    const group = makeTask({
      type: "group-shared",
      conversationId: "g1",
      assigneeId: THEM,
      status: "confirmed",
    });
    expect(editBlockedReason(group, BYSTANDER)).toContain("người giao và người nhận");
  });
});

describe("validateTaskEdit", () => {
  const good = { title: "Gửi báo cáo", description: "Bản PDF", deadline: "2026-09-20" };

  it("holds an edit to the same bar as a new task", () => {
    expect(validateTaskEdit({ ...good, title: "  " }, TODAY).error).toContain("Tên nhiệm vụ");
    expect(validateTaskEdit({ ...good, description: "" }, TODAY).error).toContain("Mô tả");
    expect(validateTaskEdit({ ...good, deadline: "" }, TODAY).error).toContain("hạn");
  });

  it("trims what it accepts", () => {
    const result = validateTaskEdit(
      { title: "  Gửi báo cáo  ", description: "  Bản PDF  ", deadline: "2026-09-20" },
      TODAY,
    );
    expect(result.error).toBeNull();
    expect(result.value).toEqual({
      title: "Gửi báo cáo",
      description: "Bản PDF",
      deadline: "2026-09-20",
      deadlineTime: null,
    });
  });

  it("refuses to move a deadline into the past", () => {
    expect(validateTaskEdit({ ...good, deadline: "2026-09-01" }, TODAY).error).toContain("đã qua");
  });

  it("keeps a clock when one is given", () => {
    const result = validateTaskEdit({ ...good, deadlineTime: "14:30" }, TODAY);
    expect(result.value?.deadlineTime).toBe("14:30");
  });
});

describe("an edit that changes nothing", () => {
  /**
   * Saving an untouched form must not write. Bumping `updated_at` would tell the other party
   * that something was edited when nothing was — a small lie, told automatically.
   */
  it("is recognised so it can be skipped instead of written", () => {
    const task = makeTask({
      title: "Gửi báo cáo",
      description: "Bản PDF",
      deadline: "2026-09-20",
      deadlineTime: null,
    });
    expect(
      isTaskEditUnchanged(task, {
        title: "Gửi báo cáo",
        description: "Bản PDF",
        deadline: "2026-09-20",
        deadlineTime: null,
      }),
    ).toBe(true);
  });

  it("spots a change in any one of the four fields", () => {
    const task = makeTask({
      title: "Gửi báo cáo",
      description: "Bản PDF",
      deadline: "2026-09-20",
      deadlineTime: null,
    });
    const base = {
      title: "Gửi báo cáo",
      description: "Bản PDF",
      deadline: "2026-09-20",
      deadlineTime: null as string | null,
    };
    expect(isTaskEditUnchanged(task, { ...base, title: "Khác" })).toBe(false);
    expect(isTaskEditUnchanged(task, { ...base, description: "Khác" })).toBe(false);
    expect(isTaskEditUnchanged(task, { ...base, deadline: "2026-09-21" })).toBe(false);
    expect(isTaskEditUnchanged(task, { ...base, deadlineTime: "09:00" })).toBe(false);
  });
});

describe("server refusals, said in Vietnamese", () => {
  it("explains an edit refused because the task is no longer open", () => {
    expect(toVietnameseTaskError("P0001", "avora_task_edit_closed")).toContain("đã báo xong");
  });

  it("explains an edit refused because the person is not party to the task", () => {
    expect(toVietnameseTaskError("P0001", "avora_task_not_party")).toContain(
      "người giao và người nhận",
    );
  });
});
