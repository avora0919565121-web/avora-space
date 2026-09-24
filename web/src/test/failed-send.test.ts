import { describe, expect, it } from "vitest";

import {
  canEditMessage,
  canRecallMessage,
  canReplyToMessage,
  failedSendIdOf,
  failedSendToMessage,
  withFailedSends,
  type ChatMessage,
  type FailedSend,
} from "@/lib/chat-cache";

const ME = "me";

function message(id: string, createdAt: string): ChatMessage {
  return { id, conversationId: "c1", senderId: ME, content: id, createdAt, replyToMessageId: null };
}

const failed: FailedSend = {
  localId: "abc",
  conversationId: "c1",
  senderId: ME,
  content: "Chiều nay 3h nhé",
  createdAt: "2026-09-24T08:01:00.000Z",
  replyToMessageId: null,
  attachmentCount: 0,
};

describe("failed sends", () => {
  it("stays in the thread at the place it was written", () => {
    const thread = [message("a", "2026-09-24T08:00:00.000Z"), message("b", "2026-09-24T08:02:00.000Z")];
    const merged = withFailedSends(thread, [failed], "c1");
    expect(merged.map((entry) => entry.id)).toEqual(["a", "failed-abc", "b"]);
    expect(merged[1].failed).toBe(true);
    expect(merged[1].content).toBe("Chiều nay 3h nhé");
  });

  it("does not leak into other conversations and leaves the array alone when empty", () => {
    const thread = [message("a", "2026-09-24T08:00:00.000Z")];
    expect(withFailedSends(thread, [failed], "c2")).toBe(thread);
    expect(withFailedSends(thread, [], "c1")).toBe(thread);
  });

  it("reads 'Đang gửi…' again while a retry is in flight, in the same place", () => {
    const retrying = failedSendToMessage({ ...failed, isRetrying: true });
    expect(retrying.failed).toBe(false);
    expect(retrying.pending).toBe(true);
    expect(retrying.createdAt).toBe(failed.createdAt);
  });

  it("is never offered edit, recall or reply — it does not exist on the server", () => {
    const bubble = failedSendToMessage(failed);
    const now = new Date("2026-09-24T08:05:00.000Z");
    expect(canEditMessage(bubble, ME, now)).toBe(false);
    expect(canRecallMessage(bubble, ME, now)).toBe(false);
    expect(canReplyToMessage(bubble)).toBe(false);
  });

  it("maps a bubble back to its failed send, and nothing else", () => {
    expect(failedSendIdOf(failedSendToMessage(failed))).toBe("abc");
    expect(failedSendIdOf(message("real-id", "2026-09-24T08:00:00.000Z"))).toBeNull();
  });
});
