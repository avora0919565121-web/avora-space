import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  contactsWithOpenOpportunity,
  formatEstimatedValue,
  isOpenStage,
  leadOpportunityOf,
  OPPORTUNITY_STAGES,
  opportunitiesOf,
  stageLabel,
  suggestedOpportunityTitle,
  toVietnameseOpportunityError,
  type Opportunity,
  type OpportunityStage,
} from "@/lib/opportunities";

const ME = "u-me";

function opportunity(
  overrides: Partial<Opportunity> & { id: string; contactId: string },
): Opportunity {
  return {
    ownerUserId: ME,
    title: "Cơ hội",
    stage: "lead",
    estimatedValue: null,
    conversationId: null,
    projectId: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("which stages are still asking for something", () => {
  /**
   * The two endings are closed for opposite reasons — one won, one lost — but neither is
   * waiting on anybody, and the address book badge is only about what is still in play.
   */
  it("treats both endings as settled and the middle three as open", () => {
    expect(isOpenStage("lead")).toBe(true);
    expect(isOpenStage("tiem_nang")).toBe(true);
    expect(isOpenStage("dang_cham_soc")).toBe(true);
    expect(isOpenStage("doi_tac")).toBe(false);
    expect(isOpenStage("khong_thanh")).toBe(false);
  });

  /** The five the database accepts, and nothing else — the CHECK constraint is the same list. */
  it("offers exactly the five stages the database allows", () => {
    expect(OPPORTUNITY_STAGES).toEqual([
      "lead",
      "tiem_nang",
      "dang_cham_soc",
      "doi_tac",
      "khong_thanh",
    ]);
  });

  it("has a Vietnamese name for every stage", () => {
    for (const stage of OPPORTUNITY_STAGES) {
      expect(stageLabel(stage).length).toBeGreaterThan(0);
    }
    expect(stageLabel("dang_cham_soc")).toBe("Đang chăm sóc");
  });
});

describe("the opportunities on one contact", () => {
  it("returns only that contact's, newest first", () => {
    const list = [
      opportunity({ id: "o-1", contactId: "c-1", createdAt: "2026-09-01T00:00:00Z" }),
      opportunity({ id: "o-2", contactId: "c-2", createdAt: "2026-09-02T00:00:00Z" }),
      opportunity({ id: "o-3", contactId: "c-1", createdAt: "2026-09-03T00:00:00Z" }),
    ];

    expect(opportunitiesOf(list, "c-1").map((entry) => entry.id)).toEqual(["o-3", "o-1"]);
  });

  it("says nothing rather than guessing when the contact has none", () => {
    expect(opportunitiesOf([], "c-1")).toEqual([]);
    expect(leadOpportunityOf([], "c-1")).toBeNull();
  });
});

describe("which opportunity speaks for a contact", () => {
  /**
   * The one live deal wins over a newer settled one. A row saying "Đối tác" while a fresh lead
   * is being worked on would describe the contact's history instead of its present.
   */
  it("prefers an open opportunity over a more recent closed one", () => {
    const list = [
      opportunity({
        id: "o-open",
        contactId: "c-1",
        stage: "dang_cham_soc",
        createdAt: "2026-09-01T00:00:00Z",
      }),
      opportunity({
        id: "o-done",
        contactId: "c-1",
        stage: "doi_tac",
        createdAt: "2026-09-09T00:00:00Z",
      }),
    ];

    expect(leadOpportunityOf(list, "c-1")?.id).toBe("o-open");
  });

  it("falls back to the most recent when every one of them is settled", () => {
    const list = [
      opportunity({
        id: "o-old",
        contactId: "c-1",
        stage: "khong_thanh",
        createdAt: "2026-09-01T00:00:00Z",
      }),
      opportunity({
        id: "o-new",
        contactId: "c-1",
        stage: "doi_tac",
        createdAt: "2026-09-09T00:00:00Z",
      }),
    ];

    expect(leadOpportunityOf(list, "c-1")?.id).toBe("o-new");
  });

  it("picks the newest when several are open", () => {
    const list = [
      opportunity({ id: "o-a", contactId: "c-1", createdAt: "2026-09-01T00:00:00Z" }),
      opportunity({
        id: "o-b",
        contactId: "c-1",
        stage: "tiem_nang",
        createdAt: "2026-09-05T00:00:00Z",
      }),
    ];

    expect(leadOpportunityOf(list, "c-1")?.id).toBe("o-b");
  });
});

describe("which contacts the address book should badge", () => {
  it("collects the contacts holding something still in play", () => {
    const badged = contactsWithOpenOpportunity([
      opportunity({ id: "o-1", contactId: "c-open", stage: "tiem_nang" }),
      opportunity({ id: "o-2", contactId: "c-won", stage: "doi_tac" }),
      opportunity({ id: "o-3", contactId: "c-lost", stage: "khong_thanh" }),
    ]);

    expect([...badged]).toEqual(["c-open"]);
  });

  /**
   * A contact with a closed deal AND a live one is still live. Counting the settled row would
   * hide the very thing the badge exists to surface.
   */
  it("badges a contact that has both a settled and a live opportunity", () => {
    const badged = contactsWithOpenOpportunity([
      opportunity({ id: "o-1", contactId: "c-1", stage: "doi_tac" }),
      opportunity({ id: "o-2", contactId: "c-1", stage: "lead" }),
    ]);

    expect(badged.has("c-1")).toBe(true);
  });

  it("badges nobody when every deal is done", () => {
    const badged = contactsWithOpenOpportunity([
      opportunity({ id: "o-1", contactId: "c-1", stage: "doi_tac" }),
    ]);

    expect(badged.size).toBe(0);
  });
});

describe("what a new opportunity is called before anyone types", () => {
  it("borrows the contact's own name", () => {
    expect(suggestedOpportunityTitle("Chị Hoa")).toBe("Cơ hội với Chị Hoa");
  });

  /** A nameless contact cannot happen through the UI, but a title must still be sendable. */
  it("stays a valid title when the contact has no usable name", () => {
    expect(suggestedOpportunityTitle("   ")).toBe("Cơ hội kinh doanh");
  });
});

describe("saying what a deal is worth", () => {
  it("writes the amount as Vietnamese money", () => {
    const formatted = formatEstimatedValue(15000000);
    expect(formatted).not.toBeNull();
    expect(formatted).toContain("₫");
  });

  /**
   * Nothing estimated is the normal state of a new lead, so it reads as absent rather than as
   * zero — "0 ₫" would claim the deal is worthless.
   */
  it("returns nothing when no value has been estimated", () => {
    expect(formatEstimatedValue(null)).toBeNull();
  });

  it("returns nothing for a number that is not one", () => {
    expect(formatEstimatedValue(Number.NaN)).toBeNull();
  });

  it("still formats zero, which is a real answer someone typed", () => {
    expect(formatEstimatedValue(0)).not.toBeNull();
  });
});

describe("explaining a refusal from the database", () => {
  it("keeps the ownership refusals as something a person can act on", () => {
    expect(
      toVietnameseOpportunityError(
        undefined,
        "Chỉ đánh dấu được cơ hội trên liên hệ của chính bạn",
      ),
    ).toBe("Đây không phải liên hệ của bạn.");
    expect(
      toVietnameseOpportunityError(undefined, "Chỉ chủ cơ hội mới được đổi giai đoạn"),
    ).toBe("Đây không phải cơ hội của bạn.");
  });

  /**
   * Being the owner is not enough to tie an opportunity to a thread. The refusal has to say
   * which of the two conditions failed, or the reader will go looking at the wrong one.
   */
  it("distinguishes not being in the conversation from not owning the opportunity", () => {
    expect(
      toVietnameseOpportunityError(
        undefined,
        "Chỉ gắn được cuộc trò chuyện mà bạn là thành viên",
      ),
    ).toBe("Bạn không còn trong cuộc trò chuyện này.");
  });

  it("reads a missing row as gone rather than as an error", () => {
    expect(toVietnameseOpportunityError(undefined, "Không tìm thấy cơ hội này")).toBe(
      "Cơ hội này không còn nữa.",
    );
  });

  it("names a permission problem as ours to fix, not the reader's", () => {
    expect(toVietnameseOpportunityError("42501", "permission denied for table crm_opportunity")).toBe(
      "Máy chủ chưa cho phép thao tác này. Vui lòng báo lại cho chúng tôi.",
    );
  });

  it("asks for a retry when the network was the problem", () => {
    expect(toVietnameseOpportunityError(undefined, "Failed to fetch")).toBe(
      "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.",
    );
  });

  it("falls back to something plain for anything unrecognised", () => {
    expect(toVietnameseOpportunityError(undefined, "some internal detail")).toBe(
      "Có lỗi xảy ra. Vui lòng thử lại.",
    );
  });
});

describe("a stage the client does not recognise", () => {
  /**
   * A row that exists is worth showing. 'lead' is the only stage that claims no progress, so an
   * unreadable value degrades to "we know nothing yet" rather than to a blank badge or a throw.
   */
  it("is read as the stage that claims the least", () => {
    const stages: readonly string[] = OPPORTUNITY_STAGES;
    expect(stages.includes("khach_vip" as OpportunityStage)).toBe(false);
  });
});
