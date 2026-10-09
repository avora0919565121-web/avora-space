import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { mergeIncomingMessage, mergeThreadPage, toChatMessageRow, type ChatMessage, type MessageRowShape } from "@/lib/chat";
import { isPermanentSendError, nextSeq, outboxLabel, retryDelayMs, runLimited, sendableHeads, type OutboxItem } from "@/lib/outbox";

const row = (id: string, at: string, extra: Partial<MessageRowShape> = {}): MessageRowShape => ({
  id, conversation_id: "c", sender_id: "a", content: id, created_at: at, edited_at: null, deleted_at: null,
  reply_to_message_id: null, mentioned_user_ids: [], origin_group_id: null, attachment_count: 0,
  origin_content_id: null, origin_sender_id: null, system_kind: null, forward_bundle: null, is_urgent: false,
  refs: null, contact_card_user_id: null, ...extra,
});

const item = (id: string, conversationId: string, seq: number, state: OutboxItem["state"] = "queued"): OutboxItem => ({
  id, userId: "u", conversationId, content: id, replyToMessageId: null, mentionedUserIds: [], refs: [], originGroupId: null,
  isUrgent: false, files: [], createdAt: "", seq, state, attempts: 0, lastError: null,
});

describe("AVORA-106 · K2", () => {
  it("C4 · a realtime row maps to the same fields as a fetched one", () => {
    const fetched = toChatMessageRow(row("m1", "2026-10-09T01:00:00Z", { is_urgent: true, refs: [{ type: "task", id: "t" }], system_kind: "member_added", contact_card_user_id: "x", forward_bundle: { a: 1 } }));
    const keys = ["id", "conversationId", "senderId", "content", "createdAt", "editedAt", "deletedAt", "replyToMessageId", "mentionedUserIds", "originGroupId", "attachmentCount", "originContentId", "originSenderId", "systemKind", "forwardBundle", "isUrgent", "refs", "contactCardUserId"];
    expect(Object.keys(fetched).sort()).toEqual([...keys].sort());
    expect(fetched.isUrgent).toBe(true);
    expect(fetched.systemKind).toBe("member_added");
  });

  it("C1 · the server row replaces the waiting bubble with the same id (no duplicate)", () => {
    const waiting: ChatMessage = { ...toChatMessageRow(row("id-1", "2026-10-09T01:00:00Z")), pending: true };
    const arrived = toChatMessageRow(row("id-1", "2026-10-09T01:00:01Z"));
    const once = mergeIncomingMessage([waiting], arrived);
    const twice = mergeIncomingMessage(once, arrived);
    expect(twice).toHaveLength(1);
    expect(twice[0].pending).toBeUndefined();
  });

  it("C5 · a history page fetched during live delivery loses nothing and duplicates nothing", () => {
    const live = [toChatMessageRow(row("new", "2026-10-09T02:00:00Z"))];
    const page = [toChatMessageRow(row("old", "2026-10-09T01:00:00Z")), toChatMessageRow(row("new", "2026-10-09T02:00:00Z"))];
    const merged = mergeThreadPage(live, page);
    expect(merged.map((m) => m.id)).toEqual(["old", "new"]);
  });

  it("C5 · same-second messages keep a stable order by id", () => {
    const at = "2026-10-09T01:00:00Z";
    const merged = mergeThreadPage([], [toChatMessageRow(row("b", at)), toChatMessageRow(row("a", at))]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("C2/C3 · outbox sends in order per conversation; conversations do not wait for each other", () => {
    const heads = sendableHeads([item("2", "x", 2), item("1", "x", 1), item("3", "y", 3)]);
    expect(heads.map((h) => h.id).sort()).toEqual(["1", "3"]);
  });

  it("C2 · a failed head holds its conversation (order), others go on", () => {
    const heads = sendableHeads([item("1", "x", 1, "failed"), item("2", "x", 2), item("3", "y", 3)]);
    expect(heads.map((h) => h.id)).toEqual(["3"]);
  });

  it("C2 · labels, retry delays, permanent errors", () => {
    expect(outboxLabel({ state: "waiting_network" })).toBe("Đang chờ mạng");
    expect(outboxLabel({ state: "failed" })).toBe("Chưa gửi được · Gửi lại");
    expect(retryDelayMs(1)).toBe(1000);
    expect(retryDelayMs(10)).toBe(30000);
    expect(isPermanentSendError("avora_not_a_participant")).toBe(true);
    expect(isPermanentSendError("Failed to fetch")).toBe(false);
  });

  it("C3 · at most three uploads at once", async () => {
    let running = 0;
    let peak = 0;
    const tasks = Array.from({ length: 8 }, () => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return 1;
    });
    await runLimited(tasks, 3);
    expect(peak).toBe(3);
  });

  it("seq is strictly increasing within one millisecond", () => {
    const a = nextSeq(1000);
    const b = nextSeq(1000);
    expect(b).toBeGreaterThan(a);
  });
});
