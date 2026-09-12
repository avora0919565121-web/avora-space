import { describe, expect, it } from "vitest";

// Imported from the pure module, not the barrel: `@/lib/chat` pulls in the Supabase client,
// which needs credentials these node tests deliberately run without.
import {
  conversationsWithUnread,
  totalUnread,
  unreadSummaryText,
  type ConversationSummary,
} from "@/lib/chat-cache";

function conversation(id: string, unreadCount: number): ConversationSummary {
  return {
    conversationId: id,
    kind: "direct",
    peerId: `peer-${id}`,
    peerName: `Người ${id}`,
    peerEmail: `${id}@avora.app`,
    groupName: null,
    memberCount: 2,
    lastMessageContent: "Xin chào",
    lastMessageAt: "2026-09-11T03:00:00.000Z",
    lastMessageSenderId: `peer-${id}`,
    unreadCount,
    peerLastReadAt: null,
    sortAt: "2026-09-11T03:00:00.000Z",
  };
}

describe("the messages line on Avora Space", () => {
  it("counts threads waiting, not messages waiting", () => {
    const inbox = [conversation("a", 5), conversation("b", 1), conversation("c", 0)];
    // Six unread messages, but only two people are actually waiting on a reply.
    expect(totalUnread(inbox)).toBe(6);
    expect(conversationsWithUnread(inbox)).toBe(2);
  });

  it("is zero on an empty or fully-read inbox", () => {
    expect(conversationsWithUnread([])).toBe(0);
    expect(conversationsWithUnread([conversation("a", 0), conversation("b", 0)])).toBe(0);
  });

  it("reads the way a person would say it", () => {
    expect(unreadSummaryText(1)).toBe("1 cuộc trò chuyện có tin mới");
    expect(unreadSummaryText(3)).toBe("3 cuộc trò chuyện có tin mới");
    expect(unreadSummaryText(0)).toBe("Không có tin nhắn mới.");
  });
});
