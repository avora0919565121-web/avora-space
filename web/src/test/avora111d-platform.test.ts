import { afterEach, describe, expect, it, vi } from "vitest";

import { GUIDE_CARDS } from "@/lib/guide-content";
import { POLICY_DOCS, visiblePolicyItems } from "@/lib/policy-content";

/* 111-D · cờ nền tảng: bản native không hiện Donation, gói trả phí, giá, link thanh toán ngoài. */
const MONEY = /(ủng hộ|donat|cà phê|coffee|\bpro\b|standard|business plan|bảng giá|trả phí|thu phí|thanh toán|đ\/tháng|\/tháng|vnđ|\bvnd\b|miễn phí năm đầu)/i;

function fakeWindow(capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string }, search = ""): void {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    Capacitor: capacitor,
    location: { search },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("111-D · platform.ts", () => {
  it("trình duyệt thường: web, được hiện thanh toán", async () => {
    fakeWindow();
    const p = await import("@/lib/platform");
    expect(p.isNativeShell()).toBe(false);
    expect(p.platformName()).toBe("web");
    expect(p.canShowPayments()).toBe(true);
  });
  it("Capacitor iOS: native, không hiện thanh toán", async () => {
    fakeWindow({ isNativePlatform: () => true, getPlatform: () => "ios" });
    const p = await import("@/lib/platform");
    expect(p.isNativeShell()).toBe(true);
    expect(p.platformName()).toBe("ios");
    expect(p.canShowPayments()).toBe(false);
  });
  it("Capacitor Android", async () => {
    fakeWindow({ isNativePlatform: () => true, getPlatform: () => "android" });
    expect((await import("@/lib/platform")).platformName()).toBe("android");
  });
  it("?shell=native chỉ ở bản thử: bật được và giữ qua lần đọc sau", async () => {
    fakeWindow(undefined, "?shell=native");
    const p = await import("@/lib/platform");
    expect(p.isNativeShell()).toBe(true);
    (window as unknown as { location: { search: string } }).location.search = "";
    expect(p.isNativeShell()).toBe(true);
  });
});

describe("111-D · mọi câu nhắc tiền đều được đánh dấu", () => {
  it("Chính sách: câu nào nhắc tiền đều có payments, và bị lọc khi native", () => {
    for (const doc of POLICY_DOCS) {
      for (const section of doc.sections) {
        for (const item of section.items) {
          if (MONEY.test(item.text)) expect(item.payments, `${doc.id}/${item.id}`).toBe(true);
        }
        expect(visiblePolicyItems(section.items, false).some((item) => MONEY.test(item.text))).toBe(false);
      }
    }
  });
  it("Hướng dẫn sử dụng: không có câu nhắc tiền", () => {
    expect(MONEY.test(JSON.stringify(GUIDE_CARDS))).toBe(false);
  });
});
