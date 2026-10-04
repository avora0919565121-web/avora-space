import { addDaysIso, isObligationType, isLiabilityAccount, monthKey, outstandingCents, obligationStatusOf, OBLIGATION_STATUS_LABELS, signedCents, type Account, type LedgerEntry } from "@/lib/finance";
import { normalizeSearch } from "@/lib/normalize-search";
import { SECTION_LABEL, SECTION_PATH, templateOf, type VaultPayload } from "@/lib/vault-templates";
import type { VaultSection } from "@/lib/vault-crypto";

/**
 * AVORA-81 · PHẦN 1 (AVORA-78, ADR-049) — Bảng Avora lập sẵn. One registry, read by the
 * "Avora lập sẵn" drawer, the board frame, search and Cài đặt › Kế hoạch.
 *
 * Two kinds of system board:
 * - `link` (Bảng nối, AVORA-72): each source row is a real Hạng mục — the opportunity list only.
 * - `view` (Bảng xem): nothing is copied into Kế hoạch; the source is read live every time.
 *   Két sắt boards are computed on this device from data already decrypted / unlocked, never on
 *   the server, and never appear in search (ADR-032).
 */
export type ViewBoardKey =
  | "decisions"
  | "memorable_days"
  | "my_projects"
  | "assigned_by_me"
  | "cashflow"
  | "summary"
  | "loans"
  | "payment_calendar"
  | "expiring_docs"
  | "assets";

export type DefaultBoardZone = "ket-noi" | "nhiem-vu" | "ket-sat";

export type ViewColumn = { key: string; label: string; kind: "text" | "date" | "money" | "number" | "percent"; phone?: boolean };

export type DefaultBoardDef =
  | { kind: "link"; key: "opportunities"; zone: "ket-noi"; name: string; source: string }
  | {
      kind: "view";
      key: ViewBoardKey;
      zone: DefaultBoardZone;
      name: string;
      goal: string;
      source: string;
      empty: string;
      columns: readonly ViewColumn[];
      /** Extra readings besides `Bảng`. */
      views: readonly { id: string; label: string }[];
    };

const VIEW_TABLE = { id: "table", label: "Bảng" } as const;

