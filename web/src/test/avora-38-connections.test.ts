import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { conversationSubtitle, conversationTitle, type ConversationSummary } from "@/lib/chat-cache";
import { connectLink, looksLikePin, matchesConnection, normalizePinInput, pinFromScan } from "@/lib/connections";
import { canCreateGroup } from "@/lib/groups";
import { matchesSearch, normalizeSearch } from "@/lib/normalize-search";

const base: ConversationSummary = {
  conversationId: "c1",
  kind: "direct",
  peerId: "u2",
  peerName: "Ngọc",
  peerEmail: "ngoc@vidu.com",
  groupName: null,
  memberCount: 2,
  lastMessageContent: null,
  lastMessageAt: null,
  lastMessageSenderId: null,
  unreadCount: 0,
  sortAt: "2026-09-28T00:00:00Z",
};

describe("AVORA-38 PIN input", () => {
  it("adds the A- prefix and upper-cases", () => {
    expect(normalizePinInput(" avr22 vmt ")).toBe("A-AVR22VMT");
    expect(normalizePinInput("a-avr22vmt")).toBe("A-AVR22VMT");
    expect(looksLikePin("AVR22VMT")).toBe(true);
    expect(looksLikePin("abc")).toBe(false);
  });

  it("reads a PIN from a QR link or bare text, and nothing else", () => {
    expect(pinFromScan(connectLink("A-AVR22VMT", "https://avora.rork.app"))).toBe("A-AVR22VMT");
    expect(pinFromScan("A-AVR22VMT")).toBe("A-AVR22VMT");
    expect(pinFromScan("https://example.com/other")).toBeNull();
  });
});

describe("AVORA-38 accent-free search", () => {
  it("folds Vietnamese marks and đ", () => {
    expect(normalizeSearch("Nguyễn Văn Đạt")).toBe("nguyen van dat");
    expect(matchesSearch("nguyen dat", ["Nguyễn Văn Đạt"])).toBe(true);
    expect(matchesSearch("hoa", ["Nguyễn Văn Đạt"])).toBe(false);
  });

  it("finds a bạn by PIN with or without the dash", () => {
    const friend = { userId: "u", displayName: "Thiện", pin: "A-AVR22VMT", createdAt: "" };
    expect(matchesConnection(friend, "avr22")).toBe(true);
    expect(matchesConnection(friend, "a-avr22vmt")).toBe(true);
    expect(matchesConnection(friend, "thien")).toBe(true);
  });
});

describe("AVORA-38 verification frame labels", () => {
  const verification = {
    expiresAt: "2026-10-05T00:00:00Z",
    viaGroupId: null,
    viaGroupName: null,
    openedBy: "u2",
    messagesLeft: 5,
    confirmedByMe: false,
  };

  it("a PIN frame shows only the PIN", () => {
    const summary = { ...base, peerName: "Người dùng AVORA", peerEmail: null, peerPin: "A-AVR83NNT", verification };
    expect(conversationTitle(summary)).toBe("A-AVR83NNT");
    expect(conversationSubtitle(summary)).toBe("Chờ kết bạn");
  });

  it("a Nhóm frame shows the name and the Nhóm", () => {
    const summary = { ...base, verification: { ...verification, viaGroupId: "g", viaGroupName: "Gia đình" } };
    expect(conversationTitle(summary)).toBe("Ngọc");
    expect(conversationSubtitle(summary)).toBe("Từ nhóm Gia đình");
  });
});

describe("AVORA-38 group size", () => {
  it("needs 3 people counting the creator, at most 300", () => {
    expect(canCreateGroup("Nhóm", 1)).toBe(false);
    expect(canCreateGroup("Nhóm", 2)).toBe(true);
    expect(canCreateGroup("Nhóm", 299)).toBe(true);
    expect(canCreateGroup("Nhóm", 300)).toBe(false);
    expect(canCreateGroup("  ", 5)).toBe(false);
  });
});
