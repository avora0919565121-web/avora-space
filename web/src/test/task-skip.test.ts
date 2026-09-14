import { describe, expect, it, vi } from "vitest";

// The skip rules are pure, but they live beside the Supabase client the module also owns.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  canConfirmSharedTask,
  canSkipSharedTask,
  canSkipSilently,
  canSubmitSkip,
  isOpenTask,
  isSkipped,
  isSuggestion,
  placeSilentSkipNotices,
  sharedTaskNote,
  silentSkipNote,
  silentSkipNotices,
  skipMessageFor,
  skipMessageTemplate,
  skipReplyModes,
  suggestedByNote,
  taskStatusLabel,
  toVietnameseTaskError,
  type TaskItem,
} from "@/lib/tasks";

const ME = "u-me";
const BOSS = "u-boss";
const OTHER = "u-other";

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "t1",
    type: "1-1-shared",
    creatorId: BOSS,
    assigneeId: ME,
    contextSnapshot: null,
    conversationId: "conv-1",
    title: "Rà soát hợp đồng",
    description: "Xem lại điều khoản 4 rồi gửi lại bản có chú thích",
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
    recurrence: "none",
    recurrencePattern: null,
    recurrenceSpawnedAt: null,
    deletedByCreator: false,
    deletedByPeer: false,
    createdAt: "2026-09-14T00:00:00Z",
    ...overrides,
  };
}

describe("a shared task arrives as a suggestion, not an instruction", () => {
  it("is a suggestion to the person being asked", () => {
    expect(isSuggestion(task(), ME)).toBe(true);
  });

  it("is not a suggestion to the person who raised it — they are waiting, not deciding", () => {
    expect(isSuggestion(task({ creatorId: ME, assigneeId: OTHER }), ME)).toBe(false);
  });

  it("stops being a suggestion the moment it is accepted", () => {
    expect(isSuggestion(task({ status: "confirmed", confirmedAt: "2026-09-14T01:00:00Z" }), ME)).toBe(
      false,
    );
  });

  it("names who asked, so declining is not refusing an order", () => {
    expect(suggestedByNote("Sếp Minh")).toBe("Sếp Minh đã gợi ý việc này");
  });
});

describe("who may decline", () => {
  it("is exactly the person who could accept — the same two answers to one question", () => {
    const pending = task();
    expect(canSkipSharedTask(pending, ME)).toBe(canConfirmSharedTask(pending, ME));
    expect(canSkipSharedTask(pending, ME)).toBe(true);
  });

  it("is never the creator: withdrawing your own request is deleting it, not declining it", () => {
    expect(canSkipSharedTask(task({ creatorId: ME, assigneeId: OTHER }), ME)).toBe(false);
  });

  it("is never a bystander who was not asked", () => {
    expect(canSkipSharedTask(task({ type: "group-shared" }), OTHER)).toBe(false);
  });

  it("closes once the task is accepted — a promise is left by finishing, not declining", () => {
    const accepted = task({ status: "confirmed", confirmedAt: "2026-09-14T01:00:00Z" });
    expect(canSkipSharedTask(accepted, ME)).toBe(false);
  });

  it("is not something a personal task has", () => {
    expect(canSkipSharedTask(task({ type: "personal", creatorId: ME, assigneeId: null }), ME)).toBe(
      false,
    );
  });
});

describe("saying nothing at all", () => {
  it("is offered in a 1-1, where the decline is still visible on the task", () => {
    expect(canSkipSilently(task({ type: "1-1-shared" }))).toBe(true);
    expect(skipReplyModes(task({ type: "1-1-shared" }))).toEqual(["template", "custom", "silent"]);
  });

  it("is absent in a group — a room left waiting cannot tell silence from being ignored", () => {
    const group = task({ type: "group-shared" });
    expect(canSkipSilently(group)).toBe(false);
    // Two options, not three with one greyed out: an option offered then refused teaches
    // people the menu cannot be trusted.
    expect(skipReplyModes(group)).toEqual(["template", "custom"]);
    expect(skipReplyModes(group)).not.toContain("silent");
  });
});