export const DEFAULT_BOARDS: readonly DefaultBoardDef[] = [
  { kind: "link", key: "opportunities", zone: "ket-noi", name: "Danh bạ | Danh sách cơ hội", source: "Danh bạ" },
  {
    kind: "view",
    key: "decisions",
    zone: "ket-noi",
    name: "Sổ quyết định",
    goal: "Những gì đã chốt, chốt ở đâu, ai đã xác nhận?",
    source: "Biên bản và Biểu quyết",
    empty: "Dữ liệu vào đây khi một biên bản họp được chốt hoặc một biểu quyết được đóng trong cuộc trò chuyện của bạn.",
    columns: [
      { key: "title", label: "Quyết định", kind: "text", phone: true },
      { key: "place", label: "Ở đâu", kind: "text", phone: true },
      { key: "date", label: "Ngày chốt", kind: "date" },
      { key: "by", label: "Người xác nhận", kind: "text" },
      { key: "type", label: "Loại", kind: "text" },
    ],
    views: [VIEW_TABLE],
  },
  {
    kind: "view",
    key: "memorable_days",
    zone: "ket-noi",
    name: "Ngày đáng nhớ",
    goal: "Sắp tới là ngày quan trọng của ai?",
    source: "Danh bạ",
    empty: "Dữ liệu vào đây khi bạn ghi ngày sinh cho một Liên hệ.",
    columns: [
      { key: "title", label: "Người", kind: "text", phone: true },
      { key: "date", label: "Ngày", kind: "date" },
      { key: "left", label: "Còn", kind: "text", phone: true },
      { key: "age", label: "Tuổi", kind: "text" },
    ],
    views: [VIEW_TABLE],
  },
  {
    kind: "view",
    key: "my_projects",
    zone: "ket-noi",
    name: "Dự án của tôi",
    goal: "Dự án nào đang chạy, tới đâu, đang vướng ở đâu?",
    source: "Dự án",
    empty: "Dữ liệu vào đây khi bạn mở hoặc tham gia một Dự án.",
    columns: [
      { key: "title", label: "Dự án", kind: "text", phone: true },
      { key: "place", label: "Nhóm", kind: "text" },
      { key: "progress", label: "Tiến độ", kind: "percent", phone: true },
      { key: "overdue", label: "Việc quá hạn", kind: "number" },
      { key: "status", label: "Trạng thái", kind: "text" },
    ],
    views: [VIEW_TABLE],
  },
  {
    kind: "view",
    key: "assigned_by_me",
    zone: "nhiem-vu",
    name: "Việc tôi giao",
    goal: "Tôi đang chờ ai làm gì, việc nào đã trễ?",
    source: "Nhiệm vụ",
    empty: "Dữ liệu vào đây khi bạn giao một việc cho người khác trong 1-1, Nhóm hoặc Dự án.",
    columns: [
      { key: "title", label: "Việc", kind: "text", phone: true },
      { key: "who", label: "Người nhận", kind: "text", phone: true },
      { key: "date", label: "Hạn", kind: "date" },
      { key: "late", label: "Trễ", kind: "text" },
      { key: "status", label: "Trạng thái", kind: "text" },
    ],
    views: [VIEW_TABLE, { id: "person", label: "Theo người" }],
  },
  {
    kind: "view",
    key: "cashflow",
    zone: "ket-sat",
    name: "Tài chính | Thu chi",
    goal: "Tiền vào, tiền ra mỗi tháng ra sao — dòng tiền đang dương hay âm?",
    source: "Két sắt › Tài chính",
    empty: "Dữ liệu vào đây khi bạn ghi một giao dịch ở Két sắt › Tài chính.",
    columns: [
      { key: "date", label: "Ngày", kind: "date" },
      { key: "title", label: "Mô tả", kind: "text", phone: true },
      { key: "type", label: "Loại", kind: "text" },
      { key: "account", label: "Tài khoản", kind: "text" },
      { key: "in", label: "Thu", kind: "money", phone: true },
      { key: "out", label: "Chi", kind: "money", phone: true },
    ],
    views: [VIEW_TABLE, { id: "month", label: "Theo tháng" }],
  },
  {
    kind: "view",
    key: "summary",
    zone: "ket-sat",
    name: "Tài chính | Báo cáo tổng hợp",
    goal: "Tổng tài sản, tổng nợ và tài sản ròng hiện nay; tháng này khác tháng trước thế nào?",
    source: "Két sắt › Tài chính",
    empty: "Dữ liệu vào đây khi bạn có một tài khoản và giao dịch ở Két sắt › Tài chính.",
    columns: [
      { key: "title", label: "Tháng", kind: "text", phone: true },
      { key: "income", label: "Tổng thu", kind: "money" },
      { key: "expense", label: "Tổng chi", kind: "money" },
      { key: "saving", label: "Tiết kiệm", kind: "money", phone: true },
      { key: "debt", label: "Tổng nợ", kind: "money" },
      { key: "lent", label: "Cho vay", kind: "money" },
      { key: "net", label: "Tài sản ròng", kind: "money", phone: true },
    ],
    views: [VIEW_TABLE],
  },
  {
    kind: "view",
    key: "loans",
    zone: "ket-sat",
    name: "Tài chính | Vay & Cho vay",
    goal: "Ai đang nợ tôi, tôi đang nợ ai, khoản nào sắp tới hạn?",
    source: "Két sắt › Tài chính",
    empty: "Dữ liệu vào đây khi bạn ghi một khoản vay hoặc cho vay ở Két sắt › Tài chính.",
    columns: [
      { key: "title", label: "Người", kind: "text", phone: true },
      { key: "direction", label: "Chiều", kind: "text" },
      { key: "principal", label: "Số gốc", kind: "money" },
      { key: "paid", label: "Đã trả", kind: "money" },
      { key: "left", label: "Còn lại", kind: "money", phone: true },
      { key: "date", label: "Hạn", kind: "date" },
      { key: "status", label: "Trạng thái", kind: "text" },
    ],
    views: [VIEW_TABLE],
  },
  {
    kind: "view",
    key: "payment_calendar",
    zone: "ket-sat",
    name: "Tài chính | Lịch thanh toán",
    goal: "Từ nay tới cuối tháng phải trả / thu những khoản nào, vào ngày nào?",
    source: "Két sắt › Tài chính",
    empty: "Dữ liệu vào đây khi bạn ghi một khoản có hạn, khoản định kỳ hoặc thuế ở Két sắt › Tài chính.",
    columns: [
      { key: "date", label: "Ngày", kind: "date", phone: true },
      { key: "title", label: "Khoản", kind: "text", phone: true },
      { key: "direction", label: "Trả / Thu", kind: "text" },
      { key: "amount", label: "Số tiền", kind: "money", phone: true },
      { key: "type", label: "Loại", kind: "text" },
    ],
    views: [VIEW_TABLE],
  },
  {
    kind: "view",
    key: "expiring_docs",
    zone: "ket-sat",
    name: "Giấy tờ sắp hết hạn",
    goal: "Giấy tờ nào sắp hết hạn, cần gia hạn trước ngày nào?",
    source: "Két sắt › Chứng chỉ · Tài liệu",
    empty: "Dữ liệu vào đây khi bạn ghi ngày hết hạn cho một giấy tờ ở Két sắt › Chứng chỉ hoặc Tài liệu.",
    columns: [
      { key: "title", label: "Tên", kind: "text", phone: true },
      { key: "place", label: "Ngăn", kind: "text" },
      { key: "date", label: "Hết hạn", kind: "date" },
      { key: "left", label: "Còn", kind: "text", phone: true },
    ],
    views: [VIEW_TABLE],
  },
  {
    kind: "view",
    key: "assets",
    zone: "ket-sat",
    name: "Tài sản",
    goal: "Tôi đang có những tài sản gì, đang ở đâu, giá trị khoảng bao nhiêu?",
    source: "Két sắt › Tài sản",
    empty: "Dữ liệu vào đây khi bạn thêm một tài sản ở Két sắt › Tài sản.",
    columns: [
      { key: "title", label: "Tên", kind: "text", phone: true },
      { key: "type", label: "Loại", kind: "text" },
      { key: "place", label: "Ở đâu", kind: "text" },
      { key: "value", label: "Giá trị ước tính", kind: "money", phone: true },
      { key: "date", label: "Ngày cập nhật", kind: "date" },
    ],
    views: [VIEW_TABLE],
  },
];

