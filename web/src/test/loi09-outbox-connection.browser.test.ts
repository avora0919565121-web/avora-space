import { expect, test, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { outboxStore, type OutboxItem } from "@/lib/outbox";

/* LOI-09 · hàng chờ giữ MỘT kết nối IndexedDB và dùng lại; đóng khi có versionchange để xoá cơ sở dữ liệu không bị kẹt. */
const USER = "0b1f7a2c-0000-4000-8000-00000000l009";

function item(n: number): OutboxItem {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, userId: USER, conversationId: "c-loi09", content: `tin ${n}`,
    replyToMessageId: null, mentionedUserIds: [], refs: [], originGroupId: null, isUrgent: false, files: [],
    createdAt: new Date().toISOString(), seq: n, state: "queued", attempts: 0, lastError: null,
  };
}

function deleteDb(): Promise<"deleted" | "blocked"> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase("avora-outbox");
    request.onsuccess = () => resolve("deleted");
    request.onblocked = () => resolve("blocked");
    request.onerror = () => resolve("blocked");
  });
}

test("LOI-09.1 · 60 thao tác chỉ mở tối đa 1 kết nối", async () => {
  const open = vi.spyOn(indexedDB, "open");
  for (let n = 1; n <= 30; n += 1) await outboxStore.put(item(n));
  expect((await outboxStore.all(USER)).length).toBe(30);
  for (let n = 1; n <= 29; n += 1) await outboxStore.remove(item(n).id);
  expect(open.mock.calls.length).toBeLessThanOrEqual(1);
  open.mockRestore();
});

test("LOI-09.2 · xoá cơ sở dữ liệu không bị kẹt, lần sau tự mở lại", async () => {
  await outboxStore.put(item(100));
  expect(await deleteDb()).toBe("deleted");
  await outboxStore.put(item(101));
  const ids = (await outboxStore.all(USER)).map((entry) => entry.id);
  expect(ids).toContain(item(101).id);
  await outboxStore.clear();
});
