import { describe, expect, it, vi } from "vitest";

// The member type lives in the module that owns the Supabase client.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import type { GroupMember } from "@/lib/groups";
import {
  filterMemberSections,
  groupTasksByAssignee,
  type MemberTasks,
} from "@/lib/group-task-list";
import type { TaskItem } from "@/lib/tasks";

function member(overrides: Partial<GroupMember> & { userId: string }): GroupMember {
  return {
    displayName: null,
    email: null,
    role: "member",
    joinedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function task(overrides: Partial<TaskItem> & { id: string; assigneeId: string | null }): TaskItem {
  return {
    type: "group-shared",
    creatorId: "u-creator",
    contextSnapshot: null,
    conversationId: "conv-1",
    title: `Việc ${overrides.id}`,
    description: "mô tả",
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

const HOA = member({ userId: "u-hoa", displayName: "Nguyễn Thị Hoà", email: "hoa@avora.vn" });
const DUNG = member({ userId: "u-dung", displayName: "Trần Dũng", email: "dung@avora.vn" });
const MEMBERS: GroupMember[] = [HOA, DUNG];

describe("groupTasksByAssignee", () => {
  it("gathers each member's tasks under their own heading", () => {
    const tasks = [
      task({ id: "t1", assigneeId: "u-hoa" }),
      task({ id: "t2", assigneeId: "u-hoa" }),
      task({ id: "t3", assigneeId: "u-dung" }),
    ];
    const sections = groupTasksByAssignee(tasks, MEMBERS, undefined);
    expect(sections.map((section) => section.key)).toEqual(["u-hoa", "u-dung"]);
    expect(sections[0]?.tasks.map((entry) => entry.id)).toEqual(["t1", "t2"]);
  });

  it("keeps tasks whose assignee left the group in a heading of their own", () => {
    const tasks = [task({ id: "t1", assigneeId: "u-gone" })];
    const sections = groupTasksByAssignee(tasks, MEMBERS, undefined);
    expect(sections.map((section) => section.key)).toEqual(["unassigned"]);
    expect(sections[0]?.tasks).toHaveLength(1);
  });

  it("leaves members with nothing on their plate out of the list", () => {
    const tasks = [task({ id: "t1", assigneeId: "u-dung" })];
    const sections = groupTasksByAssignee(tasks, MEMBERS, undefined);
    expect(sections.map((section) => section.key)).toEqual(["u-dung"]);
  });
});

describe("filterMemberSections", () => {
  const sections: MemberTasks[] = [
    { key: "u-hoa", name: "Nguyễn Thị Hoà", tasks: [task({ id: "t1", assigneeId: "u-hoa" })] },
    { key: "u-dung", name: "Trần Dũng", tasks: [task({ id: "t2", assigneeId: "u-dung" })] },
    {
      key: "unassigned",
      name: "Chưa rõ người đảm trách",
      tasks: [task({ id: "t3", assigneeId: null })],
    },
  ];

  it("keeps everything when nothing is picked", () => {
    expect(filterMemberSections(sections, null)).toEqual(sections);
  });

  it("narrow the list to the picked member's section alone", () => {
    const picked = filterMemberSections(sections, "u-dung");
    expect(picked).toHaveLength(1);
    expect(picked[0]?.key).toBe("u-dung");
    expect(picked[0]?.tasks.map((entry) => entry.id)).toEqual(["t2"]);
  });

  it("can narrow to the unassigned pile too", () => {
    const picked = filterMemberSections(sections, "unassigned");
    expect(picked).toHaveLength(1);
    expect(picked[0]?.key).toBe("unassigned");
  });

  it("answers a stale pick with nothing, which is the caller's cue to speak in words", () => {
    expect(filterMemberSections(sections, "u-gone")).toEqual([]);
  });
});
