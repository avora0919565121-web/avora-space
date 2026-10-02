import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { table: string; patch: Record<string, unknown>; id: unknown }[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => {
          calls.push({ table, patch, id });
          return { error: null };
        },
      }),
    }),
  },
}));

import type { OpportunityBoardRow } from "@/lib/opportunities";
import { saveSyncEdits, splitSyncPatch, withSyncValues } from "@/lib/opportunity-board";
import type { ThinkRecord } from "@/lib/think-hub";

const record: ThinkRecord = {
  id: "r1", tableId: "sb", ownerUserId: "me", title: "Anam Cam Ranh", status: "lead", priority: "trung_binh", category: null,
  nextActionDate: null, remindAt: null, tags: [], notes: null, extensionFields: { own_col: "riêng của bảng" }, projectId: null,
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", deletedAt: null, movedFrom: null, opportunityId: "o1",
};

const row = (contact: Partial<NonNullable<OpportunityBoardRow["contact"]>>): OpportunityBoardRow => ({
  id: "o1", contactId: "c1", title: "Anam Cam Ranh", stage: "lead", estimatedValue: 500_000_000, nextActionDate: null, nextActionNote: null,
  lastContactAt: null, conversationId: null, removedAt: null,
  contact: { name: "Anh A", phone: "0901 111 222", email: "a@old.vn", contactType: "person", employerName: "Công ty Cũ", representative: null, industry: null, address: null, taxCode: null, relationship: null, note: null, needsDetails: false, ...contact },
});

const fold = (r: OpportunityBoardRow): ThinkRecord => withSyncValues([record], [r], () => "", () => 0)[0];

beforeEach(() => {
  calls.length = 0;
});

describe("AVORA-72 · the synced layer reads Danh bạ live", () => {
  it("72.3 — phone / company edited in Danh bạ show on the board at once, nothing copied into the record", () => {
    const before = fold(row({}));
    expect(before.extensionFields.sync_phone).toBe("0901 111 222");
    expect(before.extensionFields.sync_company).toBe("Công ty Cũ");
    // Danh bạ changes; the next read of the rows is the only thing that moves.
    const after = fold(row({ phone: "0988 999 000", employerName: "Công ty Mới" }));
    expect(after.extensionFields.sync_phone).toBe("0988 999 000");
    expect(after.extensionFields.sync_company).toBe("Công ty Mới");
    // The stored record never held the synced values.
    expect(record.extensionFields).toEqual({ own_col: "riêng của bảng" });
    expect(after.extensionFields.own_col).toBe("riêng của bảng");
  });

  it("72.3 — a deleted contact reads as `Liên hệ đã xoá`", () => {
    const gone = withSyncValues([record], [{ ...row({}), contact: null, contactId: null }], () => "", () => 0)[0];
    expect(gone.extensionFields.sync_contact).toBe("Liên hệ đã xoá");
  });

  it("72.4 — email edited on the board is written to Danh bạ (contact), not to the board", async () => {
    const split = splitSyncPatch({ title: "Anam Cam Ranh", extensionFields: { sync_email: " a@new.vn ", sync_phone: "0901 111 222", own_col: "sửa riêng" } });
    expect(split.board.extensionFields).toEqual({ own_col: "sửa riêng" });
    expect(split.contact).toEqual({ email: "a@new.vn", phone: "0901 111 222" });
    await saveSyncEdits(row({}), split.contact, split.opportunity);
    // Only the field that changed reaches the contact; the opportunity is untouched.
    expect(calls).toEqual([{ table: "contact", patch: { email: "a@new.vn" }, id: "c1" }]);
  });

  it("72.4 — derived columns (Liên hệ, Công ty, Liên lạc gần nhất) are never written back", () => {
    const split = splitSyncPatch({ extensionFields: { sync_contact: "X", sync_company: "Y", sync_last_contact: "Z" } });
    expect(split.contact).toEqual({});
    expect(split.opportunity).toEqual({});
    expect(split.board.extensionFields).toEqual({});
  });

  it("value / next step go to the opportunity", async () => {
    const split = splitSyncPatch({ extensionFields: { sync_value: "1.250.000.000", sync_next: "Gọi lại" } });
    await saveSyncEdits(row({}), split.contact, split.opportunity);
    expect(calls).toEqual([{ table: "crm_opportunity", patch: { estimated_value: 1_250_000_000, next_action_note: "Gọi lại" }, id: "o1" }]);
  });
});
