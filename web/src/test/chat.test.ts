import {
  applyMessageToInbox,
  applyPeerRead,
  canSendDraft,
  clearUnread,
  conversationSubtitle,
  conversationTitle,
  filterConversationsByTab,
  formatMissedMessages,
  formatUnreadBadge,
  isNearThreadBottom,
  isSeenByPeer,
  JOURNAL_TITLE,
  lastOutgoingId,
  matchesConversationQuery,
  mergeIncomingMessage,
  MESSAGE_TABS,
  tabOfKind,
  THREAD_BOTTOM_TOLERANCE_PX,
  threadScrollDecision,
  toIsoTimestamp,
  totalUnread,
  unreadForTab,
  type ChatMessage,
  type ConversationSummary,
  type ReadingContext,
} from "@/lib/chat-cache";

const ME = "u1";
const PEER = "u2";
/** Nothing on screen: every incoming peer message counts as unread. */
const READING: ReadingContext = { viewerId: ME, readingConversationId: null };

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    conversationId: "c1",
    senderId: "u1",
    content: "chào bạn",
    createdAt: "2026-09-05T10:00:00.000Z",
    ...overrides,
  };
}

function summary(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
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
    peerLastReadAt: null,
    sortAt: "2026-09-05T09:00:00.000Z",
    ...overrides,
  };
}

describe("following the newest message", () => {
  const tall = { scrollTop: 0, scrollHeight: 2000, clientHeight: 600 };
  const parked = { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 };

  it("reads a thread scrolled to its very end as being at the bottom", () => {
    expect(isNearThreadBottom(parked)).toBe(true);
  });

  it("tolerates a couple of lines of drift, but not a screenful", () => {
    expect(isNearThreadBottom({ ...parked, scrollTop: 1400 - THREAD_BOTTOM_TOLERANCE_PX })).toBe(true);
    expect(isNearThreadBottom({ ...parked, scrollTop: 1400 - THREAD_BOTTOM_TOLERANCE_PX - 1 })).toBe(false);
    expect(isNearThreadBottom(tall)).toBe(false);
  });

  it("treats a thread shorter than its window as always at the bottom", () => {
    expect(isNearThreadBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 600 })).toBe(true);
  });

  it("opens a conversation at its newest message without animating through history", () => {
    expect(
      threadScrollDecision({
        conversationChanged: true,
        firstPaint: true,
        sentByViewer: false,
        nearBottom: false,
      }),
    ).toBe("jump");
  });

  it("jumps on the first paint of a thread even when the messages arrive later", () => {
    expect(
      threadScrollDecision({
        conversationChanged: false,
        firstPaint: true,
        sentByViewer: false,
        nearBottom: false,
      }),
    ).toBe("jump");
  });

  it("always follows what the viewer sends, even from far up the history", () => {
    expect(
      threadScrollDecision({
        conversationChanged: false,
        firstPaint: false,
        sentByViewer: true,
        nearBottom: false,
      }),
    ).toBe("glide");
  });

  it("glides down for someone else's message while the viewer watches the live end", () => {
    expect(
      threadScrollDecision({
        conversationChanged: false,
        firstPaint: false,
        sentByViewer: false,
        nearBottom: true,
      }),
    ).toBe("glide");
  });

  it("never yanks a viewer who is reading older messages", () => {
    expect(
      threadScrollDecision({
        conversationChanged: false,
        firstPaint: false,
        sentByViewer: false,
        nearBottom: false,
      }),
    ).toBe("stay");
  });

  it("counts what arrived out of sight, and stays a plain invitation when nothing did", () => {
    expect(formatMissedMessages(0)).toBe("Tin nhắn mới nhất");
    expect(formatMissedMessages(1)).toBe("1 tin nhắn mới");
    expect(formatMissedMessages(240)).toBe("99+ tin nhắn mới");
  });
});

