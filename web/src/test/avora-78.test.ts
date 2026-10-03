import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  assignedByPerson,
  assignedRows,
  cashflowByMonth,
  DEFAULT_BOARDS,
  expiringRows,
  hiddenBoardsOf,
  isVaultViewBoard,
  loanRows,
  memorableDays,
  paymentRows,
  searchViewBoards,
  VIEW_BOARDS,
  type AssignedItem,
} from "@/lib/avora-default-boards";
import type { Account, LedgerEntry } from "@/lib/finance";

/*
 * AVORA-81 · PHẦN 1 (AVORA-78) — Bảng Avora lập sẵn: the registry and the pure computations behind
 * the ten view boards.
 */
const ACCOUNT: Account = { id: "a1", name: "Ví", type: "cash", openingBalanceCents: 0, balanceCents: 0, currency: "VND", otherPersonName: null, accountNumber: null, tags: [], createdAt: "", deletedAt: null };

function entry(part: Partial<LedgerEntry> & { id: string }): LedgerEntry {
  return {
    accountId: "a1",
    categoryId: null,
    type: "expense",
    amountCents: 0,
    currency: "VND",
    amountInBaseCents: null,
    baseCurrency: null,
    conversionRate: null,
    description: null,
    date: "2026-10-01",
    businessRelated: false,
    businessPurpose: null,
    receiptPath: null,
    isRecurring: false,
    recurringFrequency: null,
    recurringLabel: null,
    contactId: null,
    dueDate: null,
    status: "ke_hoach",
    settledCents: 0,
    taxPeriodStart: null,
    taxPeriodEnd: null,
    createdAt: "",
    deletedAt: null,
    account: ACCOUNT,
    category: null,
    ...part,
  } as LedgerEntry;
}

describe("78.1 · registry", () => {
  it("11 boards: 1 Bảng nối + 10 Bảng xem, each with a goal and an empty line", () => {
    expect(DEFAULT_BOARDS).toHaveLength(11);
    expect(DEFAULT_BOARDS.filter((b) => b.kind === "link").map((b) => b.key)).toEqual(["opportunities"]);
    expect(VIEW_BOARDS).toHaveLength(10);
    for (const board of VIEW_BOARDS) {
      expect(board.goal.endsWith("?")).toBe(true);
      expect(board.empty.startsWith("Dữ liệu vào đây khi")).toBe(true);
    }
    expect(VIEW_BOARDS.filter((b) => b.zone === "ket-sat").map((b) => b.key)).toEqual(["cashflow", "summary", "loans", "payment_calendar", "expiring_docs", "assets"]);
    expect(VIEW_BOARDS.filter((b) => b.zone === "nhiem-vu").map((b) => b.key)).toEqual(["assigned_by_me"]);
  });

  it("the migration accepts exactly the registry's view keys, and seals Két sắt notes", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261004100000_avora78_view_boards.sql"), "utf8");
    for (const board of VIEW_BOARDS) expect(sql).toContain(`'${board.key}'`);
    expect(sql).toContain("view_row_meta_vault_sealed");
    expect(sql).toMatch(/as restrictive for all to public/);
    expect(sql).toMatch(/revoke all on public\.think_hub_view_row_meta from public, anon/);
  });
});

describe("78.2 · Thu chi › Theo tháng", () => {
  it("3 entries over 2 months → 2 month lines with the right sums", () => {
    const months = cashflowByMonth([
      entry({ id: "t1", type: "income", amountCents: 10_000_000, date: "2026-09-05" }),
      entry({ id: "t2", type: "expense", amountCents: 3_000_000, date: "2026-09-20" }),
      entry({ id: "t3", type: "expense", amountCents: 1_500_000, date: "2026-10-02" }),
      entry({ id: "t4", type: "vay", amountCents: 99_000_000, date: "2026-10-02" }),
      entry({ id: "t5", type: "expense", amountCents: 5, date: "2026-10-02", deletedAt: "2026-10-02" }),
    ]);
    expect(months).toEqual([
      { month: "2026-10", inCents: 0, outCents: 1_500_000, diffCents: -1_500_000 },
      { month: "2026-09", inCents: 10_000_000, outCents: 3_000_000, diffCents: 7_000_000 },
    ]);
  });
});

describe("78.4 · search never finds a Két sắt board", () => {
  it("only Kết nối / Nhiệm vụ boards come back", () => {
    expect(searchViewBoards("tai chinh")).toEqual([]);
    expect(searchViewBoards("tai san")).toEqual([]);
    expect(searchViewBoards("so quyet dinh").map((b) => b.key)).toEqual(["decisions"]);
    expect(isVaultViewBoard("cashflow")).toBe(true);
    expect(isVaultViewBoard("decisions")).toBe(false);
  });
});

