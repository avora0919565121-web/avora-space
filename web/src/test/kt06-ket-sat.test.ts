import { beforeEach, describe, expect, it, vi } from "vitest";

// KT-06 · A (QA01-08) + B (QA03-04). The supabase client is a stub whose rpc answers per test.
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import { deviceNonce } from "@/lib/device";
import { knownAtLine, lastKnown, setLastKnownStore, webLastKnownStore, type LastKnownStore } from "@/lib/last-known";
import { ledgerUnavailable } from "@/lib/use-finance";
import { isFinancePath } from "@/lib/use-vault-lock";
import { enterVault } from "@/lib/vault-api";

// Node: a tiny localStorage (the unit suite runs without a DOM).
class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
  keys(): string[] { return [...this.map.keys()]; }
}
const storage = new MemoryStorage();
(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window ??= { localStorage: storage };

const STATUS = { has_code: false, has_data: true, unlocked: false, expires_at: null, locked_until: null, remaining: 5, device_allowed: true, device_bound: true };

beforeEach(() => {
  rpc.mockReset();
  window.localStorage.clear();
  setLastKnownStore(webLastKnownStore);
});

describe("KT-06 · A — vault_enter: một lời gọi", () => {
  it("gửi khoá + máy trong cùng một lời gọi và đọc device_proven", async () => {
    rpc.mockResolvedValue({ data: { ...STATUS, device_proven: true }, error: null });
    const out = await enterVault("11111111-1111-1111-1111-111111111111", true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("vault_enter", { p_device_id: "11111111-1111-1111-1111-111111111111", p_lock: true });
    expect(out?.deviceProven).toBe(true);
    expect(out?.status.hasCode).toBe(false);
  });

  it("device_proven thiếu hoặc sai kiểu → coi là CHƯA chứng minh (app sẽ ký lại)", async () => {
    rpc.mockResolvedValue({ data: { ...STATUS, device_proven: "true" }, error: null });
    expect((await enterVault(null, false))?.deviceProven).toBe(false);
  });

  it("máy chủ cũ chưa có vault_enter → null (đi đường cũ), lỗi khác vẫn báo", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    expect(await enterVault(null, true)).toBeNull();
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await enterVault(null, true)).toBeNull();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "avora_session_not_allowed" } });
    await expect(enterVault(null, true)).rejects.toThrow("Phiên này không còn được dùng.");
  });

  it("dữ liệu méo không bao giờ đọc thành 'đang mở'", async () => {
    rpc.mockResolvedValue({ data: { has_code: true, unlocked: "yes" }, error: null });
    expect((await enterVault(null, false))?.status.unlocked).toBe(false);
  });
});

describe("KT-06 · A — device_session: chỉ ký khi máy chủ xin", () => {
  it("phiên đã chứng minh trong hạn → không xin nonce, không gọi device_challenge", async () => {
    rpc.mockResolvedValue({ data: { proven: true, nonce: null }, error: null });
    expect(await deviceNonce("d")).toEqual({ proven: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("device_session");
  });

  it("chưa chứng minh → nonce đi kèm ngay trong câu trả lời", async () => {
    rpc.mockResolvedValue({ data: { proven: false, nonce: "bm9uY2U=" }, error: null });
    expect(await deviceNonce("d")).toEqual({ proven: false, nonce: "bm9uY2U=" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("máy chủ cũ → device_challenge như trước", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "missing" } });
    rpc.mockResolvedValueOnce({ data: "Y2hhbGxlbmdl", error: null });
    expect(await deviceNonce("d")).toEqual({ proven: false, nonce: "Y2hhbGxlbmdl" });
    expect(rpc.mock.calls[1][0]).toBe("device_challenge");
  });

  it("lỗi thật (bị chặn, quá nhiều nonce) → ném lỗi, không coi là đã chứng minh", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "avora_device_rate" } });
    await expect(deviceNonce("d")).rejects.toThrow("avora_device_rate");
  });
});

describe("KT-06 · A — đường dẫn Tài chính (tải trước)", () => {
  it("chỉ 4 trang Tài chính, không phải các ngăn mã hoá", () => {
    for (const path of ["/ket-sat", "/ket-sat/", "/ket-sat/giao-dich", "/ket-sat/tai-khoan", "/ket-sat/bao-cao"]) expect(isFinancePath(path)).toBe(true);
    for (const path of ["/ket-sat/mat-khau", "/ket-sat/tai-san", "/ket-sat/tai-lieu", "/ket-sat/chung-chi", "/tong-quan"]) expect(isFinancePath(path)).toBe(false);
  });
});

