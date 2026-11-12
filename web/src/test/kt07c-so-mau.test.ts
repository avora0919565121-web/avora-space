import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { buildLedger, monthKey, postedEntries, totalsFor } from "@/lib/finance";
import { spendingTrend } from "@/lib/finance-reports";
import { buildSampleBook, isSampleId } from "@/lib/finance-sample";
import { incomeExpenseBars, trendFromFirstData } from "@/lib/finance-trend";
import { GUIDANCE_KEYS } from "@/lib/guidance";
import { financeBookMode } from "@/lib/use-finance-book";
import { sampleHiddenKey, vaultSamples } from "@/lib/vault-samples";
import { daysLeft } from "@/lib/vault-templates";

const src = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("KT-07c · sổ mẫu Tài chính (tĩnh trong app)", () => {
  for (const today of ["2026-11-01", "2026-11-15", "2026-11-30", "2027-03-02"]) {
    it(`mở ngày ${today}: 3 tháng, tháng này đủ mục, không có ngày tương lai`, () => {
      const book = buildSampleBook(today);
      expect(book.transactions.every((tx) => tx.date <= today)).toBe(true);
      expect(book.transactions.filter((tx) => monthKey(tx.date) === monthKey(today) && (tx.type === "income" || tx.type === "expense"))).toHaveLength(14);
      expect(book.accounts).toHaveLength(6);
      expect([...book.accounts, ...book.categories, ...book.transactions].every((row) => isSampleId(row.id))).toBe(true);
    });
  }
  it("số tháng M−2 khớp bảng SP-04 (thu 20,61 tr · chi 12,45 tr)", () => {
    const today = "2026-11-28";
    const book = buildSampleBook(today);
    const entries = postedEntries(buildLedger(book.transactions, book.accounts, book.categories));
    const m2 = totalsFor(entries.filter((entry) => monthKey(entry.date) === "2026-09"));
    expect(m2.incomeCents).toBe(20_610_000 * 100);
    expect(m2.expenseCents).toBe(12_450_000 * 100);
  });
  it("không có liên hệ mẫu nào: tên chỉ nằm trên dòng mẫu", () => {
    const book = buildSampleBook("2026-11-20");
    expect(book.transactions.every((tx) => tx.contactId === null)).toBe(true);
    expect(book.transactions.some((tx) => tx.description?.includes("Minh (mẫu)"))).toBe(true);
  });
  it("không bao giờ ghi vào máy chủ: không file API/ghi nào dùng sổ mẫu", () => {
    for (const path of ["lib/finance-api.ts", "lib/use-finance.ts", "lib/use-view-board-rows.ts", "lib/last-known.ts"]) {
      expect(src(path)).not.toContain("finance-sample");
    }
  });
});

describe("KT-07c · Sổ của tôi hay Sổ mẫu", () => {
  const real = (n: number, over: Partial<{ isLoading: boolean; isUnavailable: boolean }> = {}) => ({
    isLoading: false, isUnavailable: false, accounts: Array.from({ length: n }) as never[], allEntries: [] as never[], ...over,
  });
  it("sổ thật trống → mẫu; có dữ liệu → của tôi", () => {
    expect(financeBookMode({ chosen: null, hidden: false, real: real(0) })).toBe("sample");
    expect(financeBookMode({ chosen: null, hidden: false, real: real(1) })).toBe("mine");
  });
  it("đã ẩn, đang tải hoặc lỗi tải → không bao giờ mẫu", () => {
    expect(financeBookMode({ chosen: "sample", hidden: true, real: real(0) })).toBe("mine");
    expect(financeBookMode({ chosen: "sample", hidden: false, real: real(0, { isLoading: true }) })).toBe("mine");
    expect(financeBookMode({ chosen: "sample", hidden: false, real: real(0, { isUnavailable: true }) })).toBe("mine");
  });
  it("người dùng tự chọn thì theo lựa chọn", () => {
    expect(financeBookMode({ chosen: "mine", hidden: false, real: real(0) })).toBe("mine");
    expect(financeBookMode({ chosen: "sample", hidden: false, real: real(3) })).toBe("sample");
  });
  it("cờ ẩn nằm trong dismissed_guidance", () => {
    for (const section of ["finance", "passwords", "certificates", "documents", "assets"] as const) {
      expect(GUIDANCE_KEYS).toContain(sampleHiddenKey(section));
    }
  });
});

describe("KT-07c · biểu đồ A và B", () => {
  const book = buildSampleBook("2026-11-20");
  const entries = postedEntries(buildLedger(book.transactions, book.accounts, book.categories));
  const points = spendingTrend(entries, "2026-11", 12);
  it("B: không vẽ các tháng trống trước tháng có giao dịch đầu tiên", () => {
    expect(points).toHaveLength(12);
    expect(trendFromFirstData(points).map((point) => point.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(trendFromFirstData(spendingTrend([], "2026-11", 12))).toEqual([]);
  });
  it("A: thu–chi theo tháng kèm còn dư", () => {
    const bars = incomeExpenseBars(points);
    expect(bars[0]).toEqual(expect.objectContaining({ month: "2026-09", income: 20_610_000 * 100, expense: 12_450_000 * 100, left: 8_160_000 * 100 }));
  });
  it("Tổng quan có biểu đồ A", () => {
    expect(src("pages/Finance.tsx")).toContain("<IncomeExpenseChart");
  });
});

describe("KT-07c · mẫu 4 ngăn mã hoá", () => {
  const today = "2026-11-13";
  for (const section of ["passwords", "certificates", "documents", "assets"] as const) {
    it(`${section}: 4 mẫu, mỗi mẫu một loại, tên có "(mẫu)"`, () => {
      const list = vaultSamples(section, today);
      expect(list).toHaveLength(4);
      expect(new Set(list.map((item) => item.type)).size).toBe(4);
      expect(list.every((item) => item.title.endsWith("(mẫu)") && item.id.startsWith("sample:"))).toBe(true);
    });
  }
  it("ngày tính từ hôm nay: CCCD còn 75 ngày, BHYT còn 20 ngày", () => {
    const [cccd, , , bhyt] = vaultSamples("certificates", today);
    expect(daysLeft("certificates", cccd, new Date(2026, 10, 13))).toBe(75);
    expect(daysLeft("certificates", bhyt, new Date(2026, 10, 13))).toBe(20);
  });
  it("ngăn chưa có mã dùng bố cục bàn phím + mẫu; ngăn trống hiện mẫu", () => {
    expect(src("pages/Vault.tsx")).toContain("<VaultNoCode");
    expect(src("components/vault/VaultCompartment.tsx")).toContain("<VaultSampleList section={section} />");
    expect(src("components/vault/VaultSamples.tsx")).not.toContain("clipboard");
  });
});
