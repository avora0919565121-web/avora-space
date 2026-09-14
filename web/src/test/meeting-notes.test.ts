import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  actionItemBlocker,
  actionItemBlockers,
  canFinalizeWithDetails,
  emptyActionItem,
  emptyDetails,
  hasAnyDetail,
  pendingTaskCount,
  type ActionItem,
  type MeetingNoteDetails,
} from "@/lib/meeting-notes";

const NOTE = "note-1";
const ALICE = "u-alice";

function details(overrides: Partial<MeetingNoteDetails> = {}): MeetingNoteDetails {
  return { ...emptyDetails(NOTE), ...overrides };
}

function action(overrides: Partial<ActionItem> = {}): ActionItem {
  return { ...emptyActionItem(), ...overrides };
}

describe("a note with nothing structured in it", () => {
  /**
   * The whole template is optional. A note carrying only a title and what was agreed is a
   * perfectly good note, and must not be treated as half-finished.
   */
  it("is recognised as having no details at all", () => {
    expect(hasAnyDetail(emptyDetails(NOTE))).toBe(false);
  });

  it("can still be locked", () => {
    expect(canFinalizeWithDetails(emptyDetails(NOTE))).toBe(true);
    expect(canFinalizeWithDetails(undefined)).toBe(true);
  });

  it("notices as soon as any single field carries something", () => {
    expect(hasAnyDetail(details({ meetingType: "Họp tuần" }))).toBe(true);
    expect(hasAnyDetail(details({ objective: "Chốt kế hoạch" }))).toBe(true);
    expect(hasAnyDetail(details({ attendeeIds: [ALICE] }))).toBe(true);
    expect(hasAnyDetail(details({ absenteeIds: [ALICE] }))).toBe(true);
    expect(hasAnyDetail(details({ agendaItems: ["Rà soát"] }))).toBe(true);
    expect(hasAnyDetail(details({ decisionsMade: "Đẩy mốc sang 15/10" }))).toBe(true);
    expect(hasAnyDetail(details({ actionItems: [action()] }))).toBe(true);
    expect(hasAnyDetail(details({ risksIssues: "Nhà cung cấp chậm" }))).toBe(true);
    expect(hasAnyDetail(details({ nextMeetingAt: "2026-10-01T02:00:00Z" }))).toBe(true);
    expect(hasAnyDetail(details({ referenceLinks: ["https://example.com"] }))).toBe(true);
  });

  it("treats whitespace as empty rather than as content", () => {
    expect(hasAnyDetail(details({ meetingType: "   ", decisionsMade: "\n" }))).toBe(false);
  });
});

describe("an action item that is not going to become a task", () => {
  /** An unticked line is a note to self. It needs nothing and blocks nothing. */
  it("needs nothing at all", () => {
    expect(actionItemBlocker(action({ createTask: false }))).toBeNull();
    expect(actionItemBlocker(action({ description: "", createTask: false }))).toBeNull();
  });
});

describe("an action item that IS going to become a task", () => {
  /**
   * A task needs someone to carry it, a day it is due, and a description. The server refuses
   * the entire finalize when one is missing — deliberately, so work is never dropped in
   * silence — which means the form has to be able to name the short line first.
   */
  it("needs a description", () => {
    expect(
      actionItemBlocker(action({ createTask: true, assigneeId: ALICE, deadline: "2026-09-30" })),
    ).toContain("mô tả");
  });

  it("needs someone to carry it", () => {
    expect(
      actionItemBlocker(action({ createTask: true, description: "Gửi kế hoạch", deadline: "2026-09-30" })),
    ).toContain("người phụ trách");
  });

  it("needs a deadline", () => {
    expect(
      actionItemBlocker(action({ createTask: true, description: "Gửi kế hoạch", assigneeId: ALICE })),
    ).toContain("hạn");
  });

  it("is ready once all three are there", () => {
    expect(
      actionItemBlocker(
        action({
          createTask: true,
          description: "Gửi kế hoạch",
          assigneeId: ALICE,
          deadline: "2026-09-30",
        }),
      ),
    ).toBeNull();
  });

  it("reports the first missing part, one thing at a time", () => {
    // Nothing filled in: the description is named, not all three at once.
    expect(actionItemBlocker(action({ createTask: true }))).toContain("mô tả");
  });
});

describe("blocking the lock", () => {
  it("points at the line that is short, by position", () => {
    const items = [
      action({ description: "Xong rồi", assigneeId: ALICE, deadline: "2026-09-30", createTask: true }),
      action({ description: "Chưa có ai", deadline: "2026-09-30", createTask: true }),
      action({ description: "Ghi chú thôi", createTask: false }),
    ];
    const blockers = actionItemBlockers(items);
    expect(blockers.size).toBe(1);
    expect(blockers.get(1)).toContain("người phụ trách");
  });

  it("refuses to offer the lock while a ticked line is incomplete", () => {
    const bad = details({ actionItems: [action({ description: "Thiếu người", createTask: true })] });
    expect(canFinalizeWithDetails(bad)).toBe(false);
  });

  it("allows the lock when every ticked line is complete", () => {
    const good = details({
      actionItems: [
        action({ description: "Gửi kế hoạch", assigneeId: ALICE, deadline: "2026-09-30", createTask: true }),
        action({ description: "Chỉ là ghi chú", createTask: false }),
      ],
    });
    expect(canFinalizeWithDetails(good)).toBe(true);
  });
});

describe("how many tasks locking will hand out", () => {
  it("counts only the ticked lines", () => {
    const value = details({
      actionItems: [
        action({ description: "A", assigneeId: ALICE, deadline: "2026-09-30", createTask: true }),
        action({ description: "B", assigneeId: ALICE, deadline: "2026-09-30", createTask: true }),
        action({ description: "C", createTask: false }),
      ],
    });
    expect(pendingTaskCount(value)).toBe(2);
  });

  /**
   * The guard against doing the work twice. A line already stamped with the task it produced
   * is history, so re-locking a note cannot re-issue it — and the button must not claim it
   * will.
   */
  it("ignores lines that already produced a task", () => {
    const value = details({
      actionItems: [
        action({
          description: "Đã tạo",
          assigneeId: ALICE,
          deadline: "2026-09-30",
          createTask: true,
          taskId: "task-1",
        }),
        action({ description: "Chưa tạo", assigneeId: ALICE, deadline: "2026-09-30", createTask: true }),
      ],
    });
    expect(pendingTaskCount(value)).toBe(1);
  });

  it("counts nothing for a note with no details", () => {
    expect(pendingTaskCount(undefined)).toBe(0);
    expect(pendingTaskCount(emptyDetails(NOTE))).toBe(0);
  });
});
