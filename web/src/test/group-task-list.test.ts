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

const HOA = member({ userId: "u-hoa", displayName: "Nguyễn Thị Hoà" });
const DUNG = member({ userId: "u-dung", displayName: "Trần Dũng" });
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

// ------------------------------------------------------------ AVORA-39 / Phần 1 · Nhóm D

import { assigneeChips, buildTaskListEntries, countByKind, isSettledEntry } from "@/lib/group-task-list";
import { classifyProjectTask, taskLink } from "@/lib/task-scope";
import type { TaskSuggestion } from "@/lib/task-suggestions";
import { recordLink, recordPath, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";

function suggestion(overrides: Partial<TaskSuggestion> & { id: string }): TaskSuggestion {
  return {
    startAt: null,
    endAt: null,
    location: null,
    requiresPresence: false,
    recordId: null,
    projectId: null,
    conversationId: "conv-project",
    messageId: null,
    proposerId: "u-hoa",
    assigneeId: "u-dung",
    title: `Gợi ý ${overrides.id}`,
    description: "",
    deadline: "2026-10-01",
    deadlineTime: null,
    deadlineTz: "Asia/Ho_Chi_Minh",
    contextSnapshot: null,
    status: "pending",
    skippedSilently: false,
    acceptedTaskId: null,
    resolvedAt: null,
    createdAt: "2026-09-27T00:00:00Z",
    ...overrides,
  };
}

describe("classifyProjectTask", () => {
  it("planned only when a Hạng mục is named", () => {
    expect(classifyProjectTask("rec-1")).toBe("planned");
    expect(classifyProjectTask(null)).toBe("adhoc");
    expect(classifyProjectTask(undefined)).toBe("adhoc");
    expect(classifyProjectTask("")).toBe("adhoc");
  });

  it("taskLink opens Việc on one task", () => {
    expect(taskLink("t 1")).toBe("/nhiem-vu?muc=viec&mo=t%201");
  });
});

describe("buildTaskListEntries — project chat", () => {
  const tasks = [
    task({ id: "chat-adhoc", assigneeId: "u-hoa", conversationId: "conv-project" }),
    task({ id: "from-table", assigneeId: "u-hoa", conversationId: "conv-project" }),
    task({ id: "parent-linked", assigneeId: "u-dung", conversationId: "conv-parent" }),
    task({ id: "parent-planned", assigneeId: "u-dung", conversationId: "conv-parent" }),
    task({ id: "elsewhere", assigneeId: "u-dung", conversationId: "conv-other" }),
    task({ id: "done-one", assigneeId: "u-hoa", conversationId: "conv-project", status: "done" }),
  ];
  const entries = buildTaskListEntries({
    conversationId: "conv-project",
    projectId: "p1",
    tasks,
    projectLinks: [
      { taskId: "from-table", projectId: "p1", recordId: "rec-1" },
      { taskId: "parent-linked", projectId: "p1", recordId: null },
      { taskId: "parent-planned", projectId: "p1", recordId: "rec-2" },
      { taskId: "elsewhere", projectId: "p-other", recordId: "rec-9" },
    ],
    recordTaskLinks: [],
    suggestions: [
      suggestion({ id: "s-pending" }),
      suggestion({ id: "s-answered", status: "accepted" }),
      suggestion({ id: "s-other-chat", conversationId: "conv-other" }),
    ],
  });

  it("takes the chat's work, the project's links (parent group included) and pending suggestions", () => {
    expect(entries.map((entry) => entry.id).sort()).toEqual(
      ["chat-adhoc", "done-one", "from-table", "parent-linked", "parent-planned", "s-pending"].sort(),
    );
  });

  it("splits planned / adhoc / pending and counts them", () => {
    const kindOf = new Map(entries.map((entry) => [entry.id, entry.kind] as const));
    expect(kindOf.get("from-table")).toBe("planned");
    expect(kindOf.get("parent-planned")).toBe("planned");
    expect(kindOf.get("parent-linked")).toBe("adhoc");
    expect(kindOf.get("chat-adhoc")).toBe("adhoc");
    expect(kindOf.get("s-pending")).toBe("pending");
    expect(countByKind(entries)).toEqual({ planned: 2, adhoc: 3, pending: 1 });
  });

  it("never adds what the viewer cannot read: an unseen parent task is simply absent, not counted", () => {
    const withoutParent = buildTaskListEntries({
      conversationId: "conv-project",
      projectId: "p1",
      tasks: tasks.filter((entry) => entry.conversationId !== "conv-parent"),
      projectLinks: [{ taskId: "parent-linked", projectId: "p1", recordId: null }],
      recordTaskLinks: [],
      suggestions: [],
    });
    expect(withoutParent.some((entry) => entry.id === "parent-linked")).toBe(false);
    // chat-adhoc, done-one, and from-table (its project link is not in this set, so it is ad-hoc here).
    expect(countByKind(withoutParent)).toEqual({ planned: 0, adhoc: 3, pending: 0 });
  });

  it("folds settled work and chips people by the work they carry", () => {
    expect(entries.filter(isSettledEntry).map((entry) => entry.id)).toEqual(["done-one"]);
    const chips = assigneeChips(entries, MEMBERS, "u-hoa");
    expect(chips.map((chip) => [chip.key, chip.count])).toEqual([
      ["u-hoa", 3],
      ["u-dung", 3],
    ]);
    expect(chips[0]?.name).toContain("(bạn)");
  });
});

describe("buildTaskListEntries — ordinary group", () => {
  it("reads the group's table links as planned and ignores project links", () => {
    const entries = buildTaskListEntries({
      conversationId: "conv-1",
      projectId: null,
      tasks: [task({ id: "a", assigneeId: "u-hoa" }), task({ id: "b", assigneeId: "u-hoa" })],
      projectLinks: [{ taskId: "b", projectId: "p1", recordId: "rec-x" }],
      recordTaskLinks: [{ taskId: "a", recordId: "rec-g" }],
      suggestions: [],
    });
    expect(entries.map((entry) => [entry.id, entry.kind])).toEqual([
      ["a", "planned"],
      ["b", "adhoc"],
    ]);
  });
});

describe("recordPath / recordLink", () => {
  const table = (id: string, name: string, parentRecordId: string | null): ThinkTable =>
    ({ id, name, parentRecordId, depth: parentRecordId === null ? 1 : 2 }) as unknown as ThinkTable;
  const record = (id: string, tableId: string, title: string): ThinkRecord =>
    ({ id, tableId, title }) as unknown as ThinkRecord;
  const tables = [table("root", "Kế hoạch dự án", null), table("sub", "Thiết bị", "r-parent")];
  const records = [record("r-parent", "root", "Nhập khẩu"), record("r-sub", "sub", "Máy nén"), record("r-root", "root", "Pháp lý")];

  it("names a root Hạng mục as Bảng › Hạng mục", () => {
    expect(recordPath(tables, records, "r-root")).toEqual({ label: "Kế hoạch dự án › Pháp lý", tableId: "root" });
  });

  it("names a sub-table Hạng mục as Hạng mục cha › Bảng con › Hạng mục", () => {
    expect(recordPath(tables, records, "r-sub")).toEqual({ label: "Nhập khẩu › Thiết bị › Máy nén", tableId: "sub" });
  });

  it("returns null for a Hạng mục out of reach, and builds the Kế hoạch link", () => {
    expect(recordPath(tables, records, "gone")).toBeNull();
    expect(recordLink("sub", "r-sub", "t1")).toBe("/ke-hoach?bang=sub&hang-muc=r-sub&nhiem-vu=t1");
    expect(recordLink("sub", "r-sub")).toBe("/ke-hoach?bang=sub&hang-muc=r-sub");
  });
});
