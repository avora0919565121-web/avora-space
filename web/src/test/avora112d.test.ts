import { beforeEach, describe, expect, test, vi } from "vitest";

const reply: { data: unknown; error: unknown } = { data: null, error: null };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => reply }) }) }),
  },
}));

import { cachedRealtimeMode, parseRealtimeMode, readRealtimeMode } from "@/lib/realtime-mode";

describe("112-D · chế độ realtime và đường lui", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  });

  test("mặc định broadcast; chỉ 'legacy' mới về đường cũ", () => {
    expect(parseRealtimeMode("legacy")).toBe("legacy");
    expect(parseRealtimeMode("broadcast")).toBe("broadcast");
    expect(parseRealtimeMode(null)).toBe("broadcast");
    expect(cachedRealtimeMode()).toBe("broadcast");
  });

  test("đọc từ app_config, nhớ trên máy; mất mạng thì dùng bản đã nhớ", async () => {
    reply.data = { value: "legacy" };
    reply.error = null;
    expect(await readRealtimeMode()).toBe("legacy");
    reply.data = null;
    reply.error = { message: "TypeError: Failed to fetch" };
    expect(await readRealtimeMode()).toBe("legacy");
    reply.data = { value: "broadcast" };
    reply.error = null;
    expect(await readRealtimeMode()).toBe("broadcast");
  });
});
