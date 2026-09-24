import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the modules pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  completedDayLabel,
  journalForwardContent,
} from "@/lib/task-report";
import {
  completedAtOf,
  isTaskOutputTooLong,
  normalizeTaskOutput,
  reportTasks,
  TASK_OUTPUT_MAX_LEN,
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
    title: "Việc đã xong",
    description: "Mô tả cụ thể",
    status: "done",
    confirmedAt: null,
    doneAt: "2026-09-10T08:00:00Z",
    completedConfirmedAt: null,
    skippedAt: null,
    skippedSilently: false,
    deadline: "2026-09-09",
    deadlineTime: null,
    deadlineTz: "Asia/Ho_Chi_Minh",
    categoryId: null,
    isImportant: false,
    isMilestone: false,
    progressPercent: null,
    outputValue: null,
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

describe("the answer to the completion question is optional and bounded", () => {
  /**
   * The distinction the whole field rests on: a task completed without naming its output is
   * not a task whose output was erased. Null is the honest "nothing was said".
   */
  it("reads a blank box as none, not as an empty string", () => {
    expect(normalizeTaskOutput("")).toBeNull();
    expect(normalizeTaskOutput("   ")).toBeNull();
    expect(normalizeTaskOutput("  Báo cáo đã gửi  ")).toBe("Báo cáo đã gửi");
  });

  it("refuses an essay rather than silently shortening it", () => {
    expect(isTaskOutputTooLong("x".repeat(TASK_OUTPUT_MAX_LEN))).toBe(false);
    expect(isTaskOutputTooLong("x".repeat(TASK_OUTPUT_MAX_LEN + 1))).toBe(true);
    expect(normalizeTaskOutput("x".repeat(TASK_OUTPUT_MAX_LEN + 1))).toBeNull();
  });
});

describe("when a task actually closed", () => {
  it("prefers the review stamp for shared work, and the claim for the rest", () => {
    expect(
      completedAtOf(makeTask({ id: "s", completedConfirmedAt: "2026-09-11T09:00:00Z" })),
    ).toBe("2026-09-11T09:00:00Z");
    expect(completedAtOf(makeTask({ id: "p" }))).toBe("2026-09-10T08:00:00Z");
    expect(completedAtOf(makeTask({ id: "open", status: "confirmed", doneAt: null }))).toBeNull();
  });
});

describe("Báo cáo: work that closed AND named what it brought", () => {
  const delivered = makeTask({
    id: "done-with-output",
    outputValue: "Báo cáo 12 trang, số liệu tháng 8 đã rà soát",
    doneAt: "2026-09-10T08:00:00Z",
  });
  const reviewed = makeTask({
    id: "shared-reviewed",
    type: "1-1-shared",
    creatorId: PEER,
    assigneeId: ME,
    conversationId: "conv-1",
    completedConfirmedAt: "2026-09-12T09:00:00Z",
    outputValue: "Bản mô tả đã rà soát",
  });
  const list = [
    delivered,
    reviewed,
    // Finished but said nothing: it stays on its own list, not here.
    makeTask({ id: "silent-finish", outputValue: null }),
    // Named an output but not closed: nothing to report yet.
    makeTask({ id: "still-open", status: "confirmed", outputValue: "Viết xong sớm" }),
  ];

  it("keeps only closed work with an output", () => {
    expect(reportTasks(list, ME).map((task) => task.id)).toContain("done-with-output");
    expect(reportTasks(list, ME).map((task) => task.id)).not.toContain("silent-finish");
    expect(reportTasks(list, ME).map((task) => task.id)).not.toContain("still-open");
  });

  it("orders newest first — the report answers what was delivered lately", () => {
    expect(reportTasks(list, ME).map((task) => task.id)).toEqual(["shared-reviewed", "done-with-output"]);
  });

  it("hides what this person has binned, and what both sides are done with", () => {
    const binned = reportTasks(
      [...list, makeTask({ id: "binned", deletedByCreator: true })],
      ME,
    );
    expect(binned.map((task) => task.id)).not.toContain("binned");
    expect(reportTasks([...list, makeTask({ id: "gone", deletedByCreator: true, deletedByPeer: true })], ME))
      .not.toContain("gone");
  });

  it("keeps a completed result visible to a bystander — it is worth reading regardless of whose hands produced it", () => {
    const groupResult = makeTask({
      id: "group-result",
      type: "group-shared",
      creatorId: PEER,
      assigneeId: "u-third",
      conversationId: "group-1",
      outputValue: "Bài viết đã đăng",
    });
    expect(reportTasks([...list, groupResult], ME).map((task) => task.id)).toContain("group-result");
  });
});

describe("forwarding a result into the journal", () => {
  it("sends what closed and what it brought, nothing more", () => {
    expect(
      journalForwardContent(
        makeTask({ id: "fwd", title: "Rà soát số liệu tháng 8", outputValue: "12 trang, đủ số liệu" }),
      ),
    ).toBe("✅ Rà soát số liệu tháng 8\n12 trang, đủ số liệu");
  });

  it("does not leave a dangling second line when the output is missing", () => {
    expect(journalForwardContent(makeTask({ id: "fwd-null", title: "Việc không có kết quả", outputValue: null }))).toBe(
      "✅ Việc không có kết quả",
    );
  });

  it("dates the report row from the moment it closed", () => {
    expect(
      completedDayLabel(makeTask({ id: "day-reviewed", completedConfirmedAt: "2026-09-12T09:00:00Z" })),
    ).toBe("12/9");
    expect(completedDayLabel(makeTask({ id: "day-claimed", doneAt: "2026-09-10T08:00:00Z" }))).toBe("10/9");
    expect(completedDayLabel(makeTask({ id: "open", status: "confirmed", doneAt: null }))).toBeNull();
  });
});
