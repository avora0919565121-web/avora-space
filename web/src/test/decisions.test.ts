import { describe, expect, it, vi } from "vitest";

// The decision rules are pure, but they live beside the Supabase client the module also owns.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  canDelegate,
  canEditDraft,
  canOpenDecision,
  canSeeResults,
  canSettle,
  canSubmitDecision,
  decisionStatusLabel,
  DECISION_MAX_OPTIONS,
  DECISION_TITLE_MAX_LENGTH,
  isSettled,
  toVietnameseDecisionError,
  type DecisionEntry,
  type DecisionGrant,
} from "@/lib/decisions";

const ME = "u-me";
const THEM = "u-them";

function makeEntry(overrides: Partial<DecisionEntry>): DecisionEntry {
  return {
    id: "d1",
    conversationId: "c1",
    kind: "meeting_note",
    title: "Chốt ngân sách quý 4",
    body: "",
    status: "draft",
    createdBy: ME,
    createdAt: "2026-09-13T00:00:00Z",
    settledAt: null,
    settledBy: null,
    options: [],
    myVote: null,
    tally: null,
    totalVotes: null,
    ...overrides,
  };
}

function makeGrant(overrides: Partial<DecisionGrant>): DecisionGrant {
  return {
    id: "g1",
    conversationId: "c1",
    granteeId: ME,
    kind: "meeting_note",
    grantedBy: THEM,
    usedAt: null,
    ...overrides,
  };
}

describe("what counts as settled", () => {
  it("treats a locked note and a closed poll as the same kind of finished", () => {
    expect(isSettled(makeEntry({ status: "finalized" }))).toBe(true);
    expect(isSettled(makeEntry({ kind: "poll", status: "closed" }))).toBe(true);
  });

  it("leaves a draft and an open poll unsettled", () => {
    expect(isSettled(makeEntry({ status: "draft" }))).toBe(false);
    expect(isSettled(makeEntry({ kind: "poll", status: "open" }))).toBe(false);
  });
});

describe("the secret ballot", () => {
  it("shows no result at all while the poll is open", () => {
    expect(canSeeResults(makeEntry({ kind: "poll", status: "open" }))).toBe(false);
  });

  it("shows the result to everyone once it closes", () => {
    expect(canSeeResults(makeEntry({ kind: "poll", status: "closed" }))).toBe(true);
  });

  it("never speaks of results for a meeting note, which has none", () => {
    expect(canSeeResults(makeEntry({ status: "finalized" }))).toBe(false);
  });
});

describe("who may open a record", () => {
  it("lets the seats that answer for the group open one whenever", () => {
    expect(canOpenDecision("owner", "poll", [], ME)).toBe(true);
    expect(canOpenDecision("admin", "meeting_note", [], ME)).toBe(true);
  });

  it("turns a plain member away when nobody has delegated", () => {
    expect(canOpenDecision("member", "poll", [], ME)).toBe(false);
  });

  it("admits a member holding an unspent permission — of that exact kind", () => {
    const grants = [makeGrant({ kind: "meeting_note" })];
    expect(canOpenDecision("member", "meeting_note", grants, ME)).toBe(true);
    // A permission to write a note is not a permission to open a poll.
    expect(canOpenDecision("member", "poll", grants, ME)).toBe(false);
  });

  it("stops recognising the permission once it has been spent", () => {
    const spent = [makeGrant({ usedAt: "2026-09-13T01:00:00Z" })];
    expect(canOpenDecision("member", "meeting_note", spent, ME)).toBe(false);
  });

  it("does not let one person spend somebody else's permission", () => {
    const theirs = [makeGrant({ granteeId: THEM })];
    expect(canOpenDecision("member", "meeting_note", theirs, ME)).toBe(false);
  });
});

describe("delegating", () => {
  it("belongs to the seats that answer for the group", () => {
    expect(canDelegate("owner")).toBe(true);
    expect(canDelegate("admin")).toBe(true);
    expect(canDelegate("member")).toBe(false);
    expect(canDelegate(undefined)).toBe(false);
  });
});

