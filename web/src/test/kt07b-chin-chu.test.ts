import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { CONNECT_DIARY_VIEWS, readLastDiaryView, STUDY_NOTES_PATH } from "@/lib/diary-views";
import { CASH_WALLET_NAME, quickExpenseAccount } from "@/lib/finance-quick";
import type { Account } from "@/lib/finance";
import { SETTINGS_TABS } from "@/lib/navigation";
import { settingsGroups } from "@/lib/settings-groups";

const src = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("KT-07b · 2 — Nhật ký chỉ ghi nhanh; Sổ ghi chép là lối sang Thư phòng", () => {
  it("Sổ ghi chép đứng cuối danh sách Kết nối › Nhật ký và dẫn sang Thư phòng › Ghi chép", () => {
    expect(CONNECT_DIARY_VIEWS.map((view) => view.id)).toEqual(["journal", "files", "links", "sources", "notes"]);
    expect(STUDY_NOTES_PATH).toBe("/ke-hoach?ke=5&phan=ghi");
    expect(src("components/chat/DiaryViews.tsx")).toContain("STUDY_NOTES_PATH");
  });
  it("Nhật ký không tự mở vào Sổ ghi chép", () => {
    const store = new Map<string, string>([["avora.diary.lastView", "ghi-chep"]]);
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: () => undefined } });
    expect(readLastDiaryView()).toBe("journal");
    store.set("avora.diary.lastView", "lien-ket");
    expect(readLastDiaryView()).toBe("links");
    store.clear();
    expect(readLastDiaryView()).toBe("journal");
    vi.unstubAllGlobals();
  });
});

describe("KT-07b · 3 — Cài đặt dạng danh sách nhóm", () => {
  it("mọi mục Cài đặt nằm trong đúng một nhóm, theo thứ tự nhóm kiểu iOS", () => {
    const groups = settingsGroups(SETTINGS_TABS);
    expect(groups.map((group) => group.title)).toEqual(["Tài khoản", "Giao diện & thông báo", "Dữ liệu & dung lượng", "Trợ giúp & góp ý"]);
    expect(groups.flatMap((group) => group.items.map((item) => item.to)).sort()).toEqual(SETTINGS_TABS.map((tab) => tab.to).sort());
  });
  it("mục bị tắt không để lại nhóm rỗng", () => {
    expect(settingsGroups(SETTINGS_TABS.filter((tab) => tab.to !== "/cai-dat/dung-luong" && tab.to !== "/cai-dat/avora-ai")).map((g) => g.title)).not.toContain("Dữ liệu & dung lượng");
  });
});

describe("KT-07b · 4 — Kết nối › Dự án chỉ hiện dự án", () => {
  it("không còn Danh sách bảng / bảng trong tab Dự án", () => {
    const code = src("components/projects/ProjectList.tsx");
    expect(code).not.toContain("TABLE_LAYERS");
    expect(code).not.toContain("useThinkTables");
  });
});

describe("KT-07b · 5 — một chip Hạn, Hiện diện ở tầng Mở rộng thứ hai", () => {
  it("tấm tạo nhanh không còn chip Hôm nay riêng", () => {
    const code = src("components/tasks/TaskCard.tsx");
    expect(code).toContain("`Hạn: ${dateLabel}`");
    expect(code).not.toMatch(/label="Hôm nay"\s*\n\s*isActive=\{draft\.myDay\}/);
    expect(code).toContain("data-card-more-presence");
  });
});

describe("KT-07b · 6 — ví Tiền mặt cho khoản chi đầu tiên", () => {
  const account = (over: Partial<Account>): Account => ({ id: "a", name: "A", type: "checking", currency: "VND", deletedAt: null, ...over } as Account);
  it("ưu tiên ví tiền mặt đang mở, rồi tài khoản không phải nợ; không có thì null (sẽ tạo Tiền mặt)", () => {
    expect(quickExpenseAccount([])).toBeNull();
    expect(quickExpenseAccount([account({ id: "card", type: "credit_card" })])).toBeNull();
    expect(quickExpenseAccount([account({ id: "bank" }), account({ id: "cash", type: "cash" })])?.id).toBe("cash");
    expect(CASH_WALLET_NAME).toBe("Tiền mặt");
  });
});

describe("KT-07b · 9 — tiêu đề khối 15px", () => {
  it("tiêu đề khối ở Cài đặt và các thẻ cài đặt không còn 16–18px", () => {
    for (const path of ["pages/Profile.tsx", "pages/SettingsPreferences.tsx", "pages/SettingsNotifications.tsx", "pages/SettingsGuide.tsx", "pages/SettingsFeedback.tsx", "components/PushSettingsCard.tsx", "components/chat/MuteSettingsCard.tsx", "pages/Tasks.tsx", "pages/FinanceReports.tsx"]) {
      expect(src(path)).not.toMatch(/<h[23][^>]*text-\[(16|17|18)px\]/);
    }
  });
});

describe("KT-07b · 8 — Thông báo nói kiểu 'Bạn muốn…'", () => {
  it("không còn câu thuật ngữ cũ", () => {
    const page = src("pages/SettingsNotifications.tsx");
    expect(page).toContain("Bạn muốn yên tĩnh một lúc?");
    expect(page).not.toContain("Yên lặng hoặc Ngắt kết nối");
    expect(page).not.toContain("Mở nhanh: giữ tab Kết nối");
    expect(src("components/chat/MuteSettingsCard.tsx")).toContain("Bạn muốn tắt thông báo một thời gian?");
    expect(src("components/PushSettingsCard.tsx")).toContain("Bạn muốn nhận thông báo cả khi đã đóng AVORA?");
  });
});

describe("KT-07b · 10 — Nhìn lại hôm nay dưới lời chào", () => {
  it("dòng Nhìn lại nằm sau khối chào, có chỗ giữ sẵn", () => {
    const code = src("pages/Dashboard.tsx");
    expect(code.indexOf("<ReviewPrompt")).toBeGreaterThan(code.indexOf("SPACE_BLOCK_ORDER.map"));
    expect(code).toContain("data-review-slot");
  });
});
