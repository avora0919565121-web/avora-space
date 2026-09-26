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
  groupActionItemsByAgenda,
  hasAnyDetail,
  meetingFileMimeType,
  meetingFileRejection,
  meetingStage,
  pendingTaskCount,
  removeAgendaItem,
  createTaskBlocker,
  parseSavedMeetingNote,
  tasksTakingEffect,
  toSavePayload,
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

describe("the two stages of a note (AVORA 32)", () => {
  it("is the plan until someone starts the meeting", () => {
    expect(meetingStage(undefined)).toBe(1);
    expect(meetingStage(details())).toBe(1);
    expect(meetingStage(details({ meetingStartedAt: "2026-09-25T02:00:00Z" }))).toBe(2);
  });

  it("counts when and where as part of the plan", () => {
    expect(hasAnyDetail(details({ scheduledAt: "2026-09-26T02:00:00Z" }))).toBe(true);
    expect(hasAnyDetail(details({ location: "Phòng 3" }))).toBe(true);
  });

  it("groups action items under their agenda line, keeping their list position", () => {
    const value = details({
      agendaItems: ["Ngân sách", "Nhân sự"],
      actionItems: [
        action({ description: "Rời", agendaIndex: null }),
        action({ description: "NS", agendaIndex: 0 }),
        action({ description: "Nhân", agendaIndex: 1 }),
        action({ description: "Lạc", agendaIndex: 7 }),
      ],
    });
    const grouped = groupActionItemsByAgenda(value);
    expect(grouped.byAgenda[0].map((entry) => entry.index)).toEqual([1]);
    expect(grouped.byAgenda[1].map((entry) => entry.index)).toEqual([2]);
    // A line pointing past the agenda is shown loose rather than lost.
    expect(grouped.loose.map((entry) => entry.index)).toEqual([0, 3]);
  });

  it("keeps decisions when an agenda line is removed, and re-points the lines after it", () => {
    const value = details({
      agendaItems: ["A", "B", "C"],
      actionItems: [action({ agendaIndex: 0 }), action({ agendaIndex: 1 }), action({ agendaIndex: 2 })],
    });
    const next = removeAgendaItem(value, 1);
    expect(next.agendaItems).toEqual(["A", "C"]);
    expect(next.actionItems.map((item) => item.agendaIndex)).toEqual([0, null, 1]);
  });

  it("re-points action items when blank agenda lines are dropped on save", () => {
    const payload = toSavePayload(
      details({
        agendaItems: ["A", "  ", "C"],
        actionItems: [
          action({ description: "under C", agendaIndex: 2 }),
          action({ description: "under blank", agendaIndex: 1 }),
          action({ description: "", agendaIndex: 0 }),
        ],
      }),
    );
    expect(payload.agendaItems).toEqual(["A", "C"]);
    expect(payload.actionItems.map((item) => [item.description, item.agenda_index])).toEqual([
      ["under C", 1],
      ["under blank", null],
    ]);
  });
});

describe("the custom minutes file", () => {
  it("takes Word or PDF, by type or by name", () => {
    expect(meetingFileMimeType({ name: "a.pdf", type: "application/pdf" })).toBe("application/pdf");
    expect(meetingFileMimeType({ name: "Bên bản.DOCX", type: "" })).toContain("wordprocessingml");
    expect(meetingFileMimeType({ name: "old.doc", type: "" })).toBe("application/msword");
    expect(meetingFileMimeType({ name: "photo.png", type: "image/png" })).toBeNull();
  });

  it("says why a file is refused", () => {
    expect(meetingFileRejection({ name: "x.png", type: "image/png", size: 10 })).toContain("Word");
    expect(meetingFileRejection({ name: "x.pdf", type: "application/pdf", size: 30 * 1024 * 1024 })).toContain("25 MB");
    expect(meetingFileRejection({ name: "x.pdf", type: "application/pdf", size: 1000 })).toBeNull();
  });
});

describe("a meeting note saved into Diary", () => {
  const G = "11111111-1111-1111-1111-111111111111";
  const D = "22222222-2222-2222-2222-222222222222";

  it("is read back off the note's own words", () => {
    const saved = parseSavedMeetingNote(
      `📋 Biên bản họp: Họp tuần\nNhóm A · khoá ngày 25/09/2026\nMẫu riêng: bb.pdf\n/tin-nhan/${G}?so-quyet-dinh=${D}`,
    );
    expect(saved?.title).toBe("Họp tuần");
    expect(saved?.fileName).toBe("bb.pdf");
    expect(saved?.groupId).toBe(G);
    expect(saved?.decisionId).toBe(D);
    expect(saved?.href).toBe(`/tin-nhan/${G}?so-quyet-dinh=${D}`);
  });

  it("ignores ordinary notes", () => {
    expect(parseSavedMeetingNote("Mai họp lúc 9h")).toBeNull();
  });
});

describe("Tạo việc straight from a decision (chờ hiệu lực)", () => {
  it("needs a decision, a person and a date first", () => {
    expect(createTaskBlocker(action())).toContain("quyết định");
    expect(createTaskBlocker(action({ description: "Gửi báo giá" }))).toContain("đảm trách");
    expect(createTaskBlocker(action({ description: "Gửi báo giá", assigneeId: ALICE }))).toContain("thời gian");
    expect(
      createTaskBlocker(action({ description: "Gửi báo giá", assigneeId: ALICE, deadline: "2026-10-01" })),
    ).toBeNull();
  });

  it("counts every waiting task as taking effect at lock", () => {
    const value = details({
      actionItems: [
        action({ description: "A", taskId: "t1" }),
        action({ description: "B", createTask: true }),
        action({ description: "C" }),
      ],
    });
    expect(tasksTakingEffect(value)).toBe(2);
  });

  it("keeps a line that already owns a task when saving, even if its words were cleared", () => {
    const payload = toSavePayload(details({ actionItems: [action({ description: "", taskId: "t1" })] }));
    expect(payload.actionItems).toHaveLength(1);
    expect(payload.actionItems[0].task_id).toBe("t1");
  });
});
