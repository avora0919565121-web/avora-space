import { vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { describe, expect, it } from "vitest";

import {
  contactInviteTimedOut,
  declinedInvite,
  draftInvite,
  inviteMessage,
  inviteSubject,
  pendingInvite,
  pendingInviteLabel,
  toVietnameseContactError,
  type ContactInvite,
} from "@/lib/contacts";
import { publicInviteState, reinviteNoteProblem, type PublicInvitePreview } from "@/lib/contact-invites";

const base: ContactInvite = {
  id: "i",
  contactId: "c",
  method: "sms",
  inviteToken: "t",
  status: "pending",
  invitedAt: "2026-11-01T00:00:00Z",
  acceptedAt: null,
};

describe("KT-07a · lời mời soạn sẵn", () => {
  it("có chủ ngữ, lời nhắn của người mời và hạn dùng", () => {
    const body = inviteMessage("Minh Anh", "https://app/moi/tok", {
      note: "Cô ơi, cô vào cùng con nhé.",
      expiresAt: "2026-11-26T05:00:00Z",
    });
    expect(body.split("\n")[0]).toBe("Tôi là Minh Anh. Tôi mời bạn vào AVORA — nơi riêng cho bạn và người thân.");
    expect(body).toContain("Cô ơi, cô vào cùng con nhé.");
    expect(body).toContain("Lời mời dùng được đến 26/11: https://app/moi/tok");
    expect(inviteSubject("Minh Anh")).toBe("Minh Anh mời bạn vào AVORA");
  });

  it("không có lời nhắn thì không có dòng trống", () => {
    expect(inviteMessage("Minh", "L", { note: "   " }).split("\n")).toHaveLength(2);
  });
});

describe("KT-07a · trạng thái lời mời phía người mời", () => {
  const now = new Date("2026-11-13T00:00:00Z");
  it("bản nháp không phải 'đang chờ'", () => {
    const draft = { ...base, status: "draft" as const, expiresAt: "2026-11-27T00:00:00Z" };
    expect(pendingInvite([draft], now)).toBeNull();
    expect(draftInvite([draft], now)?.id).toBe("i");
  });
  it("hạn đọc theo expires_at khi có", () => {
    expect(contactInviteTimedOut({ ...base, expiresAt: "2026-11-12T00:00:00Z" }, now)).toBe(true);
    expect(contactInviteTimedOut({ ...base, invitedAt: "2026-10-01T00:00:00Z", expiresAt: "2026-11-20T00:00:00Z" }, now)).toBe(false);
  });
  it("lời mời mới nhất là từ chối", () => {
    expect(declinedInvite([{ ...base, status: "declined" }, base])?.status).toBe("declined");
    expect(declinedInvite([base, { ...base, status: "declined" }])).toBeNull();
  });
  it("nhãn đang chờ ghi ngày đã gửi", () => {
    expect(pendingInviteLabel({ ...base, sentAt: "2026-11-12T03:00:00Z" })).toBe("Đã mời qua tin nhắn · 12/11 — đang chờ");
  });
});

describe("KT-07a · lời nhắn khi mời lại", () => {
  it("bắt buộc 10–200 ký tự, không liên kết", () => {
    expect(reinviteNoteProblem("ngắn")).toMatch(/10 ký tự/);
    expect(reinviteNoteProblem("x".repeat(201))).toMatch(/200/);
    expect(reinviteNoteProblem("Cô xem ở avora.vn nhé cô")).toMatch(/liên kết/);
    expect(reinviteNoteProblem("Cô ơi, con mời lại cô nhé.")).toBeNull();
  });
});

describe("KT-07a · trang mời công khai", () => {
  const p = (over: Partial<PublicInvitePreview>): PublicInvitePreview => ({
    inviterName: "Minh",
    status: "pending",
    expiresAt: null,
    note: null,
    isOwnInvite: false,
    alreadyLinked: false,
    signedIn: false,
    ...over,
  });
  it("người chưa có tài khoản vẫn thấy lời mời", () => {
    expect(publicInviteState(p({}))).toEqual({ kind: "ready", inviterName: "Minh", note: null, expiresAt: null, signedIn: false });
  });
  it("đã từ chối / hết hạn / của mình / không có", () => {
    expect(publicInviteState(p({ status: "declined" })).kind).toBe("declined");
    expect(publicInviteState(p({ status: "expired" })).kind).toBe("expired");
    expect(publicInviteState(p({ isOwnInvite: true })).kind).toBe("own");
    expect(publicInviteState(null).kind).toBe("missing");
  });
});

describe("KT-07a · lời từ chối của máy chủ nói bằng tiếng Việt", () => {
  it.each([
    ["avora_invite_declined_not_in_batch", "mỗi lần một người"],
    ["avora_invite_declined", "viết vài lời"],
    ["avora_invite_note_required", "10 ký tự"],
    ["avora_invite_reinvite_too_soon", "30 ngày"],
    ["Lời mời này đã được từ chối", "Bạn đã từ chối"],
  ])("%s", (raw, expected) => {
    expect(toVietnameseContactError(undefined, raw)).toContain(expected);
  });
});
