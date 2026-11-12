import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { mergeIncomingMessage, type ChatMessage } from "@/lib/chat-cache";
import { resumedItem, sendableHeads, type OutboxItem } from "@/lib/outbox";

function item(over: Partial<OutboxItem>): OutboxItem {
  return {
    id: "m1", userId: "u", conversationId: "c", content: "x", replyToMessageId: null, mentionedUserIds: [], refs: [],
    originGroupId: null, isUrgent: false, files: [], createdAt: "2026-11-13T00:00:00Z", seq: 1, state: "queued", attempts: 0, lastError: null,
    ...over,
  };
}

describe("KT-07a2 · QA04-01 — tin 'sending' sau khi tải lại", () => {
  it("đưa về queued để được gửi lại (không kẹt cả cuộc)", () => {
    const stuck = item({ id: "a", seq: 1, state: "sending", attempts: 1 });
    const next = item({ id: "b", seq: 2 });
    expect(sendableHeads([stuck, next])).toEqual([]);
    const resumed = [stuck, next].map(resumedItem);
    expect(resumed[0].state).toBe("queued");
    expect(resumed[0].id).toBe("a"); // same id → send_message returns the existing row, no duplicate
    expect(sendableHeads(resumed).map((entry) => entry.id)).toEqual(["a"]);
  });
  it("không đụng mục đang chờ mạng hay đã hỏng", () => {
    const waiting = item({ state: "waiting_network" });
    const failed = item({ state: "failed", permanent: true });
    expect(resumedItem(waiting)).toBe(waiting);
    expect(resumedItem(failed)).toBe(failed);
  });
});

describe("KT-07a2 · QA04-07 — 10 tin gửi nhanh giữ đúng thứ tự", () => {
  const msg = (id: string, createdAt: string, pending: boolean): ChatMessage =>
    ({ id, conversationId: "c", senderId: "u", content: id, createdAt, pending } as ChatMessage);
  it("bong bóng còn chờ luôn đứng sau tin máy chủ đã nhận, kể cả khi đồng hồ máy lệch", () => {
    // Device clock is 2 s behind the server: waiting bubbles carry earlier times than confirmed rows.
    let thread: ChatMessage[] = [];
    for (let n = 1; n <= 10; n += 1) thread.push(msg(`t${n}`, `2026-11-13T00:00:0${n - 1}.000Z`, true));
    thread = mergeIncomingMessage(thread, msg("t1", "2026-11-13T00:00:11.000Z", false));
    thread = mergeIncomingMessage(thread, msg("t2", "2026-11-13T00:00:11.500Z", false));
    expect(thread.map((entry) => entry.id)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"]);
  });
});

describe("KT-07a2 · QA04-02 — gửi khi mất mạng vẫn vào hàng đợi ngay", () => {
  it("mutation gửi tin không bị react-query tạm dừng khi offline (networkMode always)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../pages/Messages.tsx", import.meta.url), "utf8");
    const block = source.slice(source.indexOf("const sendMutation = useMutation({"), source.indexOf("mutationFn:", source.indexOf("const sendMutation = useMutation({")));
    expect(block).toContain('networkMode: "always"');
  });
});