export type ViewBoardDef = Extract<DefaultBoardDef, { kind: "view" }>;

export const VIEW_BOARDS: readonly ViewBoardDef[] = DEFAULT_BOARDS.filter((board): board is ViewBoardDef => board.kind === "view");

export const ZONES: readonly { id: DefaultBoardZone; label: string }[] = [
  { id: "ket-noi", label: "Kết nối" },
  { id: "nhiem-vu", label: "Nhiệm vụ" },
  { id: "ket-sat", label: "Két sắt" },
];

/** `?xem=<key>` on Kế hoạch opens a view board. */
export const VIEW_BOARD_PARAM = "xem";

export function isViewBoardKey(value: string | null | undefined): value is ViewBoardKey {
  return VIEW_BOARDS.some((board) => board.key === value);
}

export function viewBoardOf(key: ViewBoardKey): ViewBoardDef {
  return VIEW_BOARDS.find((board) => board.key === key) as ViewBoardDef;
}

/** Két sắt boards: computed on the device, locked with the vault, never searched. */
export function isVaultViewBoard(key: ViewBoardKey): boolean {
  return viewBoardOf(key).zone === "ket-sat";
}

/** Search across Kế hoạch: board names and goals — never a Két sắt board (ADR-032). */
export function searchViewBoards(query: string): ViewBoardDef[] {
  const needle = normalizeSearch(query);
  if (needle === "") return [];
  return VIEW_BOARDS.filter((board) => board.zone !== "ket-sat" && normalizeSearch(`${board.name} ${board.goal}`).includes(needle));
}

// ------------------------------------------------------------------ rows

/** One row of a view board. `cells` hold display values; money cells hold cents. */
export type ViewRow = {
  /** Stable id of the source row (the meta key). */
  key: string;
  cells: Record<string, string | number | null>;
  /** Where tapping the row goes — the real place of the data. */
  href: string;
  /** Currency of the money cells. */
  currency?: string;
  /** Needs attention now (accent in the drawer). */
  hot?: boolean;
  /** Sort / group helper. */
  group?: string;
};

