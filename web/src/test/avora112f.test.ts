import { beforeEach, describe, expect, test, vi } from "vitest";

const calls: { name: string; args: Record<string, unknown> }[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return Promise.resolve({ data: null, error: null }); } },
}));

import { reportClientError, resetClientErrorReportsForTests, routeShape, stackHash } from "@/lib/client-errors";
import { isBlockedAttachmentType } from "@/lib/attachments";
import { logError } from "@/lib/log";

describe("112-F · lỗi từ máy người dùng", () => {
  beforeEach(() => {
    calls.length = 0;
    resetClientErrorReportsForTests();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  test("logError gửi đúng ba trường đã lọc — không nội dung, không email", async () => {
    logError("chat", { code: "P0001", message: "Key (email)=(lan@example.com) already exists" });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].name).toBe("log_client_error");
    const sent = JSON.stringify(calls[0].args);
    expect(sent).not.toContain("lan@example.com");
    expect(calls[0].args).toMatchObject({ p_error_name: "chat", p_message_short: "P0001" });
  });

  test("một lỗi chỉ gửi một lần mỗi phiên; tối đa 20 lỗi khác nhau / giờ", async () => {
    expect(reportClientError({ scope: "x", code: "a", name: null }, 0)).toBe(true);
    expect(reportClientError({ scope: "x", code: "a", name: null }, 1)).toBe(false);
    for (let i = 0; i < 30; i += 1) reportClientError({ scope: "y", code: `c${i}`, name: null }, 10 + i);
    await vi.waitFor(() => expect(calls.length).toBe(20));
    expect(reportClientError({ scope: "z", code: "late", name: null }, 3_700_000)).toBe(true);
  });

  test("đường dẫn giữ hình, bỏ id và query; dấu vân tay ổn định", () => {
    expect(routeShape("/tin-nhan/0b1f7a2c-0000-4000-8000-0000000112ff?q=lan#x")).toBe("/tin-nhan/:id");
    expect(routeShape("/du-an/123456/viec")).toBe("/du-an/:id/viec");
    expect(stackHash({ scope: "a", code: "b", name: null })).toBe(stackHash({ scope: "a", code: "b", name: null }));
    expect(stackHash({ scope: "a", code: "b", name: null })).not.toBe(stackHash({ scope: "a", code: "c", name: null }));
  });

  test("LOI-05: loại tệp bị chặn nhận ra trước khi tải (cùng luật máy chủ)", () => {
    expect(isBlockedAttachmentType("cai-dat.EXE", "")).toBe(true);
    expect(isBlockedAttachmentType("trang.html", "text/html")).toBe(true);
    expect(isBlockedAttachmentType("anh.svg", "image/svg+xml")).toBe(true);
    expect(isBlockedAttachmentType("bao-cao.pdf", "application/pdf")).toBe(false);
    expect(isBlockedAttachmentType("anh.jpg", "image/jpeg")).toBe(false);
  });
});
