import { describe, expect, it } from "vitest";

import {
  activeSectionTab,
  HOME_ROUTE,
  LEGACY_ROUTES,
  NAV_ITEMS,
  SETTINGS_TABS,
  VAULT_TABS,
  legacyTarget,
} from "@/lib/navigation";

describe("the main navigation", () => {
  it("offers exactly the six places, in order", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "Avora Space",
      "Tin nhắn",
      "Nhiệm vụ",
      "Business HUB",
      "Két sắt",
      "Cài đặt",
    ]);
  });

  /**
   * Business HUB sits among the screens where work gets done, not beside the one that keeps
   * things safe. Két sắt and Cài đặt stay last because they are where someone goes
   * occasionally, not where they spend a working day.
   */
  it("puts Business HUB with the doing screens, above Két sắt", () => {
    const labels = NAV_ITEMS.map((item) => item.label);
    expect(labels.indexOf("Business HUB")).toBeGreaterThan(labels.indexOf("Nhiệm vụ"));
    expect(labels.indexOf("Business HUB")).toBeLessThan(labels.indexOf("Két sắt"));
  });

  it("keeps the dashboard on the route it was published under", () => {
    expect(NAV_ITEMS[0].to).toBe("/tong-quan");
  });

  it("opens on Avora Space, not on the inbox", () => {
    // The philosophy of the product: you start on what you chose to work on, not on whoever
    // happened to write to you last. Other tabs remind with a badge instead.
    expect(HOME_ROUTE).toBe("/tong-quan");
    expect(HOME_ROUTE).not.toBe("/tin-nhan");
  });

  it("sends people home to the first place in the rail", () => {
    expect(HOME_ROUTE).toBe(NAV_ITEMS[0].to);
  });

  it("does not list Liên hệ: it opens from Tin nhắn instead", () => {
    expect(NAV_ITEMS.some((item) => item.to === "/lien-he")).toBe(false);
  });

  it("names no destination twice", () => {
    expect(new Set(NAV_ITEMS.map((item) => item.to)).size).toBe(NAV_ITEMS.length);
  });
});

describe("the sectioned screens", () => {
  it("opens Két sắt on the ledger, with the vault half beside it", () => {
    expect(VAULT_TABS.map((tab) => tab.label)).toEqual(["Tài chính", "Mật khẩu"]);
    expect(VAULT_TABS[0].to).toBe("/ket-sat");
  });

  it("opens Cài đặt on the profile, with the three sibling tabs beside it", () => {
    expect(SETTINGS_TABS.map((tab) => tab.label)).toEqual([
      "Hồ sơ",
      "Thiết lập",
      "Thông báo",
      "Avora AI",
    ]);
    expect(SETTINGS_TABS.map((tab) => tab.to)).toEqual([
      "/cai-dat",
      "/cai-dat/thiet-lap",
      "/cai-dat/thong-bao",
      "/cai-dat/avora-ai",
    ]);
  });

  it("keeps every finance sub-screen under the Tài chính tab", () => {
    for (const path of ["/ket-sat", "/ket-sat/giao-dich", "/ket-sat/tai-khoan", "/ket-sat/bao-cao"]) {
      expect(activeSectionTab(path, VAULT_TABS)).toBe("/ket-sat");
    }
  });

  it("hands the passwords route to its own tab, not to the ledger", () => {
    expect(activeSectionTab("/ket-sat/mat-khau", VAULT_TABS)).toBe("/ket-sat/mat-khau");
  });

  it("hands each Cài setting sub-route to its own tab", () => {
    expect(activeSectionTab("/cai-dat", SETTINGS_TABS)).toBe("/cai-dat");
    expect(activeSectionTab("/cai-dat/thiet-lap", SETTINGS_TABS)).toBe("/cai-dat/thiet-lap");
    expect(activeSectionTab("/cai-dat/thong-bao", SETTINGS_TABS)).toBe("/cai-dat/thong-bao");
    expect(activeSectionTab("/cai-dat/avora-ai", SETTINGS_TABS)).toBe("/cai-dat/avora-ai");
  });

  it("falls back to the first tab for a path the section does not own", () => {
    expect(activeSectionTab("/tin-nhan", VAULT_TABS)).toBe("/ket-sat");
  });
});

describe("links saved before the rename", () => {
  it("sends every renamed route to its new home", () => {
    expect(legacyTarget("/tai-chinh")).toBe("/ket-sat");
    expect(legacyTarget("/tai-chinh/giao-dich")).toBe("/ket-sat/giao-dich");
    expect(legacyTarget("/tai-chinh/tai-khoan")).toBe("/ket-sat/tai-khoan");
    expect(legacyTarget("/tai-chinh/bao-cao")).toBe("/ket-sat/bao-cao");
    expect(legacyTarget("/ho-so")).toBe("/cai-dat");
  });

  it("carries the query string across, so a filtered ledger link still filters", () => {
    expect(legacyTarget("/tai-chinh/giao-dich", "?thang=2026-09&tai_khoan=abc")).toBe(
      "/ket-sat/giao-dich?thang=2026-09&tai_khoan=abc",
    );
  });

  it("tolerates a trailing slash", () => {
    expect(legacyTarget("/tai-chinh/")).toBe("/ket-sat");
  });

  it("claims nothing it did not rename", () => {
    expect(legacyTarget("/tin-nhan")).toBeNull();
    expect(legacyTarget("/lien-he")).toBeNull();
    expect(legacyTarget("/tong-quan")).toBeNull();
    expect(legacyTarget("/")).toBeNull();
  });

  it("points every redirect at a route that exists now", () => {
    const live = new Set<string>([
      ...NAV_ITEMS.map((item) => item.to),
      ...VAULT_TABS.map((tab) => tab.to),
      ...SETTINGS_TABS.map((tab) => tab.to),
      "/ket-sat/giao-dich",
      "/ket-sat/tai-khoan",
      "/ket-sat/bao-cao",
      "/lien-he",
    ]);

    for (const target of Object.values(LEGACY_ROUTES)) {
      expect(live.has(target)).toBe(true);
    }
  });

  it("never redirects a route onto itself", () => {
    for (const [from, to] of Object.entries(LEGACY_ROUTES)) {
      expect(from).not.toBe(to);
    }
  });
});
