import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  canClose,
  charterProblem,
  closeBlockers,
  closeBlockerSentence,
  EMPTY_CHARTER,
  isCriterionRecorded,
  isProjectOwner,
  isTaskComplete,
  projectLink,
  projectProgress,
  taskIdsOf,
  taskProgress,
  toVietnameseProjectError,
  type Project,
  type ProjectTaskLink,
  type SuccessCriterion,
} from "@/lib/projects";
import { groupProjectsOnly } from "@/lib/use-projects";

const OWNER = "u1";
const MEMBER = "u2";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    conversationId: "c1",
    parentGroupId: null,
    createdBy: OWNER,
    title: "Ra mắt bản thử",
    valueOrientation: "Phục vụ khách",
    objective: "Giao đúng hạn",
    scope: null,
    assumptions: null,
    startDate: "2026-09-20",
    targetEndDate: "2026-10-20",
    status: "active",
    closedAt: null,
    thanksMessageId: null,
    deletedAt: null,
    deleteReason: null,
    createdAt: "2026-09-17T08:00:00.000Z",
    updatedAt: "2026-09-17T08:00:00.000Z",
    ...overrides,
  };
}

function link(taskId: string, recordId: string | null): ProjectTaskLink {
  return { taskId, projectId: "p1", recordId, linkedBy: OWNER };
}

function criterion(overrides: Partial<SuccessCriterion> = {}): SuccessCriterion {
  return {
    id: "c1",
    projectId: "p1",
    description: "Doanh số",
    measurementType: "percentage",
    targetPercent: 100,
    actualPercent: null,
    meetingNoteId: null,
    createdAt: "2026-09-20T00:00:00Z",
    ...overrides,
  };
}

describe("the charter a project is opened with", () => {
  const full = {
    ...EMPTY_CHARTER,
    title: "HANA",
    valueOrientation: "Ánh sáng tốt hơn",
    objective: "Lắp xong 40 đèn",
    startDate: "2026-09-25",
    targetEndDate: "2026-11-01",
  };

  it("accepts the four required answers and two dates", () => {
    expect(charterProblem(full)).toBeNull();
  });

  it("asks for Kim chỉ nam and Mục tiêu separately", () => {
    expect(charterProblem({ ...full, valueOrientation: "  " })).toMatch(/Kim chỉ nam/);
    expect(charterProblem({ ...full, objective: "" })).toMatch(/Mục tiêu/);
  });

  it("never fills a date in for the person — both must be chosen", () => {
    expect(EMPTY_CHARTER.startDate).toBe("");
    expect(EMPTY_CHARTER.targetEndDate).toBe("");
    expect(charterProblem({ ...full, startDate: "" })).toMatch(/ngày bắt đầu/);
    expect(charterProblem({ ...full, targetEndDate: "" })).toMatch(/kết thúc/);
  });

  it("refuses an end before the start", () => {
    expect(charterProblem({ ...full, targetEndDate: "2026-09-01" })).toMatch(/không được trước/);
  });
});

describe("tasks under Hạng mục and ad-hoc", () => {
  const links = [link("t1", "r1"), link("t2", "r1"), link("t3", null)];

  it("files tasks under their record, and ad-hoc ones under null", () => {
    expect(taskIdsOf(links, "r1")).toEqual(["t1", "t2"]);
    expect(taskIdsOf(links, null)).toEqual(["t3"]);
  });

  it("counts only a task both sides have closed", () => {
    expect(isTaskComplete("done")).toBe(true);
    expect(isTaskComplete("done_pending_review")).toBe(false);
  });

  it("computes progress from the tasks, leaving skipped work out", () => {
    const statuses = new Map([
      ["t1", "done"],
      ["t2", "confirmed"],
      ["t3", "skipped"],
    ]);
    expect(taskProgress(["t1", "t2"], statuses)).toBe(50);
    expect(projectProgress(links, statuses)).toBe(50);
  });

  it("reads 0% with nothing linked rather than claiming completion", () => {
    expect(projectProgress([], new Map())).toBe(0);
  });
});

describe("closing a project", () => {
  it("needs evidence on every criterion of the right kind", () => {
    expect(isCriterionRecorded(criterion())).toBe(false);
    expect(isCriterionRecorded(criterion({ actualPercent: 80 }))).toBe(true);
    expect(isCriterionRecorded(criterion({ measurementType: "meeting_confirmation", targetPercent: null }))).toBe(false);
    expect(
      isCriterionRecorded(criterion({ measurementType: "meeting_confirmation", targetPercent: null, meetingNoteId: "m1" })),
    ).toBe(true);
  });

  it("blocks on open criteria and on tasks due after the target end", () => {
    const tasks = new Map([
      ["t1", { status: "confirmed", deadline: "2026-10-30" }],
      ["t2", { status: "skipped", deadline: "2026-12-01" }],
      ["t3", { status: "done", deadline: "2026-10-10" }],
    ]);
    const blockers = closeBlockers(
      { project: project(), criteria: [criterion()], links: [link("t1", "r1"), link("t2", null), link("t3", null)] },
      tasks,
    );
    expect(blockers).toEqual({ openCriteria: 1, lateTasks: 1 });
    expect(canClose(blockers)).toBe(false);
    expect(closeBlockerSentence(blockers)).toBe("Còn 1 tiêu chí chưa có kết quả và 1 nhiệm vụ có hạn sau ngày kết thúc.");
  });

  it("lets a project with no criteria and no late work close", () => {
    const blockers = closeBlockers({ project: project(), criteria: [], links: [] }, new Map());
    expect(canClose(blockers)).toBe(true);
    expect(closeBlockerSentence(blockers)).toBeNull();
  });

  it("is the opener's decision alone", () => {
    expect(isProjectOwner(project(), OWNER)).toBe(true);
    expect(isProjectOwner(project(), MEMBER)).toBe(false);
    expect(isProjectOwner(project(), undefined)).toBe(false);
  });
});

describe("the Dự án tab lists group projects only", () => {
  it("keeps projects in a group and holds back anything else or unknown", () => {
    const kinds = new Map([
      ["c-group", "group"],
      ["c-journal", "personal"],
    ]);
    const result = groupProjectsOnly(
      [
        project({ id: "a", conversationId: "c-group" }),
        project({ id: "b", conversationId: "c-journal" }),
        project({ id: "c", conversationId: "c-unknown" }),
      ],
      (id) => kinds.get(id),
    );
    expect(result.map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("the database's refusals, in words someone can act on", () => {
  it("explains each close blocker", () => {
    expect(toVietnameseProjectError("P0001", "avora_project_criteria_open")).toMatch(/tiêu chí/);
    expect(toVietnameseProjectError("P0001", "avora_project_task_past_end")).toMatch(/sau ngày kết thúc/);
  });

  it("explains the ownership and group-only rules", () => {
    expect(toVietnameseProjectError("P0001", "avora_project_not_owner")).toMatch(/người mở dự án/);
    expect(toVietnameseProjectError("P0001", "avora_project_group_only")).toMatch(/Nhóm/);
  });

  it("asks the reader to report a permission gap instead of blaming them", () => {
    expect(toVietnameseProjectError("42501", "permission denied")).toMatch(/báo lại/);
  });

  it("falls back to one plain sentence for anything unrecognised", () => {
    expect(toVietnameseProjectError(undefined, "something odd")).toBe("Có lỗi xảy ra. Vui lòng thử lại.");
  });
});

describe("where a project lives", () => {
  it("addresses a project by its id", () => {
    expect(projectLink("p-9")).toBe("/du-an/p-9");
  });
});
