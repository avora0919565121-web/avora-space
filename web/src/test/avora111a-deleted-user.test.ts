import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { daysUntil, deletionErrorMessage, isConfirmWord, parseDeletionStatus, gateAckKey } from "@/lib/account-deletion";
import { directPeerName, toChatMessageRow, type MessageRowShape } from "@/lib/chat";
import { conversationTitle } from "@/lib/chat-cache";
import { DELETED_USER_ID, DELETED_USER_NAME, FALLBACK_PEER_NAME, isDeletedUser, memberNameOf, senderIdOf } from "@/lib/initials";
import { PRIVACY } from "@/lib/policy-content";

/*
 * 111-A (ADR-092) · after an account is deleted the server keeps its text messages in shared rooms
 * with `sender_id = null`. Every place that names a sender must say "Người dùng đã xoá" — never
 * "Người dùng AVORA" (no name set) and never "Thành viên" (a role).
 */
const row = (sender: string | null): MessageRowShape => ({
  id: "m1",
  conversation_id: "c1",
  sender_id: sender,
  content: "Chào nhóm",
  created_at: "2026-11-09T01:00:00Z",
  edited_at: null,
  deleted_at: null,
  reply_to_message_id: null,
  mentioned_user_ids: null,
  origin_group_id: null,
  attachment_count: 0,
  origin_content_id: null,
  origin_sender_id: null,
  system_kind: null,
});

describe("111-A · người gửi đã xoá", () => {
  it("tin có sender_id null giữ một id chuỗi cố định, không phải null", () => {
    const message = toChatMessageRow(row(null));
    expect(typeof message.senderId).toBe("string");
    expect(message.senderId).toBe(DELETED_USER_ID);
    expect(toChatMessageRow(row("u-a")).senderId).toBe("u-a");
  });

  it("tên người gửi trong nhóm: Người dùng đã xoá, không rơi vào nhãn khác", () => {
    const names = new Map([["u-a", "Lan"]]);
    const deleted = toChatMessageRow(row(null)).senderId;
    expect(memberNameOf(names, deleted, "Thành viên")).toBe(DELETED_USER_NAME);
    expect(memberNameOf(names, null)).toBe(DELETED_USER_NAME);
    expect(memberNameOf(names, "u-a", "Thành viên")).toBe("Lan");
    expect(memberNameOf(names, "u-x", "Thành viên")).toBe("Thành viên");
    expect(DELETED_USER_NAME).not.toBe(FALLBACK_PEER_NAME);
    expect(isDeletedUser(deleted)).toBe(true);
    expect(isDeletedUser("u-a")).toBe(false);
    expect(senderIdOf("")).toBe(DELETED_USER_ID);
  });

  it("cuộc 1-1 mà người kia đã xoá tài khoản: tiêu đề Người dùng đã xoá", () => {
    expect(directPeerName("direct", null, null)).toBe(DELETED_USER_NAME);
    expect(directPeerName("direct", "u-a", null)).toBe(FALLBACK_PEER_NAME);
    expect(directPeerName("direct", "u-a", "Lan")).toBe("Lan");
    expect(directPeerName("group", null, null)).toBe(FALLBACK_PEER_NAME);
    expect(
      conversationTitle({ kind: "direct", peerName: directPeerName("direct", null, null), verification: null } as never),
    ).toBe(DELETED_USER_NAME);
  });
});

describe("111-A · luồng xoá", () => {
  it("chỉ chữ XOA (không phân biệt hoa thường, bỏ khoảng trắng hai đầu)", () => {
    for (const ok of ["XOA", "xoa", " XOA ", "Xoa"]) expect(isConfirmWord(ok)).toBe(true);
    for (const no of ["", "XOÁ", "XO A", "DELETE", "XOAA"]) expect(isConfirmWord(no)).toBe(false);
  });

  it("đọc trạng thái an toàn khi thiếu trường", () => {
    expect(parseDeletionStatus(null)).toEqual({ status: "none", graceDays: 14, requestedAt: null, executeAfter: null, method: null });
    expect(parseDeletionStatus({ status: "pending", grace_days: 14, execute_after: "2026-11-23T00:00:00Z", method: "otp" }).status).toBe("pending");
    expect(parseDeletionStatus({ status: "weird" }).status).toBe("none");
  });

  it("số ngày còn lại làm tròn lên", () => {
    const now = Date.parse("2026-11-09T00:00:00Z");
    expect(daysUntil("2026-11-23T00:00:00Z", now)).toBe(14);
    expect(daysUntil("2026-11-09T01:00:00Z", now)).toBe(1);
    expect(daysUntil("2026-11-08T00:00:00Z", now)).toBe(0);
    expect(daysUntil(null, now)).toBe(0);
  });

  it("lỗi server thành câu tiếng Việt, không lộ mã", () => {
    for (const code of ["avora_account_reauth_required", "avora_account_otp_rate", "avora_password_check_rate", "avora_feature_off", "lạ"]) {
      const text = deletionErrorMessage(code);
      expect(text).not.toMatch(/avora_/);
      expect(text.length).toBeGreaterThan(5);
    }
  });

  it("màn chờ gắn với từng lần đăng nhập", () => {
    expect(gateAckKey("u", "2026-11-09T01:00:00Z")).not.toBe(gateAckKey("u", "2026-11-10T01:00:00Z"));
  });

  it("Chính sách: tự xoá đã có; nhà hoang ghi chưa áp dụng", () => {
    const items = PRIVACY.sections.flatMap((section) => section.items);
    const self = items.find((item) => item.id === "self-delete");
    expect(self?.status).toBe("done");
    expect(self?.text).toContain("14 ngày");
    expect(self?.text).toContain("Người dùng đã xoá");
    const abandoned = items.find((item) => item.id === "abandoned");
    expect(abandoned?.text).toContain("chưa áp dụng");
    expect(abandoned?.status).toBe("soon");
    expect(items.some((item) => /tự xoá tài khoản trong Cài đặt/.test(item.text) && item.status === "soon")).toBe(false);
  });
});
