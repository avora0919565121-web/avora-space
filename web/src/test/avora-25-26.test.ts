import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { canCreateSubGroup, MAX_GROUP_DEPTH } from "@/lib/groups";
import { deleteConfirmMatches, isProjectOpen, projectChatLink, projectStatusLabel } from "@/lib/projects";
import { tasksForSection } from "@/lib/task-hub";
import { isOnMyDay, type TaskFlagValue } from "@/lib/tasks";
import { clampColumnWidth, parseColumnDefs, visibleColumns } from "@/lib/think-hub";

describe("columns: width and hiding", () => {
  it("keeps width and hidden from the stored shape, clamped to the server's bounds", () => {
    const [a, b] = parseColumnDefs([
      { id: "a", key: "a", label: "Giá", type: "number", width: 5000, hidden: true },
      { id: "b", key: "b", label: "Ghi chú", type: "text" },
    ]);
    expect(a.width).toBe(800);
    expect(a.hidden).toBe(true);
    expect(b.width).toBeUndefined();
    expect(visibleColumns([a, b]).map((column) => column.id)).toEqual(["b"]);
    expect(clampColumnWidth(10)).toBe(60);
  });
});

describe("Hôm nay is per person and lapses at midnight", () => {
  const flags = new Map<string, TaskFlagValue>([
    ["t1", { isImportant: false, durationMinutes: null, startedAt: null, myDayOn: "2026-09-25" }],
  ]);

  it("counts only on the day it was added", () => {
    expect(isOnMyDay(flags, "t1", "2026-09-25")).toBe(true);
    expect(isOnMyDay(flags, "t1", "2026-09-26")).toBe(false);
    expect(isOnMyDay(flags, "t2", "2026-09-25")).toBe(false);
  });

  it("puts a task on Hôm nay without touching its deadline", () => {
    const task = {
      id: "t1",
      type: "personal",
      creatorId: "u1",
      status: "confirmed",
      deadline: "2026-10-30",
      requiresPresence: false,
      startAt: null,
      deletedByCreator: false,
      deletedByPeer: false,
    } as unknown as Parameters<typeof tasksForSection>[1][number];
    expect(tasksForSection("my_day", [task], "u1", "2026-09-25").length).toBe(0);
    expect(tasksForSection("my_day", [task], "u1", "2026-09-25", flags).map((entry) => entry.id)).toEqual(["t1"]);
  });
});

describe("project lifecycle helpers", () => {
  it("reads closed and early-closed projects as read-only, with a status word", () => {
    expect(isProjectOpen({ status: "active" })).toBe(true);
    expect(isProjectOpen({ status: "done" })).toBe(false);
    expect(projectStatusLabel("closed_early")).toBe("Đã dừng sớm");
    expect(projectStatusLabel("active")).toBeNull();
  });

  it("asks for the exact title before deleting", () => {
    expect(deleteConfirmMatches({ title: "HANA" }, "  HANA ")).toBe(true);
    expect(deleteConfirmMatches({ title: "HANA" }, "hana")).toBe(false);
  });

  it("opens a project into its own sub-group chat", () => {
    expect(projectChatLink({ conversationId: "c-sub" })).toBe("/tin-nhan/c-sub");
  });

  it("lets only the owner or admin open a sub-group, three levels deep at most", () => {
    expect(canCreateSubGroup("owner")).toBe(true);
    expect(canCreateSubGroup("admin")).toBe(true);
    expect(canCreateSubGroup("member")).toBe(false);
    expect(MAX_GROUP_DEPTH).toBe(3);
  });
});