function dayDiff(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

export function vnDate(iso: string | null): string {
  if (iso === null || iso === "") return "";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

// --- Ngày đáng nhớ

/** Years written as 0001 / 1900 mean "year unknown" in imported contacts. */
export function hasRealYear(iso: string): boolean {
  const year = Number(iso.slice(0, 4));
  return year > 1900 && year <= new Date().getFullYear();
}

export function memorableDays(
  contacts: readonly { id: string; name: string; dateOfBirth: string | null }[],
  today: string,
): ViewRow[] {
  const rows: (ViewRow & { left: number })[] = [];
  for (const contact of contacts) {
    const birth = contact.dateOfBirth;
    if (birth === null || !/^\d{4}-\d{2}-\d{2}/.test(birth)) continue;
    const md = birth.slice(5, 10);
    const thisYear = Number(today.slice(0, 4));
    // 29/02 on a common year falls on 28/02.
    const safe = (year: number): string => {
      const candidate = `${year}-${md}`;
      return md === "02-29" && new Date(`${candidate}T00:00:00Z`).getUTCMonth() !== 1 ? `${year}-02-28` : candidate;
    };
    let next = safe(thisYear);
    if (next < today) next = safe(thisYear + 1);
    const left = dayDiff(today, next);
    if (left > 365) continue;
    const age = hasRealYear(birth) ? Number(next.slice(0, 4)) - Number(birth.slice(0, 4)) : null;
    rows.push({
      key: contact.id,
      left,
      cells: { title: contact.name, date: next, left: left === 0 ? "Hôm nay" : `Còn ${left} ngày`, age: age === null ? "" : `${age} tuổi` },
      href: `/lien-he/${contact.id}`,
      hot: left <= 7,
    });
  }
  return rows.sort((a, b) => a.left - b.left);
}

// --- Việc tôi giao

export type AssignedItem = {
  kind: "task" | "suggestion";
  itemId: string;
  conversationId: string;
  title: string;
  assigneeId: string;
  assigneeName: string;
  deadline: string | null;
  status: string;
  doneAt: string | null;
};

export function assignedStatusLabel(item: Pick<AssignedItem, "kind" | "status" | "doneAt">): string {
  if (item.kind === "suggestion" || item.status === "pending_confirmation") return "Chờ nhận";
  if (item.doneAt !== null) return "Xong";
  return "Đang làm";
}

export function assignedRows(items: readonly AssignedItem[], today: string): ViewRow[] {
  return items
    .map((item) => {
      const late = item.doneAt === null && item.deadline !== null && item.deadline < today ? dayDiff(item.deadline, today) : 0;
      return {
        key: `${item.kind}:${item.itemId}`,
        cells: { title: item.title, who: item.assigneeName, date: item.deadline, late: late > 0 ? `Trễ ${late} ngày` : "", status: assignedStatusLabel(item) },
        href: item.kind === "task" ? `/tin-nhan/${item.conversationId}?nhiem-vu=${encodeURIComponent(item.itemId)}` : `/tin-nhan/${item.conversationId}`,
        hot: late > 0,
        group: item.assigneeId,
      } satisfies ViewRow;
    })
    .sort((a, b) => String(a.cells.date ?? "9999").localeCompare(String(b.cells.date ?? "9999")));
}

/** `Theo người`: one line per person — tasks · late · share done. */
export function assignedByPerson(items: readonly AssignedItem[], today: string): { assigneeId: string; name: string; count: number; late: number; donePercent: number }[] {
  const map = new Map<string, { assigneeId: string; name: string; count: number; late: number; done: number }>();
  for (const item of items) {
    const entry = map.get(item.assigneeId) ?? { assigneeId: item.assigneeId, name: item.assigneeName, count: 0, late: 0, done: 0 };
    entry.count += 1;
    if (item.doneAt !== null) entry.done += 1;
    else if (item.deadline !== null && item.deadline < today) entry.late += 1;
    map.set(item.assigneeId, entry);
  }
  return [...map.values()].map((entry) => ({ assigneeId: entry.assigneeId, name: entry.name, count: entry.count, late: entry.late, donePercent: Math.round((entry.done / entry.count) * 100) })).sort((a, b) => b.late - a.late || a.name.localeCompare(b.name));
}

// --- Sổ quyết định

export type DecisionItem = { decisionId: string; conversationId: string; kind: string; title: string; summary: string | null; settledAt: string; settledByName: string };

export function decisionRows(items: readonly DecisionItem[], placeOf: (conversationId: string) => string): ViewRow[] {
  return items.map((item) => ({
    key: item.decisionId,
    cells: { title: item.title, place: placeOf(item.conversationId), date: item.settledAt.slice(0, 10), by: item.settledByName, type: item.kind === "poll" ? "Biểu quyết" : "Biên bản" },
    href: `/tin-nhan/${item.conversationId}?so-quyet-dinh=${encodeURIComponent(item.decisionId)}`,
  }));
}

// --- Dự án của tôi

export type ProjectSummary = { projectId: string; conversationId: string; parentGroupId: string | null; title: string; status: string; total: number; done: number; overdue: number };

export function projectRows(items: readonly ProjectSummary[], placeOf: (conversationId: string | null) => string): ViewRow[] {
  return items.map((item) => ({
    key: item.projectId,
    cells: {
      title: item.title,
      place: placeOf(item.parentGroupId),
      progress: item.total === 0 ? null : Math.round((item.done / item.total) * 100),
      overdue: item.overdue,
      status: item.status === "active" ? (item.overdue > 0 ? "Đang vướng" : "Đang chạy") : item.status === "done" ? "Đã đóng" : item.status === "closed_early" ? "Đã dừng sớm" : "Đã lưu trữ",
    },
    href: `/du-an/${item.projectId}`,
    hot: item.overdue > 0,
  }));
}

// --- Két sắt · Tài chính (device only)

const live = (entries: readonly LedgerEntry[]): LedgerEntry[] => entries.filter((entry) => entry.deletedAt === null);

/** `Thu chi`: income and expense only — an obligation is money promised, not money moved. */
export function cashflowRows(entries: readonly LedgerEntry[]): ViewRow[] {
  return live(entries)
    .filter((entry) => entry.type === "income" || entry.type === "expense")
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((entry) => ({
      key: entry.id,
      currency: entry.currency,
      cells: {
        date: entry.date,
        title: entry.description ?? entry.category?.name ?? (entry.type === "income" ? "Thu" : "Chi"),
        type: entry.category?.name ?? (entry.type === "income" ? "Thu" : "Chi"),
        account: entry.account.name,
        in: entry.type === "income" ? entry.amountCents : null,
        out: entry.type === "expense" ? entry.amountCents : null,
      },
      href: `/ket-sat/giao-dich?thang=${monthKey(entry.date)}&mo=${entry.id}`,
      group: monthKey(entry.date),
    }));
}

/** `Theo tháng`: Thu · Chi · Chênh lệch per month, from base-currency entries. */
export function cashflowByMonth(baseEntries: readonly LedgerEntry[]): { month: string; inCents: number; outCents: number; diffCents: number }[] {
  const map = new Map<string, { inCents: number; outCents: number }>();
  for (const entry of live(baseEntries)) {
    if (entry.type !== "income" && entry.type !== "expense") continue;
    const month = monthKey(entry.date);
    const row = map.get(month) ?? { inCents: 0, outCents: 0 };
    if (entry.type === "income") row.inCents += entry.amountCents;
    else row.outCents += entry.amountCents;
    map.set(month, row);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, row]) => ({ month, ...row, diffCents: row.inCents - row.outCents }));
}

