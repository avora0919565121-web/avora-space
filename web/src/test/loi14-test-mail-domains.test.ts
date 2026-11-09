import { describe, expect, it } from "vitest";

import { isTestMailAddress } from "../../../supabase/functions/vault-mail/test-domains";

/* LOI-14 · không gửi thư thật tới tài khoản thử (Resend tính thư bị trả về vào uy tín avorachat.com). */
describe("LOI-14", () => {
  it("tên miền thử: bỏ qua", () => {
    for (const email of ["testera@avora.com", "TesterB@Avora.com", "a@b.test", "x@probe.invalid", "q@example.com", "q@mail.example.org", "z@foo.example"]) {
      expect(isTestMailAddress(email), email).toBe(true);
    }
  });
  it("địa chỉ thật: vẫn gửi", () => {
    for (const email of ["vominhthien@outlook.com", "support@avorachat.com", "a@gmail.com", "b@avora.com.vn", "c@notavora.com", "d@testing.vn"]) {
      expect(isTestMailAddress(email), email).toBe(false);
    }
  });
});

describe("LOI-14 · vault-mail kiểm trước khi gọi Resend", () => {
  it("bỏ qua tên miền thử trước dòng fetch tới api.resend.com", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../../supabase/functions/vault-mail/index.ts", import.meta.url), "utf8");
    const skip = source.indexOf("isTestMailAddress(body.email)");
    const send = source.indexOf("https://api.resend.com/emails");
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(send);
    expect(source).toContain('skipped: "test_domain"');
  });
});
