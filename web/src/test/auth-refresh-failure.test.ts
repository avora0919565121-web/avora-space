import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeClockSafeFetch } from "@/lib/auth-clock";

/**
 * 112-G · lưu ý 1 (đợt sửa 01/11): lỗi 429 hoặc mất mạng khi làm mới phiên không được xoá phiên.
 * Chỉ đăng xuất khi máy chủ nói phiên không hợp lệ (refresh token sai / bị thu hồi).
 *
 * Dùng supabase-js thật với một máy chủ Auth giả, phiên trong kho đã hết hạn access token
 * (trường hợp nặng nhất: supabase-js chỉ còn refresh token để dựa vào).
 */
const KEY = "sb-test-auth-token";
const URL = "https://test.supabase.co";

function memoryStorage(initial: Record<string, string>) {
  const m = new Map(Object.entries(initial));
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

function expiredSession() {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    access_token: "old-access",
    refresh_token: "old-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now - 120,
    user: { id: "00000000-0000-0000-0000-0000000000aa", aud: "authenticated", role: "authenticated", email: "testera@avora.test" },
  });
}

type Reply = () => Response | Promise<Response>;

function setup(reply: Reply) {
  const storage = memoryStorage({ [KEY]: expiredSession() });
  const calls: number[] = [];
  const base = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof globalThis.URL ? input.href : input.url;
    if (url.includes("/auth/v1/token")) {
      calls.push(Date.now());
      return reply();
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = createClient(URL, "anon", {
    auth: { storageKey: KEY, storage, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
    global: { fetch: makeClockSafeFetch(base) },
  });
  return { client, storage, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function settle(p: Promise<unknown>) {
  // supabase-js thử lại với giãn cách 200, 400, 800… ms trong một nhịp 30 s.
  for (let i = 0; i < 80; i++) await vi.advanceTimersByTimeAsync(1000);
  return p;
}

describe("làm mới phiên thất bại", () => {
  afterEach(() => vi.useRealTimers());

  it("máy chủ trả 429: phiên vẫn còn, thử lại có giãn cách", async () => {
    vi.useFakeTimers();
    const { client, storage, calls } = setup(() => json(429, { code: "over_request_rate_limit", msg: "Request rate limit reached" }));
    await settle(client.auth.getSession());
    expect(storage.map.has(KEY)).toBe(true);
    expect(calls.length).toBeGreaterThan(1);
    const gaps = calls.slice(1).map((t, i) => t - calls[i]);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
    expect(calls.length).toBeLessThan(10);
  });

  it("mất mạng khi làm mới: phiên vẫn còn", async () => {
    vi.useFakeTimers();
    const { client, storage, calls } = setup(() => {
      throw new TypeError("Failed to fetch");
    });
    await settle(client.auth.getSession());
    expect(storage.map.has(KEY)).toBe(true);
    expect(calls.length).toBeGreaterThan(1);
  });

  it("429 rồi máy chủ hồi: nhận phiên mới, không đăng xuất", async () => {
    vi.useFakeTimers();
    let n = 0;
    const { client, storage } = setup(() =>
      ++n < 3
        ? json(429, { code: "over_request_rate_limit", msg: "Request rate limit reached" })
        : json(200, {
            access_token: "new-access",
            refresh_token: "new-refresh",
            token_type: "bearer",
            expires_in: 3600,
            expires_at: 1,
            user: { id: "00000000-0000-0000-0000-0000000000aa", aud: "authenticated", role: "authenticated" },
          }),
    );
    const res = (await settle(client.auth.getSession())) as Awaited<ReturnType<typeof client.auth.getSession>>;
    expect(res.data.session?.access_token).toBe("new-access");
    expect(JSON.parse(storage.map.get(KEY)!).refresh_token).toBe("new-refresh");
  });

  it("refresh token bị thu hồi (400 refresh_token_not_found): đăng xuất như cũ", async () => {
    vi.useFakeTimers();
    const { client, storage } = setup(() => json(400, { code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }));
    await settle(client.auth.getSession());
    expect(storage.map.has(KEY)).toBe(false);
  });
});
