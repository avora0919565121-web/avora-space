import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { completionTimeline } from "@/lib/confetti";
import { calendarProjection, invitationRows, sectionBySlug, tasksForSection, TASK_HUB_SECTIONS } from "@/lib/task-hub";
import type { TaskParticipant } from "@/lib/task-collab";
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

const at = (day: number, hour: number): string => new Date(2026, 8, day, hour, 0).toISOString();

describe("Task Hub sections", () => {
  it("has the ten sections in order, each with a description", () => {
    expect(TASK_HUB_SECTIONS.map((section) => section.label)).toEqual([
      "My Day", "Tasks", "Events", "Upcoming", "Lịch", "Overdue", "Invitations", "Drafts", "Completed", "Trash",
    ]);
    for (const section of TASK_HUB_SECTIONS) expect(section.description.length).toBeGreaterThan(0);
  });

  it("marks Drafts as coming soon and falls back to Tasks for an unknown slug", () => {
    expect(sectionBySlug("nhap").isComingSoon).toBe(true);
    expect(sectionBySlug("khong-co").id).toBe("tasks");
    expect(sectionBySlug(null).id).toBe("tasks");
  });

  const tasks = [
    makeTask({ id: "today", deadline: TODAY }),
    makeTask({ id: "late", deadline: "2026-09-10" }),
    makeTask({ id: "event-today", requiresPresence: true, startAt: at(15, 14) }),
    makeTask({ id: "event-later", requiresPresence: true, startAt: at(18, 9) }),
    makeTask({ id: "event-past", requiresPresence: true, startAt: at(12, 9), deadline: "2026-09-12" }),
    makeTask({ id: "done", status: "done", doneAt: "2026-09-14T00:00:00Z" }),
    makeTask({ id: "binned", deletedByCreator: true }),
  ];

  it("My Day holds today's deadlines and today's events", () => {
    expect(tasksForSection("my_day", tasks, ME, TODAY).map((t) => t.id).sort()).toEqual(["event-today", "today"]);
  });

  it("Events lists only presence tasks from today on, by start", () => {
    expect(tasksForSection("events", tasks, ME, TODAY).map((t) => t.id)).toEqual(["event-today", "event-later"]);
  });

  it("Overdue, Completed and Trash each read their own slice", () => {
    expect(tasksForSection("overdue", tasks, ME, TODAY).map((t) => t.id).sort()).toEqual(["event-past", "late"]);
    expect(tasksForSection("completed", tasks, ME, TODAY).map((t) => t.id)).toEqual(["done"]);
    expect(tasksForSection("trash", tasks, ME, TODAY).map((t) => t.id)).toEqual(["binned"]);
  });
});

describe("calendar is a projection of tasks", () => {
  it("draws an Event as a block and a plain task as a deadline marker", () => {
    const days = calendarProjection(
      [
        makeTask({ id: "ev", requiresPresence: true, startAt: at(16, 10), endAt: at(16, 11) }),
        makeTask({ id: "plain", deadline: "2026-09-16", deadlineTime: "17:00" }),
        makeTask({ id: "far", deadline: "2026-10-30" }),
      ],
      ME,
      TODAY,
      7,
    );
    expect(days).toHaveLength(7);
    expect(days[0].day).toBe(TODAY);
    const tomorrow = days[1];
    expect(tomorrow.entries.map((entry) => [entry.task.id, entry.kind])).toEqual([
      ["ev", "block"],
      ["plain", "marker"],
    ]);
    expect(days.flatMap((day) => day.entries).some((entry) => entry.task.id === "far")).toBe(false);
  });

  it("does not place an Event on its deadline day as well", () => {
    const days = calendarProjection(
      [makeTask({ id: "ev", requiresPresence: true, startAt: at(16, 10), deadline: "2026-09-17" })],
      ME,
      TODAY,
    );
    expect(days.flatMap((day) => day.entries)).toHaveLength(1);
  });
});

describe("invitations", () => {
  it("joins my pending invitations to their tasks", () => {
    const row = (id: string, userId: string, status: TaskParticipant["status"]): TaskParticipant => ({
      id, taskId: "t1", userId, status, invitedBy: "u-peer", invitedAt: "", respondedAt: null,
    });
    const rows = invitationRows([row("a", ME, "pending"), row("b", ME, "accepted"), row("c", "u-x", "pending")], [makeTask({ id: "t1" })], ME);
    expect(rows.map((entry) => [entry.participant.id, entry.task?.id])).toEqual([["a", "t1"]]);
  });
});

describe("completion moment", () => {
  it("uses the short token when motion is reduced and the gentle one otherwise, played once", () => {
    expect(completionTimeline(true)).toEqual({ fadeMs: 150, holdMs: 150, totalMs: 450 });
    expect(completionTimeline(false)).toEqual({ fadeMs: 280, holdMs: 280, totalMs: 840 });
  });
});