describe("closing and locking", () => {
  it("lets the author settle their own", () => {
    expect(canSettle(makeEntry({ createdBy: ME }), "member", ME)).toBe(true);
  });

  it("lets an officer settle anyone's, so nothing stays open forever", () => {
    expect(canSettle(makeEntry({ createdBy: THEM }), "owner", ME)).toBe(true);
  });

  it("refuses a bystander", () => {
    expect(canSettle(makeEntry({ createdBy: THEM }), "member", ME)).toBe(false);
  });

  it("offers nothing once it is already settled — there is no re-locking", () => {
    expect(canSettle(makeEntry({ status: "finalized", createdBy: ME }), "owner", ME)).toBe(false);
  });
});

describe("editing a draft", () => {
  it("is the author's alone, and only while it is a draft", () => {
    expect(canEditDraft(makeEntry({ status: "draft", createdBy: ME }), ME)).toBe(true);
    expect(canEditDraft(makeEntry({ status: "draft", createdBy: THEM }), ME)).toBe(false);
  });

  it("stops the moment the note is locked — even for the person who wrote it", () => {
    expect(canEditDraft(makeEntry({ status: "finalized", createdBy: ME }), ME)).toBe(false);
  });

  it("is not something a poll has", () => {
    expect(canEditDraft(makeEntry({ kind: "poll", status: "open", createdBy: ME }), ME)).toBe(false);
  });
});

describe("what the compose form will accept", () => {
  it("needs a title for a note", () => {
    expect(canSubmitDecision("meeting_note", "   ", [])).toBe(false);
    expect(canSubmitDecision("meeting_note", "Biên bản", [])).toBe(true);
  });

  it("refuses a title longer than the database will store", () => {
    expect(canSubmitDecision("meeting_note", "x".repeat(DECISION_TITLE_MAX_LENGTH), [])).toBe(true);
    expect(canSubmitDecision("meeting_note", "x".repeat(DECISION_TITLE_MAX_LENGTH + 1), [])).toBe(false);
  });

  it("refuses a poll with fewer than two real answers — one answer is not a question", () => {
    expect(canSubmitDecision("poll", "Chọn giờ họp", ["Sáng"])).toBe(false);
    expect(canSubmitDecision("poll", "Chọn giờ họp", ["Sáng", "   "])).toBe(false);
    expect(canSubmitDecision("poll", "Chọn giờ họp", ["Sáng", "Chiều"])).toBe(true);
  });

  it("ignores blank rows left behind in the form", () => {
    expect(canSubmitDecision("poll", "Chọn giờ họp", ["Sáng", "", "Chiều", "  "])).toBe(true);
  });

  it("stops at the number of options the database allows", () => {
    const tooMany = Array.from({ length: DECISION_MAX_OPTIONS + 1 }, (_, i) => `Lựa chọn ${i}`);
    expect(canSubmitDecision("poll", "Chọn", tooMany)).toBe(false);
  });
});

describe("the label beside each title", () => {
  it("names the state in the words of its own kind", () => {
    expect(decisionStatusLabel(makeEntry({ status: "draft" }))).toBe("Bản nháp");
    expect(decisionStatusLabel(makeEntry({ status: "finalized" }))).toBe("Đã khoá");
    expect(decisionStatusLabel(makeEntry({ kind: "poll", status: "open" }))).toBe("Đang mở");
    expect(decisionStatusLabel(makeEntry({ kind: "poll", status: "closed" }))).toBe("Đã đóng");
  });
});

describe("what a refusal says to the person", () => {
  it("explains a locked record instead of showing the raw exception", () => {
    expect(toVietnameseDecisionError(undefined, "avora_decision_settled_immutable")).toBe(
      "Mục này đã được khoá nên không sửa hay xoá được nữa.",
    );
  });

  it("explains a spent permission", () => {
    expect(toVietnameseDecisionError(undefined, "avora_decision_not_allowed")).toBe(
      "Bạn cần được chủ nhóm uỷ quyền để tạo mục này.",
    );
  });

  it("explains a second ballot", () => {
    expect(toVietnameseDecisionError(undefined, "avora_decision_already_voted")).toBe("Bạn đã bình chọn rồi.");
  });

  it("falls back to something human for anything unrecognised", () => {
    expect(toVietnameseDecisionError(undefined, "some unmapped failure")).toBe(
      "Có lỗi xảy ra. Vui lòng thử lại.",
    );
  });

  it("never leaks a Postgres permission error verbatim", () => {
    const message = toVietnameseDecisionError("42501", "permission denied for table group_decisions");
    expect(message).not.toContain("permission denied");
    expect(message).toContain("Máy chủ");
  });
});
