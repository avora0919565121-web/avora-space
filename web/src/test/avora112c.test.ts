import { describe, expect, test, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/ConfirmHost", () => ({ askConfirm: async () => true }));

import { sendableHeads, type OutboxItem } from "@/lib/outbox";
import { serverText, withServerDetail } from "@/lib/server-error";
import { unsyncedWarning } from "@/lib/unsynced";

const item = (id: string, conversationId: string, seq: number, state: OutboxItem["state"], permanent?: boolean): OutboxItem => ({
  id, userId: "u", conversationId, content: id, replyToMessageId: null, mentionedUserIds: [], refs: [], originGroupId: null,
  isUrgent: false, files: [], createdAt: "", seq, state, attempts: 1, lastError: null, permanent,
});

describe("112-C · gửi tin chắc chắn", () => {
  test("lỗi đã dịch vẫn mang lời gốc của máy chủ", () => {
    const error = withServerDetail(new Error("Người này hiện không nhận tin của bạn."), "P0001", "avora_contact_unavailable");
    expect(error.message).toBe("Người này hiện không nhận tin của bạn.");
    expect(serverText(error)).toBe("avora_contact_unavailable");
    expect(serverText(new Error("x"))).toBe("x");
  });

  test("tin lỗi vĩnh viễn chặn cuộc (đúng thứ tự) tới khi người dùng chọn; tin chỉ hết giờ thì tự thử lại ngầm", () => {
    const heads = sendableHeads([item("a1", "A", 1, "failed", true), item("a2", "A", 2, "queued"), item("b1", "B", 3, "failed", false), item("c1", "C", 4, "waiting_network")]);
    expect(heads.map((head) => head.id).sort()).toEqual(["b1", "c1"]);
  });

  test("cảnh báo đăng xuất nói đúng cái sẽ mất", () => {
    expect(unsyncedWarning({ messages: 0, drafts: 0 })).toBeNull();
    expect(unsyncedWarning({ messages: 3, drafts: 1 })?.title).toBe("Còn 3 tin chưa gửi và 1 bản nháp");
    expect(unsyncedWarning({ messages: 0, drafts: 2 })?.body).toContain("bản nháp");
  });
});
