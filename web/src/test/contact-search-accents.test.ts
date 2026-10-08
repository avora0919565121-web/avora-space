import { describe, expect, test, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { matchesContactQuery, type Contact } from "@/lib/contacts";

describe("AVORA-102 · B1.5 tìm không dấu", () => {
  const nguyen = { contactType: "individual", name: "Nguyễn Văn Đạt", phone: "0912345678", email: null } as unknown as Contact;
  test("nguyen van dat tìm thấy Nguyễn Văn Đạt", () => {
    expect(matchesContactQuery(nguyen, "nguyen van dat")).toBe(true);
    expect(matchesContactQuery(nguyen, "ĐẠT")).toBe(true);
    expect(matchesContactQuery(nguyen, "0912")).toBe(true);
    expect(matchesContactQuery(nguyen, "tran")).toBe(false);
  });
});
