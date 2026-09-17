import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  canConfirmDeliverable,
  deliverableProgress,
  deliverablesOf,
  isTaskComplete,
  objectiveProgress,
  projectLink,
  projectProgress,
  taskIdsOf,
  toVietnameseProjectError,
  type Deliverable,
  type Objective,
  type Project,
  type ProjectTaskLink,
  type ProjectTree,
} from "@/lib/projects";
import { groupProjects, type ProjectGroupKind } from "@/lib/use-projects";

const OWNER = "u1";
const MEMBER = "u2";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    conversationId: "c1",
    createdBy: OWNER,
    title: "Ra mắt bản thử",
    purpose: null,
    scope: null,
    successCriteria: null,
    assumptions: null,
    status: "active",
    createdAt: "2026-09-17T08:00:00.000Z",
    updatedAt: "2026-09-17T08:00:00.000Z",
    ...overrides,
  };
}

function objective(overrides: Partial<Objective> = {}): Objective {
  return {
    id: "o1",
    projectId: "p1",
    conversationId: "c1",
    createdBy: OWNER,
    title: "Chốt phạm vi",
    status: "active",
    sortOrder: 0,
    ...overrides,
  };
}

function deliverable(overrides: Partial<Deliverable> = {}): Deliverable {
  return {
    id: "d1",
    objectiveId: "o1",
    title: "Bản mô tả phạm vi",
    status: "active",
    sortOrder: 0,
    confirmedBy: null,
    confirmedAt: null,
    ...overrides,
  };
}

function link(taskId: string, deliverableId: string): ProjectTaskLink {
  return { taskId, projectId: "p1", deliverableId, linkedBy: OWNER };
}

function tree(overrides: Partial<ProjectTree> = {}): ProjectTree {
  return {
    project: project(),
    objectives: [objective()],
    deliverables: [deliverable()],
    links: [],
    ...overrides,
  };
}

/** Only a fully closed task counts; the statuses before it are still somebody's turn. */
describe("what counts as finished work", () => {
  it("counts only a task both sides have closed", () => {
    expect(isTaskComplete("done")).toBe(true);
    expect(isTaskComplete("done_pending_review")).toBe(false);
    expect(isTaskComplete("confirmed")).toBe(false);
    expect(isTaskComplete("pending_confirmation")).toBe(false);
    expect(isTaskComplete("skipped")).toBe(false);
  });
});

describe("deliverable progress", () => {
  it("reads 0% with nothing linked rather than claiming completion", () => {
    // An empty deliverable is the start of the work, not the end of it. Averaging "no tasks"
    // as 100% would make a brand-new project read as finished.
    expect(deliverableProgress(deliverable(), [], new Map())).toBe(0);
  });

  it("counts finished tasks against every task linked", () => {
    const links = [link("t1", "d1"), link("t2", "d1"), link("t3", "d1"), link("t4", "d1")];
    const statuses = new Map([
      ["t1", "done"],
      ["t2", "done"],
      ["t3", "confirmed"],
      ["t4", "pending_confirmation"],
    ]);
    expect(deliverableProgress(deliverable(), links, statuses)).toBe(50);
  });

  it("ignores tasks linked to a different deliverable", () => {
    const links = [link("t1", "d1"), link("t2", "d2")];
    const statuses = new Map([
      ["t1", "done"],
      ["t2", "pending_confirmation"],
    ]);
    expect(deliverableProgress(deliverable(), links, statuses)).toBe(100);
  });

  it("reads 100% once signed off, whatever its unfinished tasks say", () => {
    // Confirmation is a person's judgement that the result was delivered, and it outranks the
    // checklist that led there — otherwise an accepted deliverable shows as unfinished forever.
    const confirmed = deliverable({
      confirmedBy: OWNER,
      confirmedAt: "2026-09-17T09:00:00.000Z",
      status: "done",
    });
    const links = [link("t1", "d1"), link("t2", "d1")];
    const statuses = new Map([
      ["t1", "pending_confirmation"],
      ["t2", "confirmed"],
    ]);
    expect(deliverableProgress(confirmed, links, statuses)).toBe(100);
  });

  it("rounds to whole percentages so the bar and its number agree", () => {
    const links = [link("t1", "d1"), link("t2", "d1"), link("t3", "d1")];
    const statuses = new Map([
      ["t1", "done"],
      ["t2", "pending_confirmation"],
      ["t3", "pending_confirmation"],
    ]);
    expect(deliverableProgress(deliverable(), links, statuses)).toBe(33);
  });
});

describe("objective and project progress", () => {
  it("averages an objective's deliverables without weighting them", () => {
    const shape = tree({
      deliverables: [deliverable({ id: "d1" }), deliverable({ id: "d2" })],
      links: [link("t1", "d1"), link("t2", "d2"), link("t3", "d2")],
    });
    const statuses = new Map([
      ["t1", "done"],
      ["t2", "done"],
      ["t3", "pending_confirmation"],
    ]);
    // d1 is 100%, d2 is 50% — the objective is the plain average of the two.
    expect(objectiveProgress(objective(), shape, statuses)).toBe(75);
  });

  it("reads an objective with no deliverables as 0%, not as finished", () => {
    expect(objectiveProgress(objective(), { deliverables: [], links: [] }, new Map())).toBe(0);
  });

  it("averages the project across its objectives", () => {
    const shape = tree({
      objectives: [objective({ id: "o1" }), objective({ id: "o2", sortOrder: 1 })],
      deliverables: [
        deliverable({ id: "d1", objectiveId: "o1" }),
        deliverable({ id: "d2", objectiveId: "o2" }),
      ],
      links: [link("t1", "d1"), link("t2", "d2")],
    });
    const statuses = new Map([
      ["t1", "done"],
      ["t2", "pending_confirmation"],
    ]);
    expect(projectProgress(shape, statuses)).toBe(50);
  });

  it("reads a project with no objectives as 0% instead of dividing by zero", () => {
    expect(projectProgress(tree({ objectives: [], deliverables: [] }), new Map())).toBe(0);
  });
});

