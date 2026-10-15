import { describe, expect, test, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { findNameIssues } from "@/lib/contact-name-repair";
import { linkTargets, toVietnameseContactError, type Contact } from "@/lib/contacts";
import { applyLinkChange } from "@/lib/use-contact-link";

function contact(id: string, name: string, linkedUserId: string | null, contactType: "individual" | "business" = "individual"): Contact {
  return {
    id, ownerUserId: "me", contactType, name, phone: null, email: null, note: null, linkedUserId, employerContactId: null,
    dateOfBirth: null, relationshipTag: null, taxCode: null, businessAddress: null, representativeName: null,
    representativePhone: null, representativeEmail: null, industry: null, createdAt: "", updatedAt: "", needsDetails: false,
  };
}

describe("AVORA-117", () => {
  const book = [contact("a", "Chú Tư", "u1"), contact("b", "Bao Tran", null), contact("c", "Công ty", null, "business"), contact("d", "Lan", "u2")];

  test("chuyển: nguồn trống, đích nhận đúng tài khoản; các liên hệ khác không đổi", () => {
    const next = applyLinkChange(book, { kind: "relink", fromId: "a", toId: "b" });
    expect(next.map((c) => c.linkedUserId)).toEqual([null, "u1", null, "u2"]);
    expect(next[0]).toEqual({ ...book[0], linkedUserId: null });
  });

  test("gỡ và gắn", () => {
    expect(applyLinkChange(book, { kind: "unlink", contactId: "d" })[3].linkedUserId).toBeNull();
    expect(applyLinkChange(book, { kind: "link", contactId: "b", userId: "u9" })[1].linkedUserId).toBe("u9");
  });

  test("đích chọn được: cá nhân, chưa gắn, không phải chính nó", () => {
    expect(linkTargets(book, "a").map((c) => c.id)).toEqual(["b"]);
  });

  test("gắn bằng tay: không gợi ý thêm dấu theo tên AVORA", () => {
    const input = [{ id: "b", name: "Bao Tran", phone: null, linkedUserId: "u1" }];
    const avora = (): string => "Bảo Trần";
    expect(findNameIssues(input, avora)[0]?.source).toBe("avora");
    expect(findNameIssues(input, avora, new Set(["b"]))[0]?.source).toBeUndefined();
  });

  test("mã lỗi máy chủ thành câu tiếng Việt", () => {
    for (const code of ["avora_contact_target_linked", "avora_contact_not_friend", "avora_contact_undo_expired", "avora_contact_link_server_only"]) {
      const text = toVietnameseContactError("P0001", code);
      expect(text).not.toBe("Có lỗi xảy ra. Vui lòng thử lại.");
      expect(text).not.toMatch(/avora_/);
    }
  });
});
