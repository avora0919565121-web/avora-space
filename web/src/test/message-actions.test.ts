import { describe, expect, it } from "vitest";

// These are pure cache helpers, so the Supabase client is never involved.
import {
  applyMessageEditToInbox,
  applyMessageUpdate,
  canEditMessage,
  canRecallMessage,
  canReplyToMessage,
  isEdited,
  isRecalled,
  isWithinEditWindow,
  MESSAGE_EDIT_WINDOW_MS,
  messageBodyText,
  quotePreview,
  RECALLED_MESSAGE_NOTE,
  type ChatMessage,
  type ConversationSummary,
} from "@/lib/chat-cache";

const ME = "u-me";
const THEM = "u-them";
const CONV = "c-1";
const NOW = new Date("2026-09-14T12:00:00Z");

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    conversationId: CONV,
    senderId: ME,
    content: "Xin chào",
    createdAt: "2026-09-14T11:30:00Z",
    editedAt: null,
    deletedAt: null,
    replyToMessageId: null,
    ...overrides,
  };
}

describe("the 24-hour window", () => {
  it("is open for a message sent a moment ago", () => {
    expect(isWithinEditWindow(makeMessage(), NOW)).toBe(true);
  });

  /** The boundary itself counts as inside; a second past it does not. */
  it("closes exactly 24 hours after the message was sent", () => {
    const atBoundary = makeMessage({
      createdAt: new Date(NOW.getTime() - MESSAGE_EDIT_WINDOW_MS).toISOString(),
    });
    const justPast = makeMessage({
      createdAt: new Date(NOW.getTime() - MESSAGE_EDIT_WINDOW_MS - 1000).toISOString(),
    });
    expect(isWithinEditWindow(atBoundary, NOW)).toBe(true);
    expect(isWithinEditWindow(justPast, NOW)).toBe(false);
  });
});

describe("who may correct a message", () => {
  it("lets the sender fix their own words inside the window", () => {
    expect(canEditMessage(makeMessage(), ME, NOW)).toBe(true);
  });

  it("never lets anyone edit someone else's message", () => {
    expect(canEditMessage(makeMessage({ senderId: THEM }), ME, NOW)).toBe(false);
  });

  it("stops offering it once the window has closed", () => {
    const old = makeMessage({ createdAt: "2026-09-10T11:30:00Z" });
    expect(canEditMessage(old, ME, NOW)).toBe(false);
  });

  /** A withdrawn message has no words to correct; editing would undo the withdrawal. */
  it("refuses to edit a message that was taken back", () => {
    const recalled = makeMessage({ deletedAt: "2026-09-14T11:40:00Z", content: "" });
    expect(canEditMessage(recalled, ME, NOW)).toBe(false);
  });

  it("waits until a message has actually been sent", () => {
    expect(canEditMessage(makeMessage({ pending: true }), ME, NOW)).toBe(false);
  });

  it("is false when nobody is signed in", () => {
    expect(canEditMessage(makeMessage(), undefined, NOW)).toBe(false);
  });
});

describe("who may take a message back", () => {
  it("lets the sender withdraw their own, inside the window", () => {
    expect(canRecallMessage(makeMessage(), ME, NOW)).toBe(true);
  });

  it("never lets anyone withdraw someone else's", () => {
    expect(canRecallMessage(makeMessage({ senderId: THEM }), ME, NOW)).toBe(false);
  });

  it("stops offering it once the window has closed", () => {
    expect(canRecallMessage(makeMessage({ createdAt: "2026-09-01T00:00:00Z" }), ME, NOW)).toBe(false);
  });

  it("has nothing left to do on an already-withdrawn message", () => {
    expect(canRecallMessage(makeMessage({ deletedAt: "2026-09-14T11:40:00Z" }), ME, NOW)).toBe(false);
  });
});

describe("who may reply", () => {
  /** Answering the gap where something was said is legitimate — the quote says as much. */
  it("allows a reply to anyone's message, including a withdrawn one", () => {
    expect(canReplyToMessage(makeMessage({ senderId: THEM }))).toBe(true);
    expect(canReplyToMessage(makeMessage({ deletedAt: "2026-09-14T11:40:00Z" }))).toBe(true);
  });

  it("waits for a message to exist before it can be answered", () => {
    expect(canReplyToMessage(makeMessage({ pending: true }))).toBe(false);
  });
});