describe("toIsoTimestamp", () => {
  it("parses the raw Postgres form realtime replays", () => {
    expect(toIsoTimestamp("2026-09-05 10:00:00.123456+00")).toBe("2026-09-05T10:00:00.123Z");
  });

  it("passes ISO timestamps through unchanged", () => {
    expect(toIsoTimestamp("2026-09-05T10:00:00.000Z")).toBe("2026-09-05T10:00:00.000Z");
  });

  it("honours a non-UTC offset", () => {
    expect(toIsoTimestamp("2026-09-05 17:00:00+07")).toBe("2026-09-05T10:00:00.000Z");
  });
});

describe("mergeIncomingMessage", () => {
  it("ignores a replayed duplicate", () => {
    const thread = [message()];
    expect(mergeIncomingMessage(thread, message())).toBe(thread);
  });

  it("replaces the optimistic bubble instead of duplicating it", () => {
    const thread = [message({ id: "pending-1", pending: true })];
    const merged = mergeIncomingMessage(thread, message({ id: "server-1" }));

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("server-1");
    expect(merged[0].pending).toBeUndefined();
  });

  it("keeps the second bubble when the same text is sent twice", () => {
    const thread = [
      message({ id: "pending-1", pending: true }),
      message({ id: "pending-2", pending: true, createdAt: "2026-09-05T10:00:01.000Z" }),
    ];
    const merged = mergeIncomingMessage(thread, message({ id: "server-1" }));

    expect(merged).toHaveLength(2);
    expect(merged.filter((item) => item.pending === true)).toHaveLength(1);
  });

  it("inserts an out-of-order arrival at its real position", () => {
    const thread = [message({ id: "a", createdAt: "2026-09-05T10:00:00.000Z" })];
    const merged = mergeIncomingMessage(thread, message({ id: "b", createdAt: "2026-09-05T09:59:00.000Z" }));

    expect(merged.map((item) => item.id)).toEqual(["b", "a"]);
  });
});

describe("applyMessageToInbox", () => {
  it("moves the conversation to the top with its new preview", () => {
    const inbox = [
      summary({ conversationId: "c2", sortAt: "2026-09-05T11:00:00.000Z" }),
      summary({ conversationId: "c1", sortAt: "2026-09-05T09:00:00.000Z" }),
    ];
    const next = applyMessageToInbox(inbox, message({ createdAt: "2026-09-05T12:00:00.000Z" }), READING);

    expect(next?.map((item) => item.conversationId)).toEqual(["c1", "c2"]);
    expect(next?.[0].lastMessageContent).toBe("chào bạn");
    expect(next?.[0].lastMessageSenderId).toBe("u1");
  });

  it("compares mixed timestamp formats numerically, not as text", () => {
    const inbox = [summary({ conversationId: "c2", sortAt: "2026-09-05T11:00:00+00:00" }), summary()];
    const next = applyMessageToInbox(inbox, message({ createdAt: toIsoTimestamp("2026-09-05 11:30:00+00") }), READING);

    expect(next?.[0].conversationId).toBe("c1");
  });

  it("returns null for a conversation the inbox has never seen", () => {
    expect(applyMessageToInbox([summary()], message({ conversationId: "unknown" }), READING)).toBeNull();
  });

  it("keeps the newer preview when a late arrival shows up out of order", () => {
    const inbox = [
      summary({
        lastMessageContent: "tin mới",
        lastMessageAt: "2026-09-05T12:00:00.000Z",
        sortAt: "2026-09-05T12:00:00.000Z",
      }),
    ];
    const next = applyMessageToInbox(inbox, message({ content: "tin cũ", createdAt: "2026-09-05T11:00:00.000Z" }), {
      viewerId: PEER,
      readingConversationId: null,
    });

    expect(next?.[0].lastMessageContent).toBe("tin mới");
    expect(next?.[0].sortAt).toBe("2026-09-05T12:00:00.000Z");
    // It was still never seen by the viewer, so it must count.
    expect(next?.[0].unreadCount).toBe(1);
  });

  it("leaves the other rows untouched", () => {
    const inbox = [summary(), summary({ conversationId: "c2", lastMessageContent: "cũ" })];
    const next = applyMessageToInbox(inbox, message(), READING);

    expect(next?.find((item) => item.conversationId === "c2")?.lastMessageContent).toBe("cũ");
  });
});