/**
 * `Báo cáo tổng hợp`: one row per month. Tài sản ròng = accounts at the month's end + lent − borrowed
 * outstanding (+ vault asset values when they exist; otherwise the board says `Chưa gồm tài sản`).
 */
export function summaryRows(accounts: readonly Account[], baseEntries: readonly LedgerEntry[], months: number, today: string, assetCents: number | null): ViewRow[] {
  const rows: ViewRow[] = [];
  const [year, month] = today.split("-").map(Number);
  for (let back = 0; back < months; back += 1) {
    const date = new Date(year, month - 1 - back, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const end = back === 0 ? today : addDaysIso(`${new Date(date.getFullYear(), date.getMonth() + 1, 1).toISOString().slice(0, 10)}`, -1);
    const inMonth = live(baseEntries).filter((entry) => monthKey(entry.date) === key);
    const income = inMonth.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amountCents, 0);
    const expense = inMonth.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amountCents, 0);
    let assets = 0;
    let liabilities = 0;
    for (const account of accounts) {
      if (account.deletedAt !== null) continue;
      const balance = account.openingBalanceCents + live(baseEntries).filter((entry) => entry.accountId === account.id && entry.date <= end).reduce((sum, entry) => sum + signedCents(entry), 0);
      if (isLiabilityAccount(account.type)) liabilities += -balance;
      else assets += balance;
    }
    let lent = 0;
    let borrowed = 0;
    for (const entry of live(baseEntries)) {
      if (entry.date > end || (entry.type !== "vay" && entry.type !== "cho_vay")) continue;
      const left = outstandingCents(entry);
      if (entry.type === "cho_vay") lent += left;
      else borrowed += left;
    }
    const debt = liabilities + borrowed;
    rows.push({
      key,
      cells: { title: `Tháng ${key.slice(5)}/${key.slice(0, 4)}`, income, expense, saving: income - expense, debt, lent, net: assets + lent - debt + (back === 0 && assetCents !== null ? assetCents : 0) },
      href: `/ket-sat/bao-cao?thang=${key}`,
    });
  }
  return rows;
}

