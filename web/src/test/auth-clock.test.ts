import { describe, expect, it } from "vitest";

import { clampStoredSession, makeClockSafeFetch, toDeviceFrame } from "@/lib/auth-clock";

/** Lỗi 01/11 · thiết bị lệch giờ gây bão làm mới phiên và tự đăng xuất. */
const SERVER_NOW = 1_793_500_000;

describe("toDeviceFrame", () => {
  it("đặt expires_at theo đồng hồ thiết bị dù thiết bị nhanh gần một giờ", () => {
    const body = { access_token: "a", expires_in: 3600, expires_at: SERVER_NOW + 3600 };
    const deviceNow = (SERVER_NOW + 3580) * 1000;
    expect(toDeviceFrame(body, deviceNow)?.expires_at).toBe(SERVER_NOW + 3580 + 3600);
  });
  it("không đụng phản hồi không phải phiên", () => {
    expect(toDeviceFrame({ expires_in: 3600 } as never, 0)).toBeNull();
    expect(toDeviceFrame({ access_token: "a" }, 0)).toBeNull();
  });
});

describe("clampStoredSession", () => {
  it("phiên cũ còn 'quá nhiều' thời gian (thiết bị chậm) bị đánh dấu đến hạn", () => {
    const raw = JSON.stringify({ access_token: "a", expires_in: 3600, expires_at: SERVER_NOW + 3600 });
    const out = JSON.parse(clampStoredSession(raw, (SERVER_NOW - 7200) * 1000)!);
    expect(out.expires_at).toBe(SERVER_NOW - 7200);
  });
  it("phiên bình thường và chuỗi không phải JSON giữ nguyên", () => {
    const raw = JSON.stringify({ access_token: "a", expires_in: 3600, expires_at: SERVER_NOW + 3600 });
    expect(clampStoredSession(raw, SERVER_NOW * 1000)).toBe(raw);
    expect(clampStoredSession("pkce-verifier", 0)).toBe("pkce-verifier");
    expect(clampStoredSession(null, 0)).toBeNull();
  });
});

describe("makeClockSafeFetch", () => {
  it("viết lại phản hồi /auth/v1/token, để nguyên các đường khác", async () => {
    const payload = { access_token: "a", refresh_token: "r", expires_in: 3600, expires_at: 1 };
    const base = (async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const f = makeClockSafeFetch(base);
    const before = Math.round(Date.now() / 1000);
    const fixed = await (await f("https://x.supabase.co/auth/v1/token?grant_type=refresh_token")).json();
    expect(fixed.expires_at).toBeGreaterThanOrEqual(before + 3600);
    expect(fixed.refresh_token).toBe("r");
    const other = await (await f("https://x.supabase.co/rest/v1/notes")).json();
    expect(other.expires_at).toBe(1);
  });
});
