import { describe, expect, it } from "vitest";

import {
  activeNavEntry,
  activeSectionTab,
  APP_MAP_UPCOMING,
  canGoBackInApp,
  logoAction,
  hidesToolBelt,
  HOME_ROUTE,
  LOGO_HOLD_MS,
  TOOL_BELT_ITEMS,
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
      "Kết nối",
      "Nhiệm vụ",
      "Kế hoạch",
      "Két sắt",
      "Cài đặt",
    ]);
  });

  /**
   * Think Hub sits among the screens where work gets done, not beside the one that keeps
   * things safe. Két sắt and Cài đặt stay last because they are where someone goes
   * occasionally, not where they spend a working day.
   */
  it("puts Think Hub with the doing screens, above Két sắt", () => {
    const labels = NAV_ITEMS.map((item) => item.label);
    expect(labels.indexOf("Kế hoạch")).toBeGreaterThan(labels.indexOf("Nhiệm vụ"));
    expect(labels.indexOf("Kế hoạch")).toBeLessThan(labels.indexOf("Két sắt"));
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
      "Tuỳ chọn chung",
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

describe("native-style navigation (AVORA 30)", () => {
  it("puts exactly the five Hubs in the phone's tool-belt, without Avora Space", () => {
    expect(TOOL_BELT_ITEMS.map((item) => item.label)).toEqual(["Kết nối", "Nhiệm vụ", "Kế hoạch", "Két sắt", "Cài đặt"]);
    expect(TOOL_BELT_ITEMS.some((item) => item.to === HOME_ROUTE)).toBe(false);
  });

  it("names Donation at the end of the full map, with no route behind it", () => {
    expect(APP_MAP_UPCOMING.map((entry) => entry.label)).toEqual(["Donation"]);
    expect(NAV_ITEMS.some((item) => item.label === "Donation")).toBe(false);
  });

  it("tells which destination owns a path, deepest first", () => {
    expect(activeNavEntry("/ket-sat/mat-khau")?.label).toBe("Két sắt");
    expect(activeNavEntry("/tin-nhan/abc")?.label).toBe("Kết nối");
    expect(activeNavEntry("/tong-quan")?.label).toBe("Avora Space");
    expect(activeNavEntry("/du-an/x")).toBeNull();
  });

  it("steps the tool-belt aside only inside an open conversation", () => {
    expect(hidesToolBelt("/tin-nhan/abc")).toBe(true);
    expect(hidesToolBelt("/tin-nhan")).toBe(false);
    expect(hidesToolBelt("/nhiem-vu")).toBe(false);
  });

  it("waits long enough that a tap on the logo is never read as a hold", () => {
    expect(LOGO_HOLD_MS).toBeGreaterThanOrEqual(350);
  });
});

describe("the logo steps back from Avora Space (AVORA 31)", () => {
  it("goes home from any other screen, whatever the history holds", () => {
    expect(logoAction("/nhiem-vu", { idx: 0 })).toBe("home");
    expect(logoAction("/tin-nhan/abc", null)).toBe("home");
  });

  it("steps back from Avora Space only when the previous screen is inside AVORA", () => {
    expect(logoAction(HOME_ROUTE, { idx: 3 })).toBe("back");
    expect(logoAction(HOME_ROUTE, { idx: 0 })).toBe("stay");
    expect(logoAction(HOME_ROUTE, null)).toBe("stay");
    expect(logoAction(HOME_ROUTE, { usr: null })).toBe("stay");
  });

  it("reads only the router's own position stamp", () => {
    expect(canGoBackInApp({ idx: 1 })).toBe(true);
    expect(canGoBackInApp({ idx: "2" })).toBe(false);
    expect(canGoBackInApp(undefined)).toBe(false);
  });
});
