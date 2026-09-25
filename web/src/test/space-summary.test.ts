import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the modules pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  PULSE_LABELS,
  pulseHref,
  pulseSentence,
  spaceDateLabel,
  taskPulse,
} from "@/lib/space-summary";
import { openCountsByScope } from "@/lib/task-scope";
import { thoughtNoteContent, THOUGHT_NOTE_MAX_LEN } from "@/lib/thought-note";
import { countOpenTasks, type TaskItem } from "@/lib/tasks";

const ME = "u-me";
const PEER = "u-peer";
const TODAY = "2026-09-15";

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
    deadline: TODAY,
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

describe("three numbers that divide the same pile", () => {
  const tasks = [
    makeTask({ id: "late-1", deadline: "2026-09-10" }),
    makeTask({ id: "late-2", deadline: "2026-09-14" }),
    makeTask({ id: "today-1", deadline: TODAY }),
    makeTask({ id: "ahead-1", deadline: "2026-09-30" }),
    makeTask({ id: "ahead-undated", deadline: null }),
  ];

  it("counts late, due today and ahead", () => {
    const pulse = taskPulse(tasks, ME, TODAY);
    expect(pulse.overdue).toBe(2);
    expect(pulse.today).toBe(1);
    expect(pulse.ahead).toBe(2);
  });

  it("the three always add up to the total — nothing double-counted, nothing dropped", () => {
    const pulse = taskPulse(tasks, ME, TODAY);
    expect(pulse.overdue + pulse.today + pulse.ahead).toBe(pulse.total);
    expect(pulse.total).toBe(tasks.length);
  });

  it("undated work is ahead, never late", () => {
    const pulse = taskPulse([makeTask({ id: "a", deadline: null })], ME, TODAY);
    expect(pulse.overdue).toBe(0);
    expect(pulse.ahead).toBe(1);
  });

  it("agrees with every other open counter on this page", () => {
    const mixed = [
      ...tasks,
      makeTask({ id: "done", status: "done", doneAt: "2026-09-12T00:00:00Z" }),
      makeTask({ id: "binned", deletedByCreator: true }),
      makeTask({
        id: "shared",
        type: "1-1-shared",
        creatorId: PEER,
        assigneeId: ME,
        conversationId: "conv-1",
        status: "pending_confirmation",
      }),
    ];
    const pulse = taskPulse(mixed, ME, TODAY);
    const scopes = openCountsByScope(mixed, ME);
    expect(pulse.total).toBe(countOpenTasks(mixed, ME));
    expect(pulse.total).toBe(scopes.personal + scopes.direct + scopes.group + scopes.project);
  });

  it("leaves out finished work and what this person has binned", () => {
    const pulse = taskPulse(
      [
        makeTask({ id: "done", status: "done", deadline: "2026-09-01" }),
        makeTask({ id: "binned", deadline: "2026-09-01", deletedByCreator: true }),
      ],
      ME,
      TODAY,
    );
    expect(pulse.total).toBe(0);
  });

  it("an empty day is three zeroes, not an absence", () => {
    const pulse = taskPulse([], ME, TODAY);
    expect(pulse).toEqual({ overdue: 0, today: 0, ahead: 0, total: 0 });
  });

  it("the strip reads late, then today, then ahead", () => {
    expect(PULSE_LABELS.map((entry) => entry.key)).toEqual(["overdue", "today", "ahead"]);
  });
});

describe("the sentence names one fact, not three", () => {
  it("says rest when there is nothing waiting", () => {
    expect(pulseSentence({ overdue: 0, today: 0, ahead: 0, total: 0 })).toContain("Nghỉ tay");
  });

  it("leads with what is late when anything is", () => {
    const line = pulseSentence({ overdue: 2, today: 3, ahead: 1, total: 6 });
    expect(line).toContain("6 việc");
    expect(line).toContain("2 việc đã quá hạn");
  });

  it("falls back to what is due today", () => {
    const line = pulseSentence({ overdue: 0, today: 3, ahead: 1, total: 4 });
    expect(line).toContain("3 việc đến hạn hôm nay");
    expect(line).not.toContain("quá hạn");
  });

  it("says plainly that nothing is due today when nothing is", () => {
    const line = pulseSentence({ overdue: 0, today: 0, ahead: 4, total: 4 });
    expect(line).toContain("chưa có việc nào tới hạn hôm nay");
  });
});

describe("the day beside the greeting", () => {
  it("names the weekday and the date the way it is said aloud", () => {
    expect(spaceDateLabel(new Date(2026, 8, 15))).toBe("Thứ ba, 15 thg 9");
    expect(spaceDateLabel(new Date(2026, 8, 13))).toBe("Chủ nhật, 13 thg 9");
  });
});

describe("a reflection keeps what it was reflecting on", () => {
  it("quotes the line and its speaker above the answer", () => {
    const content = thoughtNoteContent(
      { text: "Mỗi người phải mau nghe, chậm nói, chậm giận.", speaker: "Gia-cơ" },
      "  Hôm nay mình nói nhiều hơn nghe.  ",
    );
    expect(content).toBe(
      "“Mỗi người phải mau nghe, chậm nói, chậm giận.” — Gia-cơ\n\nHôm nay mình nói nhiều hơn nghe.",
    );
  });

  it("quotes an unattributed maxim with no dangling dash", () => {
    const content = thoughtNoteContent(
      { text: "Một ngày sống tử tế là một ngày không phí hoài.", speaker: null },
      "Đồng ý.",
    );
    expect(content).toBe("“Một ngày sống tử tế là một ngày không phí hoài.”\n\nĐồng ý.");
    expect(content).not.toContain("—");
  });

  it("never carries a book, chapter or verse — the view model has no field for one", () => {
    const content = thoughtNoteContent({ text: "Trong mọi hoàn cảnh, hãy biết tạ ơn.", speaker: "Sứ đồ Phao-lô" }, "Ghi lại.");
    expect(content).not.toMatch(/\d+:\d+/);
  });

  it("allows a real reflection without allowing an essay", () => {
    expect(THOUGHT_NOTE_MAX_LEN).toBeGreaterThan(500);
    expect(THOUGHT_NOTE_MAX_LEN).toBeLessThanOrEqual(4000);
  });
});

describe("the three numbers open Nhiệm vụ (AVORA 31)", () => {
  it("sends each number to the section of the same name", () => {
    expect(pulseHref("overdue")).toBe("/nhiem-vu?muc=qua-han");
    expect(pulseHref("today")).toBe("/nhiem-vu?muc=hom-nay");
    expect(pulseHref("ahead")).toBe("/nhiem-vu?muc=sap-toi");
  });
});