describe("what a withdrawn message reads as", () => {
  it("shows the note in place of the words, everywhere", () => {
    const recalled = makeMessage({ content: "", deletedAt: "2026-09-14T11:40:00Z" });
    expect(isRecalled(recalled)).toBe(true);
    expect(messageBodyText(recalled)).toBe(RECALLED_MESSAGE_NOTE);
    expect(quotePreview(recalled)).toBe(RECALLED_MESSAGE_NOTE);
  });

  it("leaves an ordinary message alone", () => {
    const live = makeMessage({ content: "Nội dung thật" });
    expect(isRecalled(live)).toBe(false);
    expect(messageBodyText(live)).toBe("Nội dung thật");
  });

  /**
   * A withdrawal is not an edit. Showing "(đã chỉnh sửa)" on a recalled message would
   * describe the wrong event.
   */
  it("is never also described as edited", () => {
    const both = makeMessage({
      content: "",
      editedAt: "2026-09-14T11:35:00Z",
      deletedAt: "2026-09-14T11:40:00Z",
    });
    expect(isEdited(both)).toBe(false);
  });

  it("marks a corrected message as edited", () => {
    expect(isEdited(makeMessage({ editedAt: "2026-09-14T11:35:00Z" }))).toBe(true);
    expect(isEdited(makeMessage())).toBe(false);
  });
});

describe("quote previews", () => {
  it("flattens line breaks so a quote stays one or two lines", () => {
    expect(quotePreview(makeMessage({ content: "dòng một\ndòng hai" }))).toBe("dòng một dòng hai");
  });

  it("trims a long message rather than letting it fill the strip", () => {
    const long = makeMessage({ content: "a".repeat(200) });
    const preview = quotePreview(long, 40);
    expect(preview).toHaveLength(40);
    expect(preview.endsWith("…")).toBe(true);
  });
});

describe("patching a cached thread", () => {
  const thread: ChatMessage[] = [
    makeMessage({ id: "m1", content: "đầu tiên" }),
    makeMessage({ id: "m2", content: "thứ hai" }),
  ];

  it("replaces the message in place rather than appending it", () => {
    const next = applyMessageUpdate(
      thread,
      makeMessage({ id: "m2", content: "thứ hai đã sửa", editedAt: "2026-09-14T11:50:00Z" }),
    );
    expect(next).toHaveLength(2);
    expect(next[1]?.content).toBe("thứ hai đã sửa");
    expect(isEdited(next[1] as ChatMessage)).toBe(true);
  });

  it("keeps the same array when nothing actually changed, so React can skip the render", () => {
    expect(applyMessageUpdate(thread, makeMessage({ id: "m1", content: "đầu tiên" }))).toBe(thread);
  });

  it("ignores an update for a message this thread does not hold", () => {
    expect(applyMessageUpdate(thread, makeMessage({ id: "elsewhere" }))).toBe(thread);
  });

  /** `pending` is a client-only flag; a row from the server has plainly been written. */
  it("clears the pending flag when the server's version arrives", () => {
    const optimistic = [makeMessage({ id: "m3", pending: true })];
    const next = applyMessageUpdate(optimistic, makeMessage({ id: "m3", content: "đã lưu" }));
    expect(next[0]?.pending).toBeUndefined();
  });
});

describe("keeping the inbox preview honest", () => {
  const inbox: ConversationSummary[] = [
    {
      conversationId: CONV,
      kind: "direct",
      peerId: THEM,
      peerName: "Người kia",
      peerEmail: null,
      groupName: null,
      memberCount: 2,
      lastMessageContent: "thứ hai",
      lastMessageAt: "2026-09-14T11:30:00Z",
      lastMessageSenderId: ME,
      unreadCount: 0,
      peerLastReadAt: null,
      sortAt: "2026-09-14T11:30:00Z",
    },
  ];

  it("rewrites the preview when the previewed message is corrected", () => {
    const next = applyMessageEditToInbox(
      inbox,
      makeMessage({ content: "thứ hai đã sửa", createdAt: "2026-09-14T11:30:00Z" }),
    );
    expect(next[0]?.lastMessageContent).toBe("thứ hai đã sửa");
  });

  it("shows the withdrawal note in the preview once the newest message is taken back", () => {
    const next = applyMessageEditToInbox(
      inbox,
      makeMessage({ content: "", deletedAt: "2026-09-14T11:40:00Z", createdAt: "2026-09-14T11:30:00Z" }),
    );
    expect(next[0]?.lastMessageContent).toBe(RECALLED_MESSAGE_NOTE);
  });

  /**
   * The reason this is not a blanket overwrite: editing something from last week must not
   * replace the line showing what was said a minute ago.
   */
  it("leaves the preview alone when an older message is edited", () => {
    const next = applyMessageEditToInbox(
      inbox,
      makeMessage({ content: "sửa tin cũ", createdAt: "2026-09-10T09:00:00Z" }),
    );
    expect(next).toBe(inbox);
  });

  it("ignores a conversation it does not hold", () => {
    expect(applyMessageEditToInbox(inbox, makeMessage({ conversationId: "other" }))).toBe(inbox);
  });
});
