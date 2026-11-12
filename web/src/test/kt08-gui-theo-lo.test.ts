import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BATCH_MAX, batchRun, isRateLimited, type OutboxItem } from "@/lib/outbox";

const item = (id: string, seq: number, extra: Partial<OutboxItem> = {}): OutboxItem => ({
  id, seq, userId: "u", conversationId: "c", content: id, replyToMessageId: null, mentionedUserIds: [], refs: [], originGroupId: null,
  isUrgent: false, files: [], createdAt: "2026-11-13T00:00:00Z", state: "queued", attempts: 0, lastError: null, ...extra,
});

describe("KT-08 · QA04-07 — gửi theo lô", () => {
  it("lấy đầu hàng + các tin chữ ngay sau, đúng thứ tự, tối đa BATCH_MAX", () => {
    const items = [item("c", 3), item("a", 1), item("b", 2), item("x", 9, { conversationId: "khác" }), ...[4, 5, 6, 7].map((n) => item(`n${n}`, n))];
    expect(batchRun(items, items[1]).map((entry) => entry.id)).toEqual(["a", "b", "c", "n4", "n5"]);
    expect(BATCH_MAX).toBe(5);
  });

  it("dừng ở tin có tệp hoặc tin không chờ gửi; đầu hàng có tệp thì đi một mình", () => {
    const file = { localId: "f", blob: new Blob(["x"]), fileName: "a.png", mimeType: "image/png", kind: "image" as const, width: 1, height: 1, durationSeconds: null, permission: "export" as const, captureSource: null };
    const items = [item("a", 1), item("b", 2), item("photo", 3, { files: [file] }), item("d", 4)];
    expect(batchRun(items, items[0]).map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(batchRun(items, items[2]).map((entry) => entry.id)).toEqual(["photo"]);
    const failed = [item("a", 1), item("b", 2, { state: "failed", permanent: true }), item("c", 3)];
    expect(batchRun(failed, failed[0]).map((entry) => entry.id)).toEqual(["a"]);
  });

  it("nhận ra 'quá nhanh' của máy chủ", () => {
    expect(isRateLimited("avora_rate_limited")).toBe(true);
    expect(isRateLimited("avora_not_a_participant")).toBe(false);
  });

  it("bên nhận gộp 'Đã nhận' thay vì một request mỗi tin", () => {
    const realtime = readFileSync(new URL("../lib/realtime.tsx", import.meta.url), "utf8");
    expect(realtime).toMatch(/markDeliveredSoon\(incoming\.id\)/);
    expect(realtime).not.toMatch(/markMessagesDelivered\(\[incoming\.id\]\)/);
  });
});