describe("78.5 · a loan due in 3 days", () => {
  const today = "2026-10-03";
  const loan = entry({ id: "l1", type: "vay", amountCents: 5_000_000, settledCents: 1_000_000, dueDate: "2026-10-06", contactId: "c1" });
  it("is on Vay & Cho vay, hot, with what is left", () => {
    const [row] = loanRows([loan], () => "Minh", today);
    expect(row.cells).toMatchObject({ title: "Minh", direction: "Tôi nợ", principal: 5_000_000, paid: 1_000_000, left: 4_000_000, date: "2026-10-06" });
    expect(row.hot).toBe(true);
  });
  it("and on Lịch thanh toán this month, hot", () => {
    const rows = paymentRows([loan], today, "this");
    expect(rows.map((r) => r.cells.date)).toEqual(["2026-10-06"]);
    expect(rows[0].cells).toMatchObject({ direction: "Trả", amount: 4_000_000, type: "Vay" });
    expect(rows[0].hot).toBe(true);
    expect(paymentRows([loan], today, "next")).toEqual([]);
  });
  it("recurring entries land on their next date inside the window", () => {
    const rent = entry({ id: "r1", type: "expense", amountCents: 7_000_000, date: "2026-08-15", isRecurring: true, recurringFrequency: "monthly", recurringLabel: "Tiền nhà" });
    expect(paymentRows([rent], today, "this").map((r) => [r.cells.date, r.cells.type])).toEqual([["2026-10-15", "Định kỳ"]]);
    expect(paymentRows([rent], today, "next").map((r) => r.cells.date)).toEqual(["2026-11-15"]);
  });
});

describe("78.6 · Việc tôi giao", () => {
  const items: AssignedItem[] = [
    { kind: "task", itemId: "t1", conversationId: "c", title: "Gửi báo giá", assigneeId: "b", assigneeName: "Bình", deadline: "2026-09-28", status: "confirmed", doneAt: null },
    { kind: "task", itemId: "t2", conversationId: "c", title: "Đặt phòng", assigneeId: "b", assigneeName: "Bình", deadline: "2026-09-20", status: "done", doneAt: "2026-09-19T00:00:00Z" },
    { kind: "suggestion", itemId: "s1", conversationId: "g", title: "Chốt menu", assigneeId: "l", assigneeName: "Lan", deadline: "2026-10-10", status: "pending", doneAt: null },
  ];
  it("late N days; Chờ nhận / Đang làm / Xong", () => {
    const rows = assignedRows(items, "2026-10-03");
    const late = rows.find((row) => row.key === "task:t1");
    expect(late?.cells.late).toBe("Trễ 5 ngày");
    expect(late?.hot).toBe(true);
    expect(rows.find((row) => row.key === "task:t2")?.cells.status).toBe("Xong");
    expect(rows.find((row) => row.key === "suggestion:s1")?.cells.status).toBe("Chờ nhận");
    // Nothing of the assignee's own part is even in the shape.
    expect(Object.keys(late?.cells ?? {}).sort()).toEqual(["date", "late", "status", "title", "who"]);
  });
  it("Theo người: count · late · % done", () => {
    expect(assignedByPerson(items, "2026-10-03")).toEqual([
      { assigneeId: "b", name: "Bình", count: 2, late: 1, donePercent: 50 },
      { assigneeId: "l", name: "Lan", count: 1, late: 0, donePercent: 0 },
    ]);
  });
});

describe("Ngày đáng nhớ · Giấy tờ sắp hết hạn", () => {
  it("next birthday first; no age when the year is not real", () => {
    const rows = memorableDays(
      [
        { id: "a", name: "An", dateOfBirth: "1990-10-05" },
        { id: "b", name: "Bảo", dateOfBirth: "0001-10-04" },
        { id: "c", name: "Chi", dateOfBirth: "1985-09-01" },
        { id: "d", name: "Dũng", dateOfBirth: null },
      ],
      "2026-10-03",
    );
    expect(rows.map((r) => [r.cells.title, r.cells.left, r.cells.age])).toEqual([
      ["Bảo", "Còn 1 ngày", ""],
      ["An", "Còn 2 ngày", "36 tuổi"],
      ["Chi", "Còn 333 ngày", "42 tuổi"],
    ]);
  });
  it("90 days ahead + expired; never the document number", () => {
    const base = { v: 1 as const, owner_label: "", owner_contact_id: null, tags: [], note: "", links: [], show_name_in_reminder: false };
    const rows = expiringRows(
      [
        { id: "p", section: "certificates", updatedAt: "", deletedAt: null, payload: { ...base, type: "passport", title: "Hộ chiếu", fields: { number: "C1234567", expires_on: "2026-11-01" } } },
        { id: "x", section: "certificates", updatedAt: "", deletedAt: null, payload: { ...base, type: "cccd", title: "CCCD", fields: { expires_on: "2026-09-30" } } },
        { id: "far", section: "certificates", updatedAt: "", deletedAt: null, payload: { ...base, type: "cccd", title: "Xa", fields: { expires_on: "2027-12-01" } } },
      ],
      "2026-10-03",
    );
    expect(rows.map((r) => [r.cells.title, r.cells.left])).toEqual([
      ["CCCD", "Đã hết hạn 3 ngày"],
      ["Hộ chiếu", "Còn 29 ngày"],
    ]);
    expect(JSON.stringify(rows)).not.toContain("C1234567");
  });
});

