/**
 * Lỗi 01/11 · bão làm mới phiên. Máy chủ trả `expires_at` theo đồng hồ của máy chủ; supabase-js
 * so con số đó với `Date.now()` của thiết bị. Thiết bị chạy nhanh gần một giờ thì mọi lần đọc
 * phiên đều thấy phiên "sắp hết hạn" → làm mới liên tục → máy chủ trả 429 → phiên bị xoá →
 * người dùng bị đăng xuất.
 *
 * Cách sửa: mỗi phản hồi cấp phiên có `expires_in` (số giây còn hiệu lực, không phụ thuộc đồng
 * hồ). Ta viết lại `expires_at` = giờ thiết bị lúc nhận + `expires_in`, nên mọi phép so hạn của
 * supabase-js chạy trên cùng một đồng hồ, dù đồng hồ thiết bị lệch bao nhiêu.
 */

type SessionLike = { access_token?: unknown; expires_in?: unknown; expires_at?: unknown };

/** Rewrites `expires_at` into the device clock's frame. Returns null when nothing changes. */
export function toDeviceFrame<T extends SessionLike>(body: T, deviceNowMs: number): T | null {
  if (!body || typeof body !== "object") return null;
  if (typeof body.access_token !== "string") return null;
  const expiresIn = body.expires_in;
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  const deviceExpiresAt = Math.round(deviceNowMs / 1000) + Math.floor(expiresIn);
  if (body.expires_at === deviceExpiresAt) return null;
  return { ...body, expires_at: deviceExpiresAt };
}

function isAuthSessionUrl(url: string): boolean {
  return /\/auth\/v1\/(token|verify|signup|otp|callback)(\?|$)/.test(url);
}

/** A fetch for supabase-js that keeps session expiry on the device clock. */
export function makeClockSafeFetch(base: typeof fetch = (input, init) => fetch(input, init)): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!res.ok || !isAuthSessionUrl(url)) return res;
    const receivedAt = Date.now();
    try {
      const body = (await res.clone().json()) as SessionLike;
      const fixed = toDeviceFrame(body, receivedAt);
      if (!fixed) return res;
      const headers = new Headers(res.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return new Response(JSON.stringify(fixed), { status: res.status, statusText: res.statusText, headers });
    } catch {
      return res;
    }
  };
}

/**
 * A stored session can never have more life left than `expires_in`. One that claims more was saved
 * before this fix with a server-clock `expires_at` on a device running behind: mark it due now so
 * supabase-js refreshes once and the new session lands in the device frame.
 */
export function clampStoredSession(raw: string | null, deviceNowMs: number): string | null {
  if (!raw) return raw;
  try {
    const s = JSON.parse(raw) as SessionLike;
    if (typeof s?.expires_at !== "number" || typeof s.expires_in !== "number") return raw;
    const leftS = s.expires_at - deviceNowMs / 1000;
    if (leftS <= s.expires_in + 60) return raw;
    return JSON.stringify({ ...s, expires_at: Math.floor(deviceNowMs / 1000) });
  } catch {
    return raw;
  }
}