export function loanRows(entries: readonly LedgerEntry[], contactName: (id: string | null) => string, today: string): ViewRow[] {
  return live(entries)
    .filter((entry) => entry.type === "vay" || entry.type === "cho_vay")
    .map((entry) => {
      const status = obligationStatusOf(entry, today);
      const left = outstandingCents(entry);
      const soon = entry.dueDate !== null && left > 0 && dayDiff(today, entry.dueDate) <= 7;
      return {
        key: entry.id,
        currency: entry.currency,
        cells: {
          title: contactName(entry.contactId) || entry.description || "—",
          direction: entry.type === "vay" ? "Tôi nợ" : "Nợ tôi",
          principal: entry.amountCents,
          paid: entry.settledCents,
          left,
          date: entry.dueDate,
          status: OBLIGATION_STATUS_LABELS[status],
        },
        href: `/ket-sat/giao-dich?mo=${entry.id}`,
        hot: soon,
      } satisfies ViewRow;
    })
    .sort((a, b) => Number(b.cells.left !== 0) - Number(a.cells.left !== 0) || String(a.cells.date ?? "9999").localeCompare(String(b.cells.date ?? "9999")));
}

function endOfMonthIso(today: string, plusMonths: number): string {
  const [year, month] = today.split("-").map(Number);
  const last = new Date(Date.UTC(year, month + plusMonths, 0));
  return last.toISOString().slice(0, 10);
}

function startOfMonthIso(today: string, plusMonths: number): string {
  const [year, month] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + plusMonths, 1)).toISOString().slice(0, 10);
}