describe("78.12 · hidden boards", () => {
  it("reads only real view keys from prefs", () => {
    expect(hiddenBoardsOf({ hidden_boards: ["memorable_days", "nope", 3] })).toEqual(["memorable_days"]);
    expect(hiddenBoardsOf(null)).toEqual([]);
  });
});

describe("AVORA-81 · PHẦN 2 · C3 / C7", async () => {
  const { bookTitleLines } = await import("@/lib/book-catalog");
  const { READER_THEMES, readerSettingsFrom, curlAllowed, tapZone, minutesLeft } = await import("@/lib/reader-settings");
  const { arrangeBoards, sameWords, arrangementFromLegacy, showArrangePicker } = await import("@/lib/desk");

  it("79.17 · Vietnamese title first, original kept, tạm dịch marked", () => {
    expect(bookTitleLines({ title: "Pride and Prejudice", titleVi: "Kiêu hãnh và định kiến", titleViKind: "xuat_ban", language: "en" })).toEqual({ main: "Kiêu hãnh và định kiến", original: "Pride and Prejudice", tentative: false });
    expect(bookTitleLines({ title: "The Federalist Papers", titleVi: "Luận cương Liên bang", titleViKind: "tam_dich", language: "en" }).tentative).toBe(true);
    expect(bookTitleLines({ title: "Truyện Kiều", titleVi: "Truyện Kiều", titleViKind: null, language: "vi" })).toEqual({ main: "Truyện Kiều", original: null, tentative: false });
    expect(bookTitleLines({ title: "Roget's Thesaurus", titleVi: null, titleViKind: null, language: "en" }).original).toBeNull();
  });

  it("79.17 · the seed file: header + rows, kinds only xuat_ban / tam_dich", () => {
    const csv = readFileSync(path.resolve(__dirname, "../../../supabase/seed/book_title_vi.csv"), "utf8").trim().split("\n");
    expect(csv[0]).toBe("source_id,title_vi,title_vi_kind");
    expect(csv.length).toBeGreaterThan(100);
    expect(csv.slice(1).every((line) => /,(xuat_ban|tam_dich)$/.test(line))).toBe(true);
    expect(csv).toContain("1342,Kiêu hãnh và định kiến,xuat_ban");
  });

  it("C3 · every reader paper reaches 7:1", () => {
    const lum = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const theme of READER_THEMES) {
      const [a, b] = [lum(theme.paper), lum(theme.ink)].sort((x, y) => y - x);
      expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(7);
    }
  });

  it("C3 · defaults, 77's s/m/l migration, curl never with reduced motion, tap thirds, minutes", () => {
    expect(readerSettingsFrom({}, true).size).toBe(3);
    expect(readerSettingsFrom({}, false).size).toBe(2);
    expect(readerSettingsFrom({}, false, "l").size).toBe(3);
    expect(curlAllowed({ curl: true }, true)).toBe(false);
    expect([tapZone(10, 300), tapZone(150, 300), tapZone(290, 300)]).toEqual(["back", "tools", "forward"]);
    expect(minutesLeft([30_000, 30_000], 4)).toBeNull();
    expect(minutesLeft([30_000, 30_000, 30_000], 4)).toBe(2);
  });

  it("79.5 · each board once per arrangement; legacy ?ke=; picker from 3 boards", () => {
    const b = (id: string, lifecycle: "waiting" | "thinking" | "concluded", thinkingType: string | null, conversationId: string | null) =>
      ({ id, name: id, purpose: null, lifecycle, thinkingType, conversationId, projectId: null, archivedAt: null, updatedAt: "2026-10-01" }) as never;
    const boards = [b("a", "thinking", "weigh", null), b("b", "waiting", null, "c1"), b("c", "concluded", "learn", "g1")];
    for (const arrangement of ["noi", "tien-trinh", "cach-nghi"] as const) {
      const ids = arrangeBoards(boards, arrangement, (x: { conversationId: string | null }) => (x.conversationId === null ? "personal" : x.conversationId === "g1" ? "group" : "direct")).flatMap((g) => g.boards.map((x) => x.id));
      expect(ids.sort()).toEqual(["a", "b", "c"]);
    }
    expect(sameWords("Có nên mở xưởng?", "co nen mo xuong")).toBe(true);
    expect(arrangementFromLegacy("ke-sach")).toEqual({ arrangement: "noi", drawer: "sach" });
    expect(arrangementFromLegacy("trang-thai")?.arrangement).toBe("tien-trinh");
    expect([showArrangePicker(2), showArrangePicker(3)]).toEqual([false, true]);
  });
});