describe("KT-06 · B — sổ không có dữ liệu thì không phải 0", () => {
  const q = (data: unknown, fetchStatus: "fetching" | "paused" | "idle", isError = false) => ({ data, fetchStatus, isError });
  it("mất mạng trước lần đọc đầu → không tải được (không phải sổ trống)", () => {
    expect(ledgerUnavailable([q(undefined, "paused"), q(undefined, "paused"), q(undefined, "paused")])).toBe(true);
  });
  it("đọc lỗi → không tải được", () => {
    expect(ledgerUnavailable([q([], "idle"), q(undefined, "idle", true), q([], "idle")])).toBe(true);
  });
  it("lần đọc đầu đang chạy → chưa phải 'không tải được'", () => {
    expect(ledgerUnavailable([q(undefined, "fetching"), q(undefined, "fetching"), q([], "idle")])).toBe(false);
  });
  it("mạng chết nhưng máy vẫn báo có mạng: đã hỏng một lần, đang thử lại → không tải được (không chờ ~35 s)", () => {
    expect(ledgerUnavailable([{ data: undefined, fetchStatus: "fetching", isError: false, failureCount: 1 }, q([], "idle"), q([], "idle")])).toBe(true);
  });
  it("đã có dữ liệu (kể cả khi mất mạng) → dùng dữ liệu đó", () => {
    expect(ledgerUnavailable([q([], "paused"), q([], "paused"), q([], "paused")])).toBe(false);
  });
});

describe("KT-06 · B — lớp ghi nhớ số liệu gần nhất", () => {
  it("get/set theo user, có thời điểm; user khác không thấy", async () => {
    await lastKnown.set("u1", "finance.accounts.totals", { assetsCents: 45_500_000 });
    const got = await lastKnown.get<{ assetsCents: number }>("u1", "finance.accounts.totals");
    expect(got?.value.assetsCents).toBe(45_500_000);
    expect(typeof got?.at).toBe("number");
    expect(await lastKnown.get("u2", "finance.accounts.totals")).toBeNull();
  });

  it("đăng xuất (clearAll) xoá hết; clearUser chỉ xoá một người", async () => {
    await lastKnown.set("u1", "a", 1);
    await lastKnown.set("u2", "a", 2);
    await lastKnown.clearUser("u1");
    expect(await lastKnown.get("u1", "a")).toBeNull();
    expect((await lastKnown.get<number>("u2", "a"))?.value).toBe(2);
    await lastKnown.clearAll();
    expect(await lastKnown.get("u2", "a")).toBeNull();
    expect(storage.keys().filter((k) => k.startsWith("avora.last-known"))).toEqual([]);
  });

  it("thay được bằng bộ lưu khác (bản native mã hoá) mà không đổi màn hình", async () => {
    const memory = new Map<string, { value: unknown; at: number }>();
    const native: LastKnownStore = {
      get: async (u, k) => (memory.get(`${u}/${k}`) as never) ?? null,
      set: async (u, k, v) => void memory.set(`${u}/${k}`, { value: v, at: 1 }),
      clearUser: async () => memory.clear(),
      clearAll: async () => memory.clear(),
    };
    setLastKnownStore(native);
    await lastKnown.set("u1", "x", 7);
    expect(memory.size).toBe(1);
    expect(window.localStorage.length).toBe(0);
    expect((await lastKnown.get<number>("u1", "x"))?.value).toBe(7);
  });

  it("dữ liệu hỏng đọc như 'không biết', không ném lỗi", async () => {
    window.localStorage.setItem("avora.last-known.v1:u1:k", "{không phải json");
    expect(await lastKnown.get("u1", "k")).toBeNull();
  });

  it("nhãn thời điểm: hôm nay chỉ giờ, ngày khác thêm ngày", () => {
    const now = new Date(2026, 10, 12, 23, 50).getTime();
    expect(knownAtLine(new Date(2026, 10, 12, 14, 5).getTime(), now)).toBe("cập nhật lúc 14:05");
    expect(knownAtLine(new Date(2026, 10, 11, 9, 0).getTime(), now)).toBe("cập nhật lúc 09:00 · 11/11");
  });
});