describe("what the decline form will accept", () => {
  const direct = task({ type: "1-1-shared" });
  const group = task({ type: "group-shared" });

  it("always lets the offered sentence be sent as it stands", () => {
    // That is the entire point of offering it — no keystrokes required.
    expect(canSubmitSkip(direct, "template", "")).toBe(true);
    expect(canSubmitSkip(group, "template", "")).toBe(true);
  });

  it("refuses an empty written reply, in a group and in a 1-1 alike", () => {
    expect(canSubmitSkip(group, "custom", "")).toBe(false);
    expect(canSubmitSkip(group, "custom", "   ")).toBe(false);
    expect(canSubmitSkip(direct, "custom", "   ")).toBe(false);
  });

  it("accepts a written reply that actually says something", () => {
    expect(canSubmitSkip(group, "custom", "Tuần này tôi kín lịch rồi")).toBe(true);
  });

  it("refuses silence in a group even if the form somehow asks for it", () => {
    // The last line of client-side defence; the server refuses it independently too.
    expect(canSubmitSkip(group, "silent", "")).toBe(false);
    expect(canSubmitSkip(direct, "silent", "")).toBe(true);
  });
});

describe("the words a decline sends", () => {
  it("addresses the person who asked, by name, and is ready to send", () => {
    expect(skipMessageTemplate("Sếp Minh")).toBe("Sếp Minh, tôi xin theo dõi sau.");
    expect(skipMessageFor("template", "Sếp Minh", "")).toBe("Sếp Minh, tôi xin theo dõi sau.");
  });

  it("promises to come back rather than refusing outright, which is usually what is true", () => {
    expect(skipMessageTemplate("Hoà")).toContain("theo dõi sau");
  });

  it("sends the person's own words when they wrote some, trimmed", () => {
    expect(skipMessageFor("custom", "Sếp Minh", "  Tuần sau tôi làm nhé  ")).toBe(
      "Tuần sau tôi làm nhé",
    );
  });

  it("sends nothing for a silent decline — null, not an empty message", () => {
    // A caller has to be able to tell "say nothing" from "say something empty".
    expect(skipMessageFor("silent", "Sếp Minh", "")).toBeNull();
    expect(skipMessageFor("custom", "Sếp Minh", "   ")).toBeNull();
  });
});

describe("a declined task on the list", () => {
  const skipped = task({ status: "skipped", skippedAt: "2026-09-14T02:00:00Z" });

  it("is recognised as declined", () => {
    expect(isSkipped(skipped)).toBe(true);
    expect(isSkipped(task())).toBe(false);
  });

  it("does not disappear — it is a state, not a deletion", () => {
    // The row survives, so the person who asked can see their request was answered.
    expect(skipped.status).toBe("skipped");
    expect(taskStatusLabel("skipped")).toBe("Đã bỏ qua");
  });

  it("no longer counts as open, because nobody is waiting on anyone", () => {
    expect(isOpenTask(skipped, ME)).toBe(false);
    expect(isOpenTask(task(), ME)).toBe(true);
  });

  it("reads differently from each side without guessing at reasons", () => {
    expect(sharedTaskNote(skipped, ME)).toBe("Bạn đã bỏ qua");
    expect(sharedTaskNote(skipped, BOSS)).toBe("Người nhận đã bỏ qua");
  });
});