describe("unread counting", () => {
  it("counts a message from the peer", () => {
    const next = applyMessageToInbox([summary()], message({ senderId: PEER }), READING);
    expect(next?.[0].unreadCount).toBe(1);
  });

  it("never counts your own message", () => {
    const next = applyMessageToInbox([summary({ unreadCount: 3 })], message({ senderId: ME }), READING);
    expect(next?.[0].unreadCount).toBe(3);
  });

  it("does not count a message in the thread being read", () => {
    const next = applyMessageToInbox([summary()], message({ senderId: PEER }), {
      viewerId: ME,
      readingConversationId: "c1",
    });
    expect(next?.[0].unreadCount).toBe(0);
  });

  it("still counts a message for another thread while reading one", () => {
    const inbox = [summary(), summary({ conversationId: "c2" })];
    const next = applyMessageToInbox(inbox, message({ conversationId: "c2", senderId: PEER }), {
      viewerId: ME,
      readingConversationId: "c1",
    });
    expect(next?.find((item) => item.conversationId === "c2")?.unreadCount).toBe(1);
  });

  it("clears one conversation without reordering the inbox", () => {
    const inbox = [summary({ unreadCount: 4 }), summary({ conversationId: "c2", unreadCount: 2 })];
    const next = clearUnread(inbox, "c1");

    expect(next.map((item) => item.conversationId)).toEqual(["c1", "c2"]);
    expect(next[0].unreadCount).toBe(0);
    expect(next[1].unreadCount).toBe(2);
  });

  it("returns the same array when there is nothing to clear", () => {
    const inbox = [summary()];
    expect(clearUnread(inbox, "c1")).toBe(inbox);
    expect(clearUnread(inbox, "missing")).toBe(inbox);
  });

  it("totals every conversation for the sidebar badge", () => {
    expect(totalUnread([summary({ unreadCount: 2 }), summary({ conversationId: "c2", unreadCount: 5 })])).toBe(7);
  });

  it("caps the badge instead of breaking the row", () => {
    expect(formatUnreadBadge(7)).toBe("7");
    expect(formatUnreadBadge(99)).toBe("99");
    expect(formatUnreadBadge(150)).toBe("99+");
  });
});

describe("message tabs", () => {
  const journal = summary({ conversationId: "j1", kind: "personal", peerId: null, peerEmail: null, memberCount: 1 });
  const direct = summary({ conversationId: "d1", kind: "direct" });
  const group = summary({
    conversationId: "g1",
    kind: "group",
    peerId: null,
    peerEmail: null,
    groupName: "Nhóm dự án",
    memberCount: 5,
  });

  it("offers exactly the three directions, in reading order", () => {
    expect(MESSAGE_TABS.map((tab) => tab.id)).toEqual(["journal", "direct", "group"]);
    expect(MESSAGE_TABS.map((tab) => tab.label)).toEqual(["Nhật ký", "Chat 1-1", "Chat group"]);
  });

  it("files each kind of thread under its own tab", () => {
    expect(tabOfKind("personal")).toBe("journal");
    expect(tabOfKind("direct")).toBe("direct");
    expect(tabOfKind("group")).toBe("group");
  });

  it("never leaks a thread into a tab it does not belong to", () => {
    const inbox = [journal, direct, group];
    expect(filterConversationsByTab(inbox, "journal").map((item) => item.conversationId)).toEqual(["j1"]);
    expect(filterConversationsByTab(inbox, "direct").map((item) => item.conversationId)).toEqual(["d1"]);
    expect(filterConversationsByTab(inbox, "group").map((item) => item.conversationId)).toEqual(["g1"]);
  });

  it("names a group by its own name, a journal after the reader, a 1-1 after the other person", () => {
    expect(conversationTitle(group)).toBe("Nhóm dự án");
    expect(conversationTitle(journal)).toBe(JOURNAL_TITLE);
    expect(conversationTitle(direct)).toBe("Ngọc");
  });

  it("still names a group whose name never arrived, rather than showing nothing", () => {
    expect(conversationTitle(summary({ kind: "group", groupName: null }))).toBe("Nhóm");
  });

  it("says who else is in the room on the second line", () => {
    expect(conversationSubtitle(group)).toBe("5 thành viên");
    expect(conversationSubtitle(direct)).toBe("ngoc@vidu.com");
    expect(conversationSubtitle(journal)).toBe("Chỉ mình bạn đọc được");
  });

  it("gives each tab its own badge instead of one shared total", () => {
    const inbox = [direct, summary({ conversationId: "g1", kind: "group", groupName: "Nhóm", unreadCount: 4 })];
    expect(unreadForTab(inbox, "group")).toBe(4);
    expect(unreadForTab(inbox, "direct")).toBe(0);
    expect(unreadForTab(inbox, "journal")).toBe(0);
  });

  it("searches a group by its name and a 1-1 by name, email or last message", () => {
    expect(matchesConversationQuery(group, "dự án")).toBe(true);
    expect(matchesConversationQuery(group, "ngọc")).toBe(false);
    expect(matchesConversationQuery(direct, "NGỌC")).toBe(true);
    expect(matchesConversationQuery(direct, "ngoc@vidu")).toBe(true);
    expect(matchesConversationQuery(summary({ lastMessageContent: "hẹn gặp mai" }), "gặp mai")).toBe(true);
  });

  it("treats an empty query as matching everything", () => {
    expect(matchesConversationQuery(group, "")).toBe(true);
    expect(matchesConversationQuery(group, "   ")).toBe(true);
  });
});

