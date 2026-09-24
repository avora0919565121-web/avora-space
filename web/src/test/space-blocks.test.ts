import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import type { BusinessRecord, BusinessTable } from "@/lib/business-hub";
import { dailyThoughtKey } from "@/lib/daily-thoughts";
import { currentRhythm, motionFor } from "@/lib/motion";
import { AMBIENT_ALPHA, ambientTone, dayPart } from "@/lib/space-ambient";
import {
  attentionItems,
  isBlockVisible,
  planningCounts,
  planningSummary,
  SPACE_BLOCK_COPY,
  SPACE_BLOCK_ORDER,
  upcomingReminders,
} from "@/lib/space-blocks";
import { checklistProgress, nextChecklistPosition, pendingInvitationsFor, type TaskParticipant } from "@/lib/task-collab";
import type { TaskReminder } from "@/lib/task-reminders";
import type { TaskItem } from "@/lib/tasks";

const ME = "u-me";
const TODAY = "2026-09-15";

function makeTask(overrides: Partial<TaskItem> & { id: string }): TaskItem {
  return {
    type: "personal",
    creatorId: ME,
    assigneeId: null,
    contextSnapshot: null,
    conversationId: null,
    title: "Việc",
    description: "Mô tả",
    status: "confirmed",
    confirmedAt: null,
    doneAt: null,
    completedConfirmedAt: null,
    skippedAt: null,
    skippedSilently: false,
    deadline: "2026-09-30",
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

function record(overrides: Partial<BusinessRecord> & { id: string; tableId: string }): BusinessRecord {
  return {
    ownerUserId: ME,
    title: "Mục",
    status: "moi",
    priority: "trung_binh",
    category: null,
    nextActionDate: null,
    remindAt: null,
    tags: [],
    notes: null,
    extensionFields: {},
    projectId: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function table(id: string, name: string, deletedAt: string | null = null): BusinessTable {
  return { id, ownerUserId: ME, name, position: 0, columns: [], createdAt: "", updatedAt: "", deletedAt };
}

describe("Avora Space block order", () => {
  it("is fixed and read from configuration", () => {
    expect(SPACE_BLOCK_ORDER).toEqual(["greeting", "attention", "reminders", "planning", "invitations", "communication"]);
  });

  it("gives every block a description and a tap hint", () => {
    for (const id of SPACE_BLOCK_ORDER) {
      expect(SPACE_BLOCK_COPY[id].description.length).toBeGreaterThan(0);
      expect(SPACE_BLOCK_COPY[id].hint.length).toBeGreaterThan(0);
    }
  });

  it("says the agreed empty lines", () => {
    expect(SPACE_BLOCK_COPY.attention.empty).toBe("Chưa có gì cần làm hôm nay.");
    expect(SPACE_BLOCK_COPY.reminders.empty).toBe("Không có nhắc nhở nào sắp tới.");
  });

  it("hides planning and invitations when empty, and only those", () => {
    expect(isBlockVisible("planning", 0)).toBe(false);
    expect(isBlockVisible("invitations", 0)).toBe(false);
    expect(isBlockVisible("planning", 2)).toBe(true);
    expect(isBlockVisible("attention", 0)).toBe(true);
    expect(isBlockVisible("reminders", 0)).toBe(true);
  });
});

describe("Cần chú ý hôm nay", () => {
  const startToday = new Date(2026, 8, 15, 14, 0).toISOString();
  const startTomorrow = new Date(2026, 8, 16, 9, 0).toISOString();

  it("lists late work, then today's, then today's events", () => {
    const items = attentionItems(
      [
        makeTask({ id: "ev", requiresPresence: true, startAt: startToday }),
        makeTask({ id: "today", deadline: TODAY }),
        makeTask({ id: "late", deadline: "2026-09-10" }),
        makeTask({ id: "later", deadline: "2026-09-20" }),
      ],
      ME,
      TODAY,
    );
    expect(items.map((item) => [item.task.id, item.kind])).toEqual([
      ["late", "overdue"],
      ["today", "today"],
      ["ev", "event"],
    ]);
  });

  it("leaves out an event that starts another day, and closed work", () => {
    const items = attentionItems(
      [
        makeTask({ id: "ev-tmr", requiresPresence: true, startAt: startTomorrow }),
        makeTask({ id: "done", deadline: TODAY, status: "done" }),
      ],
      ME,
      TODAY,
    );
    expect(items).toEqual([]);
  });

  it("does not treat a plain task with a start time as an event", () => {
    const items = attentionItems([makeTask({ id: "t", startAt: startToday })], ME, TODAY);
    expect(items).toEqual([]);
  });
});

describe("Nhắc nhở sắp tới", () => {
  const now = new Date("2026-09-15T02:00:00Z");
  const reminder = (id: string, taskId: string, at: string, isSent = false): TaskReminder => ({
    id,
    taskId,
    at,
    timezone: "Asia/Ho_Chi_Minh",
    offsetMinutes: null,
    isSent,
  });

  it("keeps only the viewer's unsent reminders within 7 days, soonest first", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    const list = upcomingReminders(
      [
        reminder("r3", "a", "2026-09-20T02:00:00Z"),
        reminder("r1", "b", "2026-09-15T05:00:00Z"),
        reminder("past", "a", "2026-09-14T02:00:00Z"),
        reminder("far", "a", "2026-09-30T02:00:00Z"),
        reminder("sent", "a", "2026-09-16T02:00:00Z", true),
      ],
      tasks,
      ME,
      now,
    );
    expect(list.map((entry) => entry.reminder.id)).toEqual(["r1", "r3"]);
  });

  it("drops a reminder whose task is closed or missing", () => {
    const list = upcomingReminders(
      [reminder("r", "gone", "2026-09-16T02:00:00Z"), reminder("r2", "done", "2026-09-16T02:00:00Z")],
      [makeTask({ id: "done", status: "done" })],
      ME,
      now,
    );
    expect(list).toEqual([]);
  });
});

describe("Góc hoạch định", () => {
  const now = new Date(2026, 8, 15, 8, 0);
  const tables = [table("t1", "Khách hàng"), table("t2", "Nhà cung cấp"), table("t3", "Cũ", "2026-09-01")];

  it("counts records whose reminder is due by the end of today, per table", () => {
    const counts = planningCounts(
      [
        record({ id: "1", tableId: "t1", remindAt: new Date(2026, 8, 14, 9).toISOString() }),
        record({ id: "2", tableId: "t1", remindAt: new Date(2026, 8, 15, 17).toISOString() }),
        record({ id: "3", tableId: "t2", remindAt: new Date(2026, 8, 15, 10).toISOString() }),
        record({ id: "4", tableId: "t2", remindAt: new Date(2026, 8, 16, 9).toISOString() }),
        record({ id: "5", tableId: "t2" }),
        record({ id: "6", tableId: "t3", remindAt: new Date(2026, 8, 10).toISOString() }),
      ],
      tables,
      now,
    );
    expect(counts).toEqual([
      { tableId: "t1", tableName: "Khách hàng", count: 2 },
      { tableId: "t2", tableName: "Nhà cung cấp", count: 1 },
    ]);
    expect(planningSummary(counts)).toBe("Khách hàng: 2 · Nhà cung cấp: 1");
  });

  it("is empty when nothing is due, so the block hides", () => {
    expect(planningCounts([record({ id: "1", tableId: "t1" })], tables, now)).toEqual([]);
  });
});

describe("ambient tone", () => {
  it("uses the time of day as a stand-in for weather", () => {
    expect(dayPart(7)).toBe("sang");
    expect(dayPart(12)).toBe("trua");
    expect(dayPart(16)).toBe("chieu");
    expect(dayPart(20)).toBe("toi");
    expect(dayPart(2)).toBe("dem");
  });

  it("is warm in the afternoon and cool at night, always very faint", () => {
    expect(ambientTone(new Date(2026, 8, 15, 16)).warmth).toBeGreaterThan(0);
    expect(ambientTone(new Date(2026, 8, 15, 2)).warmth).toBeLessThan(0);
    expect(AMBIENT_ALPHA).toBeLessThanOrEqual(0.12);
  });
});

describe("motion tokens", () => {
  it("maps reduced motion to Tĩnh and the short duration", () => {
    expect(currentRhythm(true)).toBe("tinh");
    expect(currentRhythm(false)).toBe("can_bang");
    expect(motionFor("tinh").durationMs).toBe(150);
    expect(motionFor("can_bang").durationMs).toBe(280);
  });

  it("only ever transitions opacity", () => {
    for (const rhythm of ["tinh", "can_bang"] as const) {
      expect(motionFor(rhythm).transition.startsWith("opacity ")).toBe(true);
      expect(motionFor(rhythm).transition).not.toMatch(/transform|scale|translate/);
    }
  });
});

describe("daily thought key", () => {
  it("is category plus the local day", () => {
    expect(dailyThoughtKey("danh_ngon", new Date(2026, 8, 5, 23, 30))).toBe("danh_ngon:2026-09-05");
  });

  it("matches the shape the database accepts", () => {
    expect(dailyThoughtKey("kinh_thanh", new Date(2026, 0, 1))).toMatch(/^[a-z_]{1,32}:\d{4}-\d{2}-\d{2}$/);
  });
});

describe("task collaboration rules", () => {
  const row = (id: string, userId: string, status: TaskParticipant["status"]): TaskParticipant => ({
    id,
    taskId: "t",
    userId,
    status,
    invitedBy: "u-peer",
    invitedAt: "",
    respondedAt: null,
  });

  it("counts only invitations still waiting on me", () => {
    const pending = pendingInvitationsFor(
      [row("1", ME, "pending"), row("2", ME, "declined"), row("3", "u-other", "pending"), row("4", ME, "accepted")],
      ME,
    );
    expect(pending.map((entry) => entry.id)).toEqual(["1"]);
    expect(pendingInvitationsFor([row("1", ME, "pending")], undefined)).toEqual([]);
  });

  it("reports checklist progress and appends after the last position", () => {
    const items = [
      { id: "a", taskId: "t", content: "x", position: 0, completed: true, completedAt: "now" },
      { id: "b", taskId: "t", content: "y", position: 4, completed: false, completedAt: null },
    ];
    expect(checklistProgress(items)).toEqual({ done: 1, total: 2 });
    expect(checklistProgress([])).toBeNull();
    expect(nextChecklistPosition(items)).toBe(5);
    expect(nextChecklistPosition([])).toBe(0);
  });
});