/** Next date a recurring entry falls on, at or after `from`. */
export function nextRecurrence(date: string, frequency: "weekly" | "monthly" | "yearly", from: string): string {
  let cursor = date;
  for (let guard = 0; guard < 600 && cursor < from; guard += 1) {
    const [y, m, d] = cursor.split("-").map(Number);
    if (frequency === "weekly") cursor = addDaysIso(cursor, 7);
    else if (frequency === "monthly") {
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      cursor = new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
    } else cursor = `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return cursor;
}

/** `Lịch thanh toán`: dues, recurring entries and taxes from `from` to `to`. */
export function paymentRows(entries: readonly LedgerEntry[], today: string, month: "this" | "next"): ViewRow[] {
  const from = month === "this" ? today : startOfMonthIso(today, 1);
  const to = endOfMonthIso(today, month === "this" ? 0 : 1);
  const rows: ViewRow[] = [];
  for (const entry of live(entries)) {
    if (isObligationType(entry.type)) {
      const due = entry.type.startsWith("thue") ? (entry.dueDate ?? entry.taxPeriodEnd) : entry.dueDate;
      if (due === null || due < from || due > to || outstandingCents(entry) === 0) continue;
      rows.push({
        key: entry.id,
        currency: entry.currency,
        cells: {
          date: due,
          title: entry.description ?? (entry.type.startsWith("thue") ? "Thuế" : entry.type === "vay" ? "Trả khoản vay" : "Thu khoản cho vay"),
          direction: entry.type === "cho_vay" ? "Thu" : "Trả",
          amount: outstandingCents(entry),
          type: entry.type.startsWith("thue") ? "Thuế" : "Vay",
        },
        href: `/ket-sat/giao-dich?mo=${entry.id}`,
        hot: dayDiff(today, due) <= 7,
      });
    } else if (entry.isRecurring && entry.recurringFrequency !== null) {
      const next = nextRecurrence(entry.date, entry.recurringFrequency, from);
      if (next > to || next === entry.date) continue;
      rows.push({
        key: `${entry.id}@${next}`,
        currency: entry.currency,
        cells: { date: next, title: entry.recurringLabel ?? entry.description ?? entry.category?.name ?? "Khoản định kỳ", direction: entry.type === "income" ? "Thu" : "Trả", amount: entry.amountCents, type: "Định kỳ" },
        href: `/ket-sat/giao-dich?mo=${entry.id}`,
        hot: dayDiff(today, next) <= 7,
      });
    }
  }
  return rows.sort((a, b) => String(a.cells.date).localeCompare(String(b.cells.date)));
}

// --- Két sắt · Chứng chỉ / Tài liệu / Tài sản (device only)

export type OpenVaultItem = { id: string; section: VaultSection; payload: VaultPayload; updatedAt: string; deletedAt: string | null };

/** Expiry of an item: the first field marked `expiry` that holds a date. Never the document number. */
export function expiryOf(item: Pick<OpenVaultItem, "section" | "payload">): string | null {
  const template = templateOf(item.section, item.payload.type);
  const field = template.fields.find((f) => f.expiry === true && /^\d{4}-\d{2}-\d{2}$/.test(item.payload.fields[f.key] ?? ""));
  return field === undefined ? null : item.payload.fields[field.key];
}

export function expiringRows(items: readonly OpenVaultItem[], today: string): ViewRow[] {
  const rows: (ViewRow & { left: number })[] = [];
  for (const item of items) {
    if (item.deletedAt !== null || item.section === "assets") continue;
    const expiry = expiryOf(item);
    if (expiry === null) continue;
    const left = dayDiff(today, expiry);
    if (left > 90) continue;
    rows.push({
      key: item.id,
      left,
      cells: { title: item.payload.title, place: SECTION_LABEL[item.section], date: expiry, left: left < 0 ? `Đã hết hạn ${-left} ngày` : left === 0 ? "Hết hạn hôm nay" : `Còn ${left} ngày` },
      href: `${SECTION_PATH[item.section]}?mo=${item.id}`,
      hot: left <= 30,
    });
  }
  return rows.sort((a, b) => a.left - b.left);
}

export function assetRows(items: readonly OpenVaultItem[]): { rows: ViewRow[]; totalCents: number | null } {
  let total = 0;
  let hasValue = false;
  const rows = items
    .filter((item) => item.deletedAt === null && item.section === "assets")
    .map((item) => {
      const raw = (item.payload.fields.value ?? "").replace(/[^\d]/g, "");
      const cents = raw === "" ? null : Number(raw) * 100;
      if (cents !== null) {
        hasValue = true;
        total += cents;
      }
      const template = templateOf("assets", item.payload.type);
      return {
        key: item.id,
        currency: "VND",
        cells: { title: item.payload.title, type: template.label, place: item.payload.fields.kept_at ?? item.payload.fields.address ?? "", value: cents, date: item.updatedAt.slice(0, 10) },
        href: `${SECTION_PATH.assets}?mo=${item.id}`,
      } satisfies ViewRow;
    });
  return { rows, totalCents: hasValue ? total : null };
}

// ------------------------------------------------------------------ hiding

/** Hidden view boards live in `profiles.prefs.hidden_boards` (Cài đặt › Kế hoạch shows them again). */
export function hiddenBoardsOf(prefs: unknown): ViewBoardKey[] {
  const list = (prefs as { hidden_boards?: unknown } | null)?.hidden_boards;
  return Array.isArray(list) ? list.filter((key): key is ViewBoardKey => typeof key === "string" && isViewBoardKey(key)) : [];
}
