import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  amountForValidation,
  contactHint,
  formatAmountTyping,
  missingLine,
  rankContacts,
  sameNameContacts,
} from "@/lib/contact-picker";
import type { Contact } from "@/lib/contacts";
import { validateAmount } from "@/lib/finance";
import { transactionConfirmWord } from "@/lib/finance-api";
import { canDeleteTask, isOpenTask, taskClosedReason, type TaskItem } from "@/lib/tasks";
import { groupByStatus, isDoneStatus, parseStatusOptions, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";
import {
  arrangeShelf,
  isArchivedTree,
  orderTemplates,
  proposalProgress,
  reminderTiles,
  searchShelf,
  transferTargets,
  whenLabel,
  type BoardTemplate,
  type SharedProposal,
} from "@/lib/think-hub-shelf";

const ME = "u-me";

function table(over: Partial<ThinkTable> & { id: string }): ThinkTable {
  return {
    ownerUserId: ME, name: over.id, position: 0, columns: [], projectId: null, conversationId: null, parentRecordId: null,
    depth: 1, purpose: null, createdAt: "2026-09-01", updatedAt: "2026-09-01", deletedAt: null,
    statusOptions: null, titleLabel: null, defaultView: null, mobileColumns: [], sourceTemplateKey: null,
    archivedAt: null, kind: null, orphanOrigin: null, ...over,
  };
}

function record(over: Partial<ThinkRecord> & { id: string; tableId: string }): ThinkRecord {
  return {
    ownerUserId: ME, title: over.id, status: "moi", priority: "trung_binh", category: null, nextActionDate: null, remindAt: null,
    tags: [], notes: null, extensionFields: {}, projectId: null, createdAt: "2026-09-01", updatedAt: "2026-09-01",
    deletedAt: null, movedFrom: null, ...over,
  };
}

describe("C1 · a table's own statuses", () => {
  it("Kanban reads them in order and keeps typed ones at the end", () => {
    const options = parseStatusOptions([{ key: "tiep_can", label: "Tiếp cận" }, { key: "chot", label: "Chốt", done: true }, { bad: 1 }]);
    const columns = groupByStatus([record({ id: "a", tableId: "t", status: "chot" }), record({ id: "b", tableId: "t", status: "khac" })], options);
    expect(columns.map((column) => column.label)).toEqual(["Tiếp cận", "Chốt", "khac"]);
    expect(isDoneStatus({ statusOptions: options }, "chot")).toBe(true);
    expect(isDoneStatus({ statusOptions: null }, "xong")).toBe(true);
  });
});

describe("C2 · gallery order", () => {
  const tpl = (id: string, scopes: BoardTemplate["scopes"], source: "system" | "mine" = "system"): BoardTemplate => ({
    id, source, name: id, thinkingType: "track", guidingQuestion: null, description: null, scopes, columns: [], statuses: [],
    titleLabel: "Tiêu đề", subTemplateName: null, sortOrder: 0,
  });
  it("puts templates that fit the place first, keeps the rest, lists mine separately", () => {
    const out = orderTemplates([tpl("shopping", ["journal"]), tpl("event", ["group"]), tpl("x", ["journal"], "mine"), tpl("blank", ["journal"])], "group", null);
    expect(out.fitting.map((t) => t.id)).toEqual(["event"]);
    expect(out.others.map((t) => t.id)).toEqual(["shopping"]);
    expect(out.mine.map((t) => t.id)).toEqual(["x"]);
  });
});

describe("C3 · the shelf", () => {
  const tables = [
    table({ id: "mine" }),
    table({ id: "books", kind: "bookshelf" }),
    table({ id: "g1", conversationId: "c-g", name: "Các hạng mục cần hoàn thiện" }),
    table({ id: "g2", conversationId: "c-g", archivedAt: "2026-09-20" }),
    table({ id: "sub", parentRecordId: "r1", depth: 2 }),
  ];
  const records = [record({ id: "r1", tableId: "g1", nextActionDate: "2026-09-27" }), record({ id: "r2", tableId: "g2", nextActionDate: "2026-09-27" })];
  const shelf = arrangeShelf(tables, records, ME, (id) => (id === "c-g" ? "group" : undefined), (t) => (t.conversationId === null ? null : "Chat Group"), "2026-09-29");

  it("has four drawers, leaves out the bookshelf and sub-tables, keeps archived apart", () => {
    expect(shelf.personal.live.map((item) => item.table.id)).toEqual(["mine"]);
    expect(shelf.group.live.map((item) => item.table.id)).toEqual(["g1"]);
    expect(shelf.group.archived.map((item) => item.table.id)).toEqual(["g2"]);
    expect(shelf.group.live[0]).toMatchObject({ placeName: "Chat Group", hasOverdue: true, recordCount: 1 });
  });

  it("searches without accents", () => {
    expect(searchShelf(shelf.group.live, "hoan thien")).toHaveLength(1);
  });

  it("tiles skip archived tables and count ★ only when unfinished (C8/C10)", () => {
    const tiles = reminderTiles(tables, records, new Set(["r1", "r2"]), "2026-09-29", (t) => isArchivedTree(tables, records, t.id));
    expect(tiles.overdue.map((line) => line.record.id)).toEqual(["r1"]);
    expect(tiles.starred.map((line) => line.record.id)).toEqual(["r1"]);
    expect(whenLabel("2026-09-27", "2026-09-29")).toBe("quá 2 ngày");
    expect(whenLabel("2026-09-29", "2026-09-29")).toBe("hôm nay");
  });

  it("a sub-table follows its archived root", () => {
    expect(isArchivedTree(tables, records, "sub")).toBe(false);
    const withArchivedRoot = tables.map((t) => (t.id === "g1" ? { ...t, archivedAt: "2026-09-28" } : t));
    expect(isArchivedTree(withArchivedRoot, records, "sub")).toBe(true);
  });
});

describe("C9 · proposal progress", () => {
  it("names who is still asked", () => {
    const proposal = {
      votes: [{ userId: "b", vote: "agree", reason: null }, { userId: "c", vote: null, reason: null }, { userId: "d", vote: null, reason: null }],
    } as unknown as SharedProposal;
    expect(proposalProgress(proposal, (id) => ({ c: "Châu", d: "Dũng" })[id] ?? id)).toBe("Đã đồng ý 1/3 · Chờ: Châu, Dũng");
  });
});

describe("C11 · 34j–34m move / copy targets", () => {
  it("leaves out the source, the bookshelf, binned and archived tables; sub-tables are valid", () => {
    const tables = [
      table({ id: "src" }),
      table({ id: "books", kind: "bookshelf" }),
      table({ id: "old", archivedAt: "2026-09-01" }),
      table({ id: "gone", deletedAt: "2026-09-01" }),
      table({ id: "sub", parentRecordId: "r0", depth: 3 }),
      table({ id: "ok" }),
    ];
    expect(transferTargets(tables, [], "src").map((t) => t.id)).toEqual(["sub", "ok"]);
  });
});

function task(over: Partial<TaskItem>): TaskItem {
  return {
    id: "t", type: "1-1-shared", creatorId: "boss", assigneeId: ME, status: "confirmed", deletedByCreator: false, deletedByPeer: false,
    ...over,
  } as TaskItem;
}

describe("D4 · 35a–35e no dead ends", () => {
  it("35a assignee clears a task the requester deleted; it no longer counts as open", () => {
    const dropped = task({ deletedByCreator: true });
    expect(taskClosedReason(dropped, ME)).toBe("creator_deleted");
    expect(canDeleteTask(dropped, ME)).toBe(true);
    expect(isOpenTask(dropped, ME)).toBe(false);
  });
  it("35b skipped work is clearable (the 'thử nghiệm im lặng' case, 35e)", () => {
    expect(canDeleteTask(task({ status: "skipped" }), ME)).toBe(true);
  });
  it("35c open work stays until the server says it cannot move", () => {
    const live = task({});
    expect(canDeleteTask(live, ME)).toBe(false);
    expect(canDeleteTask(live, ME, "blocked")).toBe(true);
    expect(canDeleteTask(live, ME, "project_closed")).toBe(true);
  });
  it("35d a bystander still cannot clear someone else's task", () => {
    expect(canDeleteTask(task({ type: "group-shared", assigneeId: "x" }), ME)).toBe(false);
  });
});

function contact(over: Partial<Contact> & { id: string; name: string }): Contact {
  return {
    ownerUserId: ME, contactType: "individual", phone: null, email: null, note: null, linkedUserId: null, employerContactId: null,
    dateOfBirth: null, relationshipTag: null, taxCode: null, businessAddress: null, representativeName: null, representativePhone: null,
    representativeEmail: null, industry: null, needsDetails: false, createdAt: "", updatedAt: "", ...over,
  };
}

describe("D5 · 35f–35j picking a person, typing an amount", () => {
  const people = [
    contact({ id: "1", name: "Nguyễn Văn Đạt", phone: "0901234567" }),
    contact({ id: "2", name: "Anh Minh", email: "minh@x.vn" }),
    contact({ id: "3", name: "Anh Minh", phone: "0987654321" }),
  ];
  it("35f searches without accents, by phone digits too", () => {
    expect(rankContacts(people, "nguyen van dat", []).map((c) => c.id)).toEqual(["1"]);
    expect(rankContacts(people, "4567", []).map((c) => c.id)).toEqual(["1"]);
  });
  it("35g recent people come first", () => {
    expect(rankContacts(people, "", ["3"])[0].id).toBe("3");
  });
  it("35h two people with one name are told apart", () => {
    expect(contactHint(people[2])).toBe("•••• 4321");
    expect(contactHint(people[1])).toBe("minh@x.vn");
  });
  it("35i adding a name that exists offers the existing ones first", () => {
    expect(sameNameContacts(people, "anh minh").map((c) => c.id)).toEqual(["2", "3"]);
  });
  it("35j VND reads in thousands, no decimals, and the save button says what is missing", () => {
    expect(formatAmountTyping("1500000", "VND")).toBe("1.500.000");
    expect(formatAmountTyping("1.500,5", "VND")).toBe("15.005");
    expect(validateAmount(amountForValidation("1.500.000", "VND")).cents).toBe(150_000_000);
    expect(missingLine(["Số tiền", "Người vay"])).toBe("Còn thiếu: Số tiền, Người vay");
    expect(missingLine([])).toBeNull();
    expect(transactionConfirmWord("  ")).toBe("XOÁ");
  });
});
