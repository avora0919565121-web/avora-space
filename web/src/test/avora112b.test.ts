import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  FEATURE_KEYS,
  readCachedFeatures,
  routeFeature,
  statusOf,
  toFeatureMap,
  versionBelow,
  writeCachedFeatures,
  type FeatureRow,
} from "@/lib/features";

const row = (key: string, status: FeatureRow["status"], minAppVersion: string | null = null): FeatureRow => ({ key, status, minAppVersion, note: null, updatedAt: null });

describe("AVORA-112-B · công tắc tính năng", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    });
  });

  test("khoá chưa biết hoặc chưa đọc được = stable", () => {
    expect(statusOf(undefined, "habits")).toBe("stable");
    expect(statusOf({}, "habits")).toBe("stable");
    expect(statusOf({ habits: "soon" }, "habits")).toBe("soon");
  });

  test("bản app cũ hơn min_app_version không hiện tính năng", () => {
    expect(versionBelow("1.2", "1.10")).toBe(true);
    expect(versionBelow("1.12.0", "1.12")).toBe(false);
    expect(toFeatureMap([row("books", "stable", "9.0")], "1.12.0").books).toBe("hidden");
    expect(toFeatureMap([row("books", "soon", "1.0")], "1.12.0").books).toBe("soon");
  });

  test("bản lưu đệm: ghi rồi đọc lại; dữ liệu hỏng bị bỏ qua", () => {
    writeCachedFeatures({ habits: "hidden", books: "soon" });
    expect(readCachedFeatures()).toEqual({ habits: "hidden", books: "soon" });
    localStorage.setItem("avora.features.v1", '{"habits":"gone","books":"soon"}');
    expect(readCachedFeatures()).toEqual({ books: "soon" });
    localStorage.setItem("avora.features.v1", "{");
    expect(readCachedFeatures()).toBeUndefined();
  });

  test("tuyến thuộc tính năng nào (sâu nhất thắng)", () => {
    expect(routeFeature("/ket-sat/mat-khau")).toBe("vault_passwords");
    expect(routeFeature("/ket-sat/giao-dich")).toBe("finance");
    expect(routeFeature("/ke-hoach/ke-sach/doc/r1")).toBe("books");
    expect(routeFeature("/ke-hoach")).toBe("think_hub");
    expect(routeFeature("/tong-quan")).toBeNull();
    expect(routeFeature("/cai-dat")).toBeNull();
  });

  test("khoá trong mã khớp khoá đã gieo ở migration", async () => {
    const sql = (await import("../../../supabase/migrations/20261014100000_avora112b_feature_flags.sql?raw")).default;
    const seeded = [...sql.matchAll(/\('([a-z_]+)', 'stable', '/g)].map((match) => match[1]).sort();
    expect(seeded).toEqual(FEATURE_KEYS.map((entry) => entry.key).sort());
  });
});
