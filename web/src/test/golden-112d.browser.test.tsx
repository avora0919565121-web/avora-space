import { expect, test } from "vitest";

import { FakeAvoraServer as FakeServer, type ChangeEvent } from "@/test/reliability/fake-server";
import { recordMeasure } from "@/test/reliability/record";

/*
 * 112-D · đo trước/sau: số lần kiểm quyền mỗi thay đổi khi 50 người cùng mở app, và ai nhận được sự kiện.
 * Mô hình máy chủ (cùng luật với trigger 112-D và RLS bảng tasks), không phải Supabase Realtime thật — độ trễ
 * thật đo trên máy (THU-MAY-THAT).
 */
const people = Array.from({ length: 50 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

function run(mode: "legacy" | "broadcast"): { checks: number; changes: number; delivered: number; wrongDeliveries: number } {
  const server = new FakeServer();
  const got = new Map<string, number>();
  for (const person of people) {
    server.subscribe({
      userId: person,
      topic: mode === "legacy" ? `avora-chat-${person}` : `user-${person}`,
      deliver: (event: ChangeEvent) => {
        if (event.event === "task" || event.table === "tasks") got.set(person, (got.get(person) ?? 0) + 1);
      },
    });
  }
  // 100 việc giao qua lại giữa người 0 và người 1; 48 người còn lại không được nhận gì.
  for (let i = 0; i < 100; i += 1) {
    server.upsertTask({ id: `t-${i}`, creator_id: people[i % 2], assignee_id: people[(i + 1) % 2], title: `Việc ${i}`, status: "confirmed" });
  }
  const wrong = [...got.entries()].filter(([person]) => person !== people[0] && person !== people[1]).reduce((sum, [, n]) => sum + n, 0);
  return {
    checks: mode === "legacy" ? server.authChecks.legacy : server.authChecks.broadcast,
    changes: server.authChecks.changes,
    delivered: (got.get(people[0]) ?? 0) + (got.get(people[1]) ?? 0),
    wrongDeliveries: wrong,
  };
}

test("112-D · 50 người mở app, 100 việc giữa hai người: kiểm quyền mỗi thay đổi, trước và sau Broadcast", async () => {
  const before = run("legacy");
  const after = run("broadcast");
  await recordMeasure("L10.6-realtime-50-nguoi", {
    threshold: "Chuyển postgres_changes toàn bảng → Broadcast theo kênh người; giữ đúng người nhận",
    people: people.length,
    changes: after.changes,
    legacy: { authChecksPerChange: before.checks / before.changes, delivered: before.delivered, wrongDeliveries: before.wrongDeliveries },
    broadcast: { authChecksPerChange: after.checks / after.changes, delivered: after.delivered, wrongDeliveries: after.wrongDeliveries },
    note: "Mô hình: legacy = RLS của dòng chạy cho mỗi người đang nghe bảng (50 lần mỗi thay đổi); broadcast = trigger tính người nhận một lần, mỗi kênh riêng được cấp quyền một lần lúc vào.",
  });
  expect(before.checks / before.changes).toBe(50);
  expect(after.checks / after.changes).toBe(1);
  expect(after.delivered).toBe(before.delivered);
  expect(after.wrongDeliveries).toBe(0);
  expect(before.wrongDeliveries).toBe(0);
});