describe("the quiet line left by a silent decline", () => {
  it("says it happened and does not speculate about why", () => {
    const note = silentSkipNote("Hoà");
    expect(note).toBe("Hoà đã bỏ qua, có lý do riêng của họ.");
    // Not owing an explanation is the point; the line must not imply one is due.
    expect(note).toContain("có lý do riêng của họ");
  });

  it("is derived only from genuinely silent declines", () => {
    const tasks = [
      task({ id: "silent", status: "skipped", skippedAt: "2026-09-14T02:00:00Z", skippedSilently: true }),
      // Declined WITH a message: already visible as that message, so annotating it too
      // would say the same thing twice.
      task({ id: "spoke", status: "skipped", skippedAt: "2026-09-14T03:00:00Z", skippedSilently: false }),
      task({ id: "live" }),
    ];
    const notices = silentSkipNotices(tasks, "conv-1");
    expect(notices).toHaveLength(1);
    expect(notices[0]?.taskId).toBe("silent");
  });

  it("leaves out declines from other conversations", () => {
    const tasks = [
      task({
        id: "elsewhere",
        conversationId: "conv-2",
        status: "skipped",
        skippedAt: "2026-09-14T02:00:00Z",
        skippedSilently: true,
      }),
    ];
    expect(silentSkipNotices(tasks, "conv-1")).toHaveLength(0);
  });

  it("orders several by when they happened", () => {
    const tasks = [
      task({ id: "late", status: "skipped", skippedAt: "2026-09-14T05:00:00Z", skippedSilently: true }),
      task({ id: "early", status: "skipped", skippedAt: "2026-09-14T01:00:00Z", skippedSilently: true }),
    ];
    expect(silentSkipNotices(tasks, "conv-1").map((notice) => notice.taskId)).toEqual([
      "early",
      "late",
    ]);
  });
});

describe("where the quiet line sits in the thread", () => {
  const messages = [
    { id: "m1", createdAt: "2026-09-14T01:00:00Z" },
    { id: "m2", createdAt: "2026-09-14T03:00:00Z" },
  ];

  it("follows the message it came after, not the bottom of the thread", () => {
    const notices = [{ taskId: "t", assigneeId: ME, at: "2026-09-14T02:00:00Z" }];
    const placed = placeSilentSkipNotices(notices, messages);
    expect(placed.get("m1")?.map((n) => n.taskId)).toEqual(["t"]);
    expect(placed.has("m2")).toBe(false);
  });

  it("sits after the newest message when the decline is the most recent thing", () => {
    const notices = [{ taskId: "t", assigneeId: ME, at: "2026-09-14T09:00:00Z" }];
    expect(placeSilentSkipNotices(notices, messages).get("m2")?.[0]?.taskId).toBe("t");
  });

  it("goes above everything when it predates every message", () => {
    // Possible for a task raised in a thread that had no messages yet.
    const notices = [{ taskId: "t", assigneeId: ME, at: "2026-09-13T00:00:00Z" }];
    expect(placeSilentSkipNotices(notices, messages).get("")?.[0]?.taskId).toBe("t");
  });

  it("keeps several that landed after the same message", () => {
    const notices = [
      { taskId: "a", assigneeId: ME, at: "2026-09-14T04:00:00Z" },
      { taskId: "b", assigneeId: ME, at: "2026-09-14T05:00:00Z" },
    ];
    expect(placeSilentSkipNotices(notices, messages).get("m2")?.map((n) => n.taskId)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("what a refused decline says to the person", () => {
  it("explains an accepted task that can no longer be declined", () => {
    expect(toVietnameseTaskError(undefined, "avora_task_skip_not_pending")).toBe(
      "Nhiệm vụ này đã được nhận nên không bỏ qua được nữa.",
    );
  });

  it("explains why a group decline needs a word, rather than just refusing", () => {
    const message = toVietnameseTaskError(undefined, "avora_task_skip_needs_message");
    expect(message).toContain("cả nhóm đang chờ phản hồi");
  });

  it("explains a shared task raised with no conversation behind it", () => {
    expect(toVietnameseTaskError(undefined, "avora_task_context_required")).toBe(
      "Nhiệm vụ chia sẻ cần gắn với cuộc trò chuyện nó sinh ra.",
    );
  });
});
