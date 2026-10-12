import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { EXPIRED_MESSAGE_NOTE, messageBodyText, quotePreview, type ChatMessage } from "@/lib/chat-cache";
import { DISAPPEAR_NOTE, DISAPPEAR_OPTIONS, disappearLabel, expiredLine, isExpired, isTombstone, nextExpiryIn, TASK_STAYS_NOTE, visibleMessages } from "@/lib/disappear";
import { cacheable, scrubExpired } from "@/lib/thread-cache";

const NOW = new Date("2026-10-12T10:00:00Z").getTime();
const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: over.id ?? "m",
  conversationId: "c",
  senderId: "a",
  content: "xin chào",
  createdAt: "2026-10-12T09:00:00Z",
  deletedAt: null,
  expiresAt: null,
  expiredAt: null,
  systemKind: null,
  ...over,
});

describe("AVORA-109 · B — tin tự biến mất (client)", () => {
  it("offers Tắt · 1 giờ · 24 giờ · 7 ngày · 30 ngày, and says what it cannot promise", () => {
    expect(DISAPPEAR_OPTIONS.map((o) => o.label)).toEqual(["Tắt", "1 giờ", "24 giờ", "7 ngày", "30 ngày"]);
    expect(disappearLabel(86400)).toBe("24 giờ");
    expect(disappearLabel(null)).toBe("Tắt");
    expect(DISAPPEAR_NOTE).toBe("Người nhận vẫn có thể chụp màn hình hoặc sao chép trước khi tin biến mất.");
    expect(TASK_STAYS_NOTE).toBe("Nhiệm vụ này sẽ ở lại dù tin biến mất.");
  });

  it("an expired message is a tombstone — swept or simply past its time", () => {
    expect(isExpired(msg({ expiresAt: "2026-10-12T09:59:00Z" }), NOW)).toBe(true);
    expect(isExpired(msg({ expiresAt: "2026-10-12T10:01:00Z" }), NOW)).toBe(false);
    expect(isExpired(msg({ expiredAt: "2026-10-12T09:00:00Z" }), NOW)).toBe(true);
    expect(isTombstone(msg({ deletedAt: "2026-10-12T09:00:00Z" }), NOW)).toBe(true);
    expect(isTombstone(msg({}), NOW)).toBe(false);
  });

  it("reads apart from a recall: `Tin đã tự biến mất · 14:32`", () => {
    expect(expiredLine(msg({ expiresAt: "2026-10-12T07:32:00Z" }))).toMatch(/^Tin đã tự biến mất · \d{2}:\d{2}$/);
    expect(messageBodyText(msg({ expiredAt: "2026-10-12T09:00:00Z", content: "" }))).toBe(EXPIRED_MESSAGE_NOTE);
    expect(messageBodyText(msg({ deletedAt: "2026-10-12T09:00:00Z", content: "" }))).toBe("Tin nhắn đã được thu hồi.");
    expect(quotePreview(msg({ expiresAt: "2020-01-01T00:00:00Z" }))).toBe(EXPIRED_MESSAGE_NOTE);
  });

  it("hiding tombstones leaves no gap and keeps system lines", () => {
    const list = [
      msg({ id: "1" }),
      msg({ id: "2", deletedAt: "2026-10-12T09:00:00Z" }),
      msg({ id: "3", expiredAt: "2026-10-12T09:00:00Z" }),
      msg({ id: "4", systemKind: "disappear_changed", content: "Lan đã đặt tin tự biến mất sau 24 giờ" }),
    ];
    expect(visibleMessages(list, false, NOW).map((m) => m.id)).toEqual(["1", "2", "3", "4"]);
    expect(visibleMessages(list, true, NOW).map((m) => m.id)).toEqual(["1", "4"]);
  });

  it("knows when to redraw next", () => {
    expect(nextExpiryIn([msg({ expiresAt: "2026-10-12T10:00:30Z" }), msg({ expiresAt: "2026-10-12T10:05:00Z" })], NOW)).toBe(30_000);
    expect(nextExpiryIn([msg({ expiresAt: "2026-10-12T09:00:00Z" })], NOW)).toBeNull();
  });

  it("the copy on this device drops the words once the time is up", () => {
    const gone = scrubExpired(msg({ expiresAt: "2026-10-12T09:59:00Z", content: "bí mật" }), NOW);
    expect(gone.content).toBe("");
    expect(scrubExpired(msg({ expiresAt: "2026-10-12T10:59:00Z", content: "còn" }), NOW).content).toBe("còn");
    expect(cacheable([msg({ expiredAt: "2026-10-12T09:00:00Z", content: "x" })], NOW)[0].content).toBe("");
  });
});