describe("read receipts", () => {
  it("moves the peer watermark forward", () => {
    const next = applyPeerRead([summary()], "c1", "2026-09-05T10:00:00.000Z");
    expect(next[0].peerLastReadAt).toBe("2026-09-05T10:00:00.000Z");
  });

  it("ignores an out-of-order watermark that would move backwards", () => {
    const inbox = [summary({ peerLastReadAt: "2026-09-05T10:00:00.000Z" })];
    expect(applyPeerRead(inbox, "c1", "2026-09-05T09:00:00.000Z")).toBe(inbox);
  });

  it("marks a message seen once the watermark reaches it", () => {
    const sent = message({ createdAt: "2026-09-05T10:00:00.000Z" });
    expect(isSeenByPeer(sent, "2026-09-05T10:00:00.000Z")).toBe(true);
    expect(isSeenByPeer(sent, "2026-09-05T10:00:01.000Z")).toBe(true);
    expect(isSeenByPeer(sent, "2026-09-05T09:59:59.000Z")).toBe(false);
    expect(isSeenByPeer(sent, null)).toBe(false);
  });

  it("never marks an unsent bubble as seen", () => {
    const pending = message({ pending: true, createdAt: "2026-09-05T10:00:00.000Z" });
    expect(isSeenByPeer(pending, "2026-09-05T11:00:00.000Z")).toBe(false);
  });

  it("puts the receipt on your newest message only", () => {
    const thread = [
      message({ id: "a", senderId: ME }),
      message({ id: "b", senderId: ME }),
      message({ id: "c", senderId: PEER }),
    ];
    expect(lastOutgoingId(thread, ME)).toBe("b");
    expect(lastOutgoingId([message({ id: "c", senderId: PEER })], ME)).toBeNull();
  });
});

describe("khung nhập tin nhắn", () => {
  it("refuses to send a draft that says nothing", () => {
    expect(canSendDraft("", false)).toBe(false);
    expect(canSendDraft("   ", false)).toBe(false);
    expect(canSendDraft("\n", false)).toBe(false);
    expect(canSendDraft(" \n \t \n ", false)).toBe(false);
  });

  it("allows a draft that carries real text", () => {
    expect(canSendDraft("chào bạn", false)).toBe(true);
    // Whitespace around real words is trimmed at send time, not a reason to refuse.
    expect(canSendDraft("  chào bạn  ", false)).toBe(true);
    // A message written across several lines is still a message.
    expect(canSendDraft("việc 1\nviệc 2", false)).toBe(true);
  });

  it("stays shut while a send is already in flight", () => {
    expect(canSendDraft("chào bạn", true)).toBe(false);
    expect(canSendDraft("", true)).toBe(false);
  });
});
