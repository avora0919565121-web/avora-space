import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { conversationSubtitle, type ConversationSummary } from "@/lib/chat-cache";
import { inviteExpiryLabel, INVITE_LINK_TTL_DAYS } from "@/lib/groups";
import { FALLBACK_PEER_NAME, peerLabel } from "@/lib/initials";

describe("vá gấp 2026-09-29", () => {
  it("never turns an email into a name", () => {
    expect(peerLabel(null)).toBe("Người dùng AVORA");
    expect(peerLabel("   ")).toBe(FALLBACK_PEER_NAME);
    expect(peerLabel(" Lan ")).toBe("Lan");
  });

  it("does not show the peer's email as a 1-1 subtitle", () => {
    const summary = { kind: "direct", peerEmail: "ngoc@vidu.com", verification: null } as unknown as ConversationSummary;
    expect(conversationSubtitle(summary)).toBe("Người dùng AVORA");
  });

  it("invite links last 7 days and say when they end", () => {
    expect(INVITE_LINK_TTL_DAYS).toBe(7);
    const now = new Date("2026-09-29T08:00:00Z");
    expect(inviteExpiryLabel("2026-10-06T08:00:00Z", now)).toMatch(/^Còn hiệu lực 7 ngày/);
    expect(inviteExpiryLabel("2026-09-29T20:00:00Z", now)).toMatch(/^Hết hạn trong hôm nay/);
    expect(inviteExpiryLabel("2026-09-28T08:00:00Z", now)).toBe("Liên kết đã hết hạn — tạo liên kết mới.");
  });
});
