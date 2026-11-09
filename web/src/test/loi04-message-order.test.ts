import { describe, expect, it } from "vitest";

import { mergeThreadPage, serverTimeMicros, type ChatMessage } from "@/lib/chat-cache";

/* LOI-04 · thứ tự tin theo thời gian máy chủ ở độ chính xác micro giây, rồi mới tới id. */
function msg(id: string, createdAt: string): ChatMessage {
  return { id, conversationId: "c", senderId: "s", content: id, createdAt } as ChatMessage;
}

describe("LOI-04", () => {
  it("cùng một mili-giây: tin có micro giây nhỏ hơn đứng trước, dù id lớn hơn", () => {
    const early = msg("ffffffff-0000-4000-8000-000000000001", "2026-11-09T15:00:00.123100+00:00");
    const late = msg("00000000-0000-4000-8000-000000000002", "2026-11-09T15:00:00.123900+00:00");
    expect(mergeThreadPage([], [late, early]).map((m) => m.id)).toEqual([early.id, late.id]);
  });
  it("đọc được các dạng chuỗi thời gian máy chủ và máy", () => {
    expect(serverTimeMicros("2026-11-09T15:00:00.123456+00:00")).toBe(Date.UTC(2026, 10, 9, 15, 0, 0) * 1000 + 123456);
    expect(serverTimeMicros("2026-11-09 15:00:00.123456+00")).toBe(Date.UTC(2026, 10, 9, 15, 0, 0) * 1000 + 123456);
    expect(serverTimeMicros("2026-11-09T22:00:00.1+07:00")).toBe(Date.UTC(2026, 10, 9, 15, 0, 0) * 1000 + 100000);
    expect(serverTimeMicros("2026-11-09T15:00:00.123Z")).toBe(Date.UTC(2026, 10, 9, 15, 0, 0) * 1000 + 123000);
    expect(serverTimeMicros("2026-11-09T15:00:00Z")).toBe(Date.UTC(2026, 10, 9, 15, 0, 0) * 1000);
  });
  it("khác mili-giây: thứ tự như cũ", () => {
    const a = msg("b", "2026-11-09T15:00:00.120+00:00");
    const b = msg("a", "2026-11-09T15:00:00.121+00:00");
    expect(mergeThreadPage([], [b, a]).map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("LOI-04 · tin đến trực tiếp giữ micro giây", () => {
  it("toIsoMicros giữ đủ 6 chữ số", async () => {
    const { toIsoMicros } = await import("@/lib/chat-cache");
    expect(toIsoMicros("2026-11-09 15:00:00.895001+00")).toBe("2026-11-09T15:00:00.895001Z");
    expect(toIsoMicros("2026-11-09T22:00:00+07:00")).toBe("2026-11-09T15:00:00.000000Z");
  });
});
