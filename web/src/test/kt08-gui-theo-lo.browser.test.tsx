import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

// KT-08 · QA04-07: the outbox sends queued plain words in batches (≤ 5), in order; "too fast" waits, no attempt lost.
const state = vi.hoisted(() => ({ calls: [] as string[][], singles: [] as string[], limitOnce: true }));
vi.mock("@/lib/chat", async () => {
  const actual = await vi.importActual<typeof import("@/lib/chat")>("@/lib/chat");
  return {
    ...actual,
    sendMessage: async (conversationId: string, senderId: string, content: string, ...rest: unknown[]) => {
      const id = rest[6] as string;
      state.singles.push(id);
      return { id, conversationId, senderId, content, createdAt: new Date().toISOString() };
    },
    sendMessages: async (items: { id: string; conversationId: string; content: string }[]) => {
      state.calls.push(items.map((item) => item.id));
      // The server's 5-a-second limit stops the 3rd of the first batch once.
      const cut = state.limitOnce ? 2 : items.length;
      state.limitOnce = false;
      const sent = items.slice(0, cut).map((item) => ({ id: item.id, conversationId: item.conversationId, senderId: "u-k8", content: item.content, createdAt: new Date().toISOString() }));
      return cut < items.length ? { sent, failedId: items[cut].id, error: "avora_rate_limited" } : { sent, failedId: null, error: null };
    },
  };
});

test("KT-08 · QA04-07: 7 tin chờ → gửi theo lô ≤ 5, đúng thứ tự, bị 'quá nhanh' thì chờ rồi đi tiếp, không trùng", async () => {
  const { outboxStore } = await import("@/lib/outbox");
  const { useOutboxRunner } = await import("@/lib/use-outbox");
  const base = {
    userId: "u-k8", conversationId: "c-k8", replyToMessageId: null, mentionedUserIds: [], refs: [], originGroupId: null,
    isUrgent: false, files: [], createdAt: new Date().toISOString(), attempts: 0, lastError: null, state: "queued" as const,
  };
  for (let i = 1; i <= 7; i++) await outboxStore.put({ ...base, id: `k8-${i}`, content: `tin ${i}`, seq: 100 + i });
  function Runner() {
    useOutboxRunner("u-k8");
    return null;
  }
  const started = Date.now();
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <Runner />
    </QueryClientProvider>,
  );
  await vi.waitFor(async () => expect(await outboxStore.all("u-k8")).toEqual([]), { timeout: 8000 });
  expect(state.singles).toEqual([]);
  expect(state.calls[0]).toEqual(["k8-1", "k8-2", "k8-3", "k8-4", "k8-5"]);
  expect(state.calls.every((call) => call.length <= 5)).toBe(true);
  // Every id went exactly once, in order.
  const went = state.calls.flatMap((call, index) => (index === 0 ? call.slice(0, 2) : call));
  expect(went).toEqual(["k8-1", "k8-2", "k8-3", "k8-4", "k8-5", "k8-6", "k8-7"]);
  // "Too fast" waited about a second, not the 1–2–4 s back-off of a failure.
  expect(Date.now() - started).toBeLessThan(4000);
});