describe("reading the tree", () => {
  it("returns a deliverable's tasks and nobody else's", () => {
    const shape = tree({ links: [link("t1", "d1"), link("t2", "d2"), link("t3", "d1")] });
    expect(taskIdsOf(shape, "d1")).toEqual(["t1", "t3"]);
  });

  it("keeps deliverables in the order they were thought of, not alphabetical", () => {
    const shape = tree({
      deliverables: [
        deliverable({ id: "d2", title: "An", sortOrder: 1 }),
        deliverable({ id: "d1", title: "Zed", sortOrder: 0 }),
      ],
    });
    expect(deliverablesOf(shape, "o1").map((item) => item.id)).toEqual(["d1", "d2"]);
  });
});

describe("who may sign off a deliverable", () => {
  it("allows the person who opened the project and nobody else", () => {
    expect(canConfirmDeliverable(project(), OWNER)).toBe(true);
    expect(canConfirmDeliverable(project(), MEMBER)).toBe(false);
    // Signed out: the button must not appear at all rather than fail on the server.
    expect(canConfirmDeliverable(project(), undefined)).toBe(false);
  });
});

describe("grouping projects by who can see them", () => {
  it("files each project under the kind of conversation it lives in", () => {
    const kinds = new Map<string, ProjectGroupKind>([
      ["c-journal", "personal"],
      ["c-direct", "direct"],
      ["c-group", "group"],
    ]);
    const grouped = groupProjects(
      [
        project({ id: "p1", conversationId: "c-journal" }),
        project({ id: "p2", conversationId: "c-direct" }),
        project({ id: "p3", conversationId: "c-group" }),
        project({ id: "p4", conversationId: "c-group" }),
      ],
      (id) => kinds.get(id),
    );

    expect(grouped.personal.map((item) => item.id)).toEqual(["p1"]);
    expect(grouped.direct.map((item) => item.id)).toEqual(["p2"]);
    expect(grouped.group.map((item) => item.id)).toEqual(["p3", "p4"]);
  });

  it("holds back a project whose conversation has not loaded rather than guessing", () => {
    // Guessing would put it under the wrong heading, which would misstate who can read it —
    // the one thing this screen must never do. It appears as soon as the inbox answers.
    const grouped = groupProjects([project({ conversationId: "unknown" })], () => undefined);
    expect(grouped.personal).toEqual([]);
    expect(grouped.direct).toEqual([]);
    expect(grouped.group).toEqual([]);
  });
});

describe("the database's refusals, in words someone can act on", () => {
  it("explains the ownership rule instead of repeating its error code", () => {
    expect(toVietnameseProjectError("P0001", "avora_project_not_owner")).toBe(
      "Chỉ người mở dự án mới xác nhận được kết quả này.",
    );
  });

  it("names the missing title and the missing first objective separately", () => {
    expect(toVietnameseProjectError("P0001", "Dự án cần một tiêu đề")).toBe(
      "Dự án cần một tiêu đề.",
    );
    expect(toVietnameseProjectError("P0001", "Dự án cần mục tiêu đầu tiên")).toBe(
      "Hãy đặt mục tiêu đầu tiên.",
    );
  });

  it("turns a lost membership into the reason the action failed", () => {
    expect(
      toVietnameseProjectError("P0001", "Bạn không còn trong cuộc trò chuyện của dự án này"),
    ).toBe("Bạn không còn trong cuộc trò chuyện của dự án này.");
  });

  it("explains the personal-task rule rather than showing a constraint name", () => {
    expect(
      toVietnameseProjectError("P0001", "Việc riêng chỉ nối được vào dự án riêng của chính bạn"),
    ).toBe("Việc riêng chỉ nối được vào dự án riêng của bạn.");
  });

  it("asks the reader to report a permission gap instead of blaming them", () => {
    expect(toVietnameseProjectError("42501", "permission denied for table projects")).toBe(
      "Máy chủ chưa cho phép thao tác này. Vui lòng báo lại cho chúng tôi.",
    );
  });

  it("tells someone to check their network when the request never left", () => {
    expect(toVietnameseProjectError(undefined, "Failed to fetch")).toBe(
      "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.",
    );
  });

  it("falls back to one plain sentence for anything unrecognised", () => {
    expect(toVietnameseProjectError("XX000", "some internal detail")).toBe(
      "Có lỗi xảy ra. Vui lòng thử lại.",
    );
  });
});

describe("where a project lives", () => {
  it("addresses a project by its id", () => {
    expect(projectLink("abc-123")).toBe("/du-an/abc-123");
  });
});
