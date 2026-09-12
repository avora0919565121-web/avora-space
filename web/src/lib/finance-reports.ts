import {
  ACCOUNT_TYPE_LABELS,
  GIVING_SLUGS,
  activeAccounts,
  balanceAt,
  endOfMonth,
  entriesInRange,
  formatMonthLong,
  formatMonthShort,
  givingRatio,
  hasBusinessActivity,
  isLiabilityAccount,
  monthKey,
  monthRange,
  netWorthAt,
  signedCents,
  sortEntries,
  startOfMonth,
  sumCents,
  totalsFor,
  type Account,
  type LedgerEntry,
} from "@/lib/finance";

/**
 * The eight reports. Each one is a pure function of the ledger and a date range, so the
 * table on screen, the CSV and the Excel file are always the same numbers — the export
 * cannot disagree with what the person just read.
 */

export type ReportId =
  | "monthly-summary"
  | "category-breakdown"
  | "account-statement"
  | "balance-history"
  | "giving"
  | "net-worth"
  | "profit-loss"
  | "deductible-summary";

export type ReportColumnKind = "text" | "money" | "percent" | "date";

export type ReportColumn = {
  key: string;
  label: string;
  kind: ReportColumnKind;
};

export type ReportCell = string | number | null;

export type ReportRow = {
  key: string;
  cells: Record<string, ReportCell>;
  /** Subtotal and total rows: heavier ink, hairline above. */
  emphasis?: boolean;
  /** Section headings inside a table (P&L, Deductible Summary). */
  heading?: boolean;
  color?: string;
};

export type ReportStat = {
  label: string;
  /** Cents when `kind` is money, a 0..1 ratio when percent, a plain integer when count. */
  value: number | null;
  kind: "money" | "percent" | "count";
  tone?: "positive" | "negative" | "neutral";
};

export type ReportChart =
  | { kind: "none" }
  | { kind: "pie"; slices: { name: string; valueCents: number; color: string }[] }
  | {
      kind: "line" | "bar";
      xKey: string;
      series: { key: string; name: string; color: string }[];
      points: Record<string, string | number>[];
    };

export type ReportResult = {
  id: ReportId;
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  stats: ReportStat[];
  chart: ReportChart;
  /** Nothing in range — the page shows a plain sentence instead of an empty grid. */
  empty: boolean;
  emptyMessage: string;
};

export type ReportKind = "personal" | "business";

export type ReportDefinition = {
  id: ReportId;
  label: string;
  description: string;
  kind: ReportKind;
  /** Only the account statement is about one account at a time. */
  needsAccount?: boolean;
};

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    id: "monthly-summary",
    label: "Tổng hợp theo tháng",
    description: "Thu, chi và chênh lệch từng tháng.",
    kind: "personal",
  },
  {
    id: "category-breakdown",
    label: "Phân bổ theo hạng mục",
    description: "Tỉ trọng từng hạng mục trong tổng thu và tổng chi.",
    kind: "personal",
  },
  {
    id: "account-statement",
    label: "Sao kê tài khoản",
    description: "Toàn bộ giao dịch của một tài khoản kèm số dư luỹ kế.",
    kind: "personal",
    needsAccount: true,
  },
  {
    id: "balance-history",
    label: "Lịch sử số dư",
    description: "Số dư từng tài khoản theo thời gian.",
    kind: "personal",
  },
  {
    id: "giving",
    label: "Báo cáo dâng hiến",
    description: "Dâng phần mười và từ thiện, so với thu nhập.",
    kind: "personal",
  },
  {
    id: "net-worth",
    label: "Giá trị ròng",
    description: "Tài sản trừ nợ, và thay đổi so với tháng trước.",
    kind: "personal",
  },
  {
    id: "profit-loss",
    label: "Báo cáo lãi lỗ",
    description: "Doanh thu kinh doanh trừ chi phí kinh doanh.",
    kind: "business",
  },
  {
    id: "deductible-summary",
    label: "Chi phí được trừ",
    description: "Danh sách chi phí kinh doanh kèm mục đích, sẵn sàng cho thuế.",
    kind: "business",
  },
] as const;

export function reportDefinition(id: ReportId): ReportDefinition {
  const found = REPORT_DEFINITIONS.find((definition) => definition.id === id);
  if (!found) throw new Error(`Unknown report: ${id}`);
  return found;
}

export type ReportContext = {
  entries: readonly LedgerEntry[];
  accounts: readonly Account[];
  from: string;
  to: string;
  /** Required by the account statement, ignored elsewhere. */
  accountId?: string;
};

const rangeSubtitle = (from: string, to: string): string => `Từ ${vi(from)} đến ${vi(to)}`;

function vi(dateIso: string): string {
  const [year, month, day] = dateIso.split("-");
  return `${day}/${month}/${year}`;
}

/** Month buckets touched by the range, oldest first. */
function monthsBetween(from: string, to: string): string[] {
  const start = monthKey(from);
  const end = monthKey(to);
  const months: string[] = [];
  let cursor = start;
  // A range is bounded by a date picker, so this cannot run away.
  while (cursor <= end && months.length < 120) {
    months.push(cursor);
    const [year, month] = cursor.split("-").map(Number);
    const next = new Date(year, month, 1);
    cursor = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  }
  return months;
}

type CategoryTotal = {
  id: string;
  name: string;
  color: string;
  cents: number;
};

function totalsByCategory(entries: readonly LedgerEntry[], type: "income" | "expense"): CategoryTotal[] {
  const byId = new Map<string, CategoryTotal>();
  for (const entry of entries) {
    if (entry.type !== type) continue;
    const known = byId.get(entry.categoryId);
    if (known) known.cents += entry.amountCents;
    else
      byId.set(entry.categoryId, {
        id: entry.categoryId,
        name: entry.category.name,
        color: entry.category.color,
        cents: entry.amountCents,
      });
  }
  return [...byId.values()].sort((a, b) => b.cents - a.cents);
}

// ---------------------------------------------------------------- 1. monthly summary

function buildMonthlySummary(context: ReportContext): ReportResult {
  const scoped = entriesInRange(context.entries, context.from, context.to);
  const business = hasBusinessActivity(scoped);
  const months = monthsBetween(context.from, context.to);

  const columns: ReportColumn[] = [
    { key: "month", label: "Tháng", kind: "text" },
    { key: "income", label: "Thu", kind: "money" },
    ...(business
      ? [
          { key: "personalExpense", label: "Chi cá nhân", kind: "money" as const },
          { key: "businessExpense", label: "Chi kinh doanh", kind: "money" as const },
        ]
      : []),
    { key: "expense", label: "Tổng chi", kind: "money" },
    { key: "net", label: "Chênh lệch", kind: "money" },
  ];

  const rows: ReportRow[] = months.map((month) => {
    const monthEntries = scoped.filter((entry) => monthKey(entry.date) === month);
    const totals = totalsFor(monthEntries);
    return {
      key: month,
      cells: {
        month: formatMonthLong(month),
        income: totals.incomeCents,
        personalExpense: totals.personalExpenseCents,
        businessExpense: totals.businessExpenseCents,
        expense: totals.expenseCents,
        net: totals.netCents,
      },
    };
  });

  const totals = totalsFor(scoped);
  if (rows.length > 0) {
    rows.push({
      key: "total",
      emphasis: true,
      cells: {
        month: "Tổng cộng",
        income: totals.incomeCents,
        personalExpense: totals.personalExpenseCents,
        businessExpense: totals.businessExpenseCents,
        expense: totals.expenseCents,
        net: totals.netCents,
      },
    });
  }

  return {
    id: "monthly-summary",
    title: "Tổng hợp theo tháng",
    subtitle: rangeSubtitle(context.from, context.to),
    columns,
    rows,
    stats: [
      { label: "Tổng thu", value: totals.incomeCents, kind: "money", tone: "positive" },
      { label: "Tổng chi", value: totals.expenseCents, kind: "money", tone: "negative" },
      {
        label: "Chênh lệch",
        value: totals.netCents,
        kind: "money",
        tone: totals.netCents >= 0 ? "positive" : "negative",
      },
    ],
    chart: {
      kind: "bar",
      xKey: "label",
      series: [
        { key: "income", name: "Thu", color: "#3F8F6B" },
        { key: "expense", name: "Chi", color: "#E0603C" },
      ],
      points: months.map((month) => {
        const totalsForMonth = totalsFor(scoped.filter((entry) => monthKey(entry.date) === month));
        return {
          label: formatMonthShort(month),
          income: totalsForMonth.incomeCents,
          expense: totalsForMonth.expenseCents,
        };
      }),
    },
    empty: scoped.length === 0,
    emptyMessage: "Chưa có giao dịch nào trong khoảng thời gian này.",
  };
}

// ---------------------------------------------------------------- 2. category breakdown

function buildCategoryBreakdown(context: ReportContext): ReportResult {
  const scoped = entriesInRange(context.entries, context.from, context.to);
  const totals = totalsFor(scoped);
  const incomeTotals = totalsByCategory(scoped, "income");
  const expenseTotals = totalsByCategory(scoped, "expense");

  const rows: ReportRow[] = [];

  if (incomeTotals.length > 0) {
    rows.push({ key: "h-income", heading: true, cells: { group: "Thu", category: "Thu", amount: null, share: null } });
    for (const item of incomeTotals) {
      rows.push({
        key: `income-${item.id}`,
        color: item.color,
        cells: {
          group: "Thu",
          category: item.name,
          amount: item.cents,
          share: totals.incomeCents > 0 ? item.cents / totals.incomeCents : null,
        },
      });
    }
    rows.push({
      key: "income-total",
      emphasis: true,
      cells: { group: "Thu", category: "Tổng thu", amount: totals.incomeCents, share: totals.incomeCents > 0 ? 1 : null },
    });
  }

  if (expenseTotals.length > 0) {
    rows.push({ key: "h-expense", heading: true, cells: { group: "Chi", category: "Chi", amount: null, share: null } });
    for (const item of expenseTotals) {
      rows.push({
        key: `expense-${item.id}`,
        color: item.color,
        cells: {
          group: "Chi",
          category: item.name,
          amount: item.cents,
          share: totals.expenseCents > 0 ? item.cents / totals.expenseCents : null,
        },
      });
    }
    rows.push({
      key: "expense-total",
      emphasis: true,
      cells: { group: "Chi", category: "Tổng chi", amount: totals.expenseCents, share: totals.expenseCents > 0 ? 1 : null },
    });
  }

  // The pie answers "where does the money go"; only if nothing went out does it show what came in.
  const slicesSource = expenseTotals.length > 0 ? expenseTotals : incomeTotals;

  return {
    id: "category-breakdown",
    title: "Phân bổ theo hạng mục",
    subtitle: rangeSubtitle(context.from, context.to),
    columns: [
      { key: "group", label: "Nhóm", kind: "text" },
      { key: "category", label: "Hạng mục", kind: "text" },
      { key: "amount", label: "Số tiền", kind: "money" },
      { key: "share", label: "Tỉ trọng", kind: "percent" },
    ],
    rows,
    stats: [
      { label: "Tổng thu", value: totals.incomeCents, kind: "money", tone: "positive" },
      { label: "Tổng chi", value: totals.expenseCents, kind: "money", tone: "negative" },
      {
        label: "Hạng mục đã dùng",
        value: incomeTotals.length + expenseTotals.length,
        kind: "count",
        tone: "neutral",
      },
    ],
    chart: {
      kind: "pie",
      slices: slicesSource.map((item) => ({ name: item.name, valueCents: item.cents, color: item.color })),
    },
    empty: scoped.length === 0,
    emptyMessage: "Chưa có giao dịch nào trong khoảng thời gian này.",
  };
}

// ---------------------------------------------------------------- 3. account statement

function buildAccountStatement(context: ReportContext): ReportResult {
  const account = context.accounts.find((candidate) => candidate.id === context.accountId);

  if (!account) {
    return {
      id: "account-statement",
      title: "Sao kê tài khoản",
      subtitle: rangeSubtitle(context.from, context.to),
      columns: [],
      rows: [],
      stats: [],
      chart: { kind: "none" },
      empty: true,
      emptyMessage: "Hãy chọn một tài khoản để xem sao kê.",
    };
  }

  const scoped = sortEntries(
    entriesInRange(
      context.entries.filter((entry) => entry.accountId === account.id),
      context.from,
      context.to,
    ),
  ).reverse();

  // Everything before the range is folded into one opening line, so the running
  // balance in the statement matches the account's real balance, not a partial one.
  const opening = balanceAt(account, context.entries, previousDay(context.from));

  let running = opening;
  const rows: ReportRow[] = [
    {
      key: "opening",
      emphasis: true,
      cells: {
        date: context.from,
        description: "Số dư đầu kỳ",
        category: "",
        income: null,
        expense: null,
        balance: opening,
      },
    },
  ];

  for (const entry of scoped) {
    running += signedCents(entry);
    rows.push({
      key: entry.id,
      cells: {
        date: entry.date,
        description: entry.description ?? entry.category.name,
        category: entry.category.name,
        income: entry.type === "income" ? entry.amountCents : null,
        expense: entry.type === "expense" ? entry.amountCents : null,
        balance: running,
      },
    });
  }

  rows.push({
    key: "closing",
    emphasis: true,
    cells: {
      date: context.to,
      description: "Số dư cuối kỳ",
      category: "",
      income: sumCents(scoped.filter((entry) => entry.type === "income").map((entry) => entry.amountCents)),
      expense: sumCents(scoped.filter((entry) => entry.type === "expense").map((entry) => entry.amountCents)),
      balance: running,
    },
  });

  return {
    id: "account-statement",
    title: `Sao kê — ${account.name}`,
    subtitle: `${ACCOUNT_TYPE_LABELS[account.type]} · ${rangeSubtitle(context.from, context.to)}`,
    columns: [
      { key: "date", label: "Ngày", kind: "date" },
      { key: "description", label: "Diễn giải", kind: "text" },
      { key: "category", label: "Hạng mục", kind: "text" },
      { key: "income", label: "Thu", kind: "money" },
      { key: "expense", label: "Chi", kind: "money" },
      { key: "balance", label: "Số dư", kind: "money" },
    ],
    rows,
    stats: [
      { label: "Số dư đầu kỳ", value: opening, kind: "money", tone: "neutral" },
      { label: "Số dư cuối kỳ", value: running, kind: "money", tone: running >= 0 ? "positive" : "negative" },
      { label: "Số giao dịch", value: scoped.length, kind: "count", tone: "neutral" },
    ],
    chart: { kind: "none" },
    empty: scoped.length === 0,
    emptyMessage: "Tài khoản này chưa có giao dịch nào trong khoảng thời gian đã chọn.",
  };
}

function previousDay(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const base = new Date(year, month - 1, day - 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- 4. balance history

/**
 * Checkpoints for the balance curve: month ends on a long range, the days that actually
 * moved on a short one. Either way the endpoints are always plotted.
 */
export function balanceCheckpoints(entries: readonly LedgerEntry[], from: string, to: string): string[] {
  const months = monthsBetween(from, to);
  const longRange = months.length > 3;

  const dates = new Set<string>([from, to]);
  if (longRange) {
    for (const month of months) {
      const end = endOfMonth(month);
      dates.add(end > to ? to : end < from ? from : end);
    }
  } else {
    for (const entry of entries) {
      if (entry.date >= from && entry.date <= to) dates.add(entry.date);
    }
  }

  const sorted = [...dates].sort();
  if (sorted.length <= 40) return sorted;
  // Thin out an unusually busy short range so the chart stays readable.
  const step = Math.ceil(sorted.length / 40);
  const thinned = sorted.filter((_, index) => index % step === 0);
  if (thinned[thinned.length - 1] !== to) thinned.push(to);
  return thinned;
}

function buildBalanceHistory(context: ReportContext): ReportResult {
  const accounts = activeAccounts(context.accounts);
  const checkpoints = balanceCheckpoints(context.entries, context.from, context.to);

  const columns: ReportColumn[] = [
    { key: "date", label: "Ngày", kind: "date" },
    ...accounts.map((account) => ({ key: account.id, label: account.name, kind: "money" as const })),
    { key: "total", label: "Tổng", kind: "money" },
  ];

  const rows: ReportRow[] = checkpoints.map((date) => {
    const cells: Record<string, ReportCell> = { date };
    let total = 0;
    for (const account of accounts) {
      const balance = balanceAt(account, context.entries, date);
      cells[account.id] = balance;
      total += balance;
    }
    cells.total = total;
    return { key: date, cells };
  });

  const palette = chartPalette(accounts.length);

  return {
    id: "balance-history",
    title: "Lịch sử số dư",
    subtitle: rangeSubtitle(context.from, context.to),
    columns,
    rows,
    stats: accounts.slice(0, 3).map((account) => ({
      label: account.name,
      value: balanceAt(account, context.entries, context.to),
      kind: "money" as const,
      tone: "neutral" as const,
    })),
    chart: {
      kind: "line",
      xKey: "label",
      series: accounts.map((account, index) => ({
        key: account.id,
        name: account.name,
        color: palette[index % palette.length],
      })),
      points: checkpoints.map((date) => {
        const point: Record<string, string | number> = { label: vi(date).slice(0, 5) };
        for (const account of accounts) point[account.id] = balanceAt(account, context.entries, date);
        return point;
      }),
    },
    empty: accounts.length === 0,
    emptyMessage: "Chưa có tài khoản nào để vẽ số dư.",
  };
}

/** Warm, printed-chart hues. Deliberately no blue-purple default ramp. */
export const CHART_PALETTE: readonly string[] = [
  "#E0603C",
  "#3F8F6B",
  "#C98A3E",
  "#5B7B8A",
  "#8C6A4A",
  "#7D8A4F",
  "#D68A6F",
  "#4E6E7D",
  "#A8926F",
  "#6B635A",
] as const;

function chartPalette(count: number): string[] {
  const colors: string[] = [];
  for (let index = 0; index < Math.max(count, 1); index += 1) {
    colors.push(CHART_PALETTE[index % CHART_PALETTE.length]);
  }
  return colors;
}

// ---------------------------------------------------------------- 5. giving

function buildGiving(context: ReportContext): ReportResult {
  const scoped = entriesInRange(context.entries, context.from, context.to);
  const givingEntries = sortEntries(
    scoped.filter(
      (entry) => entry.type === "expense" && entry.category.slug !== null && GIVING_SLUGS.includes(entry.category.slug),
    ),
  );
  const totals = totalsFor(scoped);
  const ratio = givingRatio(totals);

  const rows: ReportRow[] = givingEntries.map((entry) => ({
    key: entry.id,
    color: entry.category.color,
    cells: {
      date: entry.date,
      category: entry.category.name,
      description: entry.description ?? "",
      amount: entry.amountCents,
    },
  }));

  if (rows.length > 0) {
    rows.push({
      key: "total",
      emphasis: true,
      cells: { date: "", category: "Tổng dâng hiến", description: "", amount: totals.givingCents },
    });
  }

  return {
    id: "giving",
    title: "Báo cáo dâng hiến",
    subtitle: rangeSubtitle(context.from, context.to),
    columns: [
      { key: "date", label: "Ngày", kind: "date" },
      { key: "category", label: "Hạng mục", kind: "text" },
      { key: "description", label: "Diễn giải", kind: "text" },
      { key: "amount", label: "Số tiền", kind: "money" },
    ],
    rows,
    stats: [
      { label: "Đã dâng hiến", value: totals.givingCents, kind: "money", tone: "positive" },
      { label: "Tổng thu nhập", value: totals.incomeCents, kind: "money", tone: "neutral" },
      { label: "Tỉ lệ trên thu nhập", value: ratio, kind: "percent", tone: "neutral" },
    ],
    chart: { kind: "none" },
    empty: givingEntries.length === 0,
    emptyMessage: "Chưa ghi nhận khoản dâng phần mười hay từ thiện nào trong kỳ này.",
  };
}

// ---------------------------------------------------------------- 6. net worth

function buildNetWorth(context: ReportContext): ReportResult {
  const accounts = activeAccounts(context.accounts);
  const now = netWorthAt(accounts, context.entries, context.to);

  // "Change from previous month" is measured at the same point one month earlier.
  const previousMonthEnd = endOfMonth(previousMonthOf(monthKey(context.to)));
  const before = netWorthAt(accounts, context.entries, previousMonthEnd);
  const change = now.netCents - before.netCents;

  const rows: ReportRow[] = accounts
    .map((account) => {
      const balance = balanceAt(account, context.entries, context.to);
      const liability = isLiabilityAccount(account.type);
      return {
        key: account.id,
        cells: {
          account: account.name,
          type: ACCOUNT_TYPE_LABELS[account.type],
          group: liability ? "Nợ" : "Tài sản",
          balance: liability ? -balance : balance,
        },
      };
    })
    .sort((a, b) => String(a.cells.group).localeCompare(String(b.cells.group), "vi"));

  if (rows.length > 0) {
    rows.push({
      key: "assets",
      emphasis: true,
      cells: { account: "Tổng tài sản", type: "", group: "Tài sản", balance: now.assetsCents },
    });
    rows.push({
      key: "liabilities",
      emphasis: true,
      cells: { account: "Tổng nợ", type: "", group: "Nợ", balance: now.liabilitiesCents },
    });
    rows.push({
      key: "net",
      emphasis: true,
      cells: { account: "Giá trị ròng", type: "", group: "", balance: now.netCents },
    });
  }

  return {
    id: "net-worth",
    title: "Giá trị ròng",
    subtitle: `Tính đến ${vi(context.to)}`,
    columns: [
      { key: "account", label: "Tài khoản", kind: "text" },
      { key: "type", label: "Loại", kind: "text" },
      { key: "group", label: "Nhóm", kind: "text" },
      { key: "balance", label: "Số dư", kind: "money" },
    ],
    rows,
    stats: [
      { label: "Tài sản", value: now.assetsCents, kind: "money", tone: "positive" },
      { label: "Nợ", value: now.liabilitiesCents, kind: "money", tone: "negative" },
      {
        label: `Thay đổi từ ${formatMonthLong(previousMonthOf(monthKey(context.to))).toLowerCase()}`,
        value: change,
        kind: "money",
        tone: change >= 0 ? "positive" : "negative",
      },
    ],
    chart: { kind: "none" },
    empty: accounts.length === 0,
    emptyMessage: "Chưa có tài khoản nào để tính giá trị ròng.",
  };
}

function previousMonthOf(monthIso: string): string {
  const [year, month] = monthIso.split("-").map(Number);
  const base = new Date(year, month - 2, 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- 7. profit & loss

function buildProfitLoss(context: ReportContext): ReportResult {
  const scoped = entriesInRange(context.entries, context.from, context.to).filter((entry) => entry.businessRelated);
  const revenue = totalsByCategory(scoped, "income");
  const costs = totalsByCategory(scoped, "expense");
  const revenueTotal = sumCents(revenue.map((item) => item.cents));
  const costTotal = sumCents(costs.map((item) => item.cents));
  const profit = revenueTotal - costTotal;

  const rows: ReportRow[] = [];
  rows.push({ key: "h-revenue", heading: true, cells: { line: "Doanh thu kinh doanh", amount: null } });
  for (const item of revenue) rows.push({ key: `rev-${item.id}`, color: item.color, cells: { line: item.name, amount: item.cents } });
  rows.push({ key: "revenue-total", emphasis: true, cells: { line: "Tổng doanh thu", amount: revenueTotal } });

  rows.push({ key: "h-costs", heading: true, cells: { line: "Chi phí kinh doanh", amount: null } });
  for (const item of costs) rows.push({ key: `cost-${item.id}`, color: item.color, cells: { line: item.name, amount: item.cents } });
  rows.push({ key: "cost-total", emphasis: true, cells: { line: "Tổng chi phí", amount: costTotal } });

  rows.push({ key: "profit", emphasis: true, cells: { line: "Lãi gộp", amount: profit } });

  const months = monthsBetween(context.from, context.to);

  return {
    id: "profit-loss",
    title: "Báo cáo lãi lỗ",
    subtitle: rangeSubtitle(context.from, context.to),
    columns: [
      { key: "line", label: "Khoản mục", kind: "text" },
      { key: "amount", label: "Số tiền", kind: "money" },
    ],
    rows,
    stats: [
      { label: "Doanh thu", value: revenueTotal, kind: "money", tone: "positive" },
      { label: "Chi phí", value: costTotal, kind: "money", tone: "negative" },
      { label: "Lãi gộp", value: profit, kind: "money", tone: profit >= 0 ? "positive" : "negative" },
    ],
    chart: {
      kind: "bar",
      xKey: "label",
      series: [
        { key: "revenue", name: "Doanh thu", color: "#3F8F6B" },
        { key: "cost", name: "Chi phí", color: "#E0603C" },
        { key: "profit", name: "Lãi gộp", color: "#C98A3E" },
      ],
      points: months.map((month) => {
        const monthEntries = scoped.filter((entry) => monthKey(entry.date) === month);
        const monthRevenue = sumCents(monthEntries.filter((e) => e.type === "income").map((e) => e.amountCents));
        const monthCost = sumCents(monthEntries.filter((e) => e.type === "expense").map((e) => e.amountCents));
        return { label: formatMonthShort(month), revenue: monthRevenue, cost: monthCost, profit: monthRevenue - monthCost };
      }),
    },
    empty: scoped.length === 0,
    emptyMessage: "Chưa có giao dịch nào được đánh dấu là kinh doanh trong kỳ này.",
  };
}

// ---------------------------------------------------------------- 8. deductible summary

function buildDeductibleSummary(context: ReportContext): ReportResult {
  const scoped = sortEntries(
    entriesInRange(context.entries, context.from, context.to).filter(
      (entry) => entry.businessRelated && entry.type === "expense",
    ),
  );

  const byCategory = new Map<string, LedgerEntry[]>();
  for (const entry of scoped) {
    const bucket = byCategory.get(entry.categoryId);
    if (bucket) bucket.push(entry);
    else byCategory.set(entry.categoryId, [entry]);
  }

  const rows: ReportRow[] = [];
  const groups = [...byCategory.entries()].sort(
    (a, b) => sumCents(b[1].map((e) => e.amountCents)) - sumCents(a[1].map((e) => e.amountCents)),
  );

  for (const [, group] of groups) {
    const first = group[0];
    rows.push({ key: `h-${first.categoryId}`, heading: true, cells: { date: "", category: first.category.name, description: "", purpose: "", amount: null } });
    for (const entry of group) {
      rows.push({
        key: entry.id,
        color: entry.category.color,
        cells: {
          date: entry.date,
          category: entry.category.name,
          description: entry.description ?? "",
          // The purpose is the whole point of this report; say so when it is missing.
          purpose: entry.businessPurpose ?? "— chưa ghi mục đích —",
          amount: entry.amountCents,
        },
      });
    }
    rows.push({
      key: `sub-${first.categoryId}`,
      emphasis: true,
      cells: {
        date: "",
        category: `Cộng ${first.category.name}`,
        description: "",
        purpose: "",
        amount: sumCents(group.map((entry) => entry.amountCents)),
      },
    });
  }

  const total = sumCents(scoped.map((entry) => entry.amountCents));
  if (rows.length > 0) {
    rows.push({
      key: "total",
      emphasis: true,
      cells: { date: "", category: "Tổng chi phí được trừ", description: "", purpose: "", amount: total },
    });
  }

  const missingPurpose = scoped.filter((entry) => entry.businessPurpose === null).length;

  return {
    id: "deductible-summary",
    title: "Chi phí được trừ",
    subtitle: rangeSubtitle(context.from, context.to),
    columns: [
      { key: "date", label: "Ngày", kind: "date" },
      { key: "category", label: "Hạng mục", kind: "text" },
      { key: "description", label: "Diễn giải", kind: "text" },
      { key: "purpose", label: "Mục đích kinh doanh", kind: "text" },
      { key: "amount", label: "Số tiền", kind: "money" },
    ],
    rows,
    stats: [
      { label: "Tổng chi phí được trừ", value: total, kind: "money", tone: "neutral" },
      { label: "Số khoản", value: scoped.length, kind: "count", tone: "neutral" },
      {
        label: "Thiếu mục đích",
        value: missingPurpose,
        kind: "count",
        tone: missingPurpose > 0 ? "negative" : "neutral",
      },
    ],
    chart: { kind: "none" },
    empty: scoped.length === 0,
    emptyMessage: "Chưa có chi phí kinh doanh nào trong kỳ này.",
  };
}

// ---------------------------------------------------------------- entry point

export function buildReport(id: ReportId, context: ReportContext): ReportResult {
  switch (id) {
    case "monthly-summary":
      return buildMonthlySummary(context);
    case "category-breakdown":
      return buildCategoryBreakdown(context);
    case "account-statement":
      return buildAccountStatement(context);
    case "balance-history":
      return buildBalanceHistory(context);
    case "giving":
      return buildGiving(context);
    case "net-worth":
      return buildNetWorth(context);
    case "profit-loss":
      return buildProfitLoss(context);
    case "deductible-summary":
      return buildDeductibleSummary(context);
    default: {
      const exhaustive: never = id;
      throw new Error(`Unknown report: ${String(exhaustive)}`);
    }
  }
}

/** `Tong_hop_theo_thang_2026-09-01_2026-09-30` — safe on every filesystem. */
export function reportFileBase(id: ReportId, from: string, to: string): string {
  const label = reportDefinition(id).label;
  const ascii = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${ascii}_${from}_${to}`;
}

// ---------------------------------------------------------------- dashboard series

export type TrendPoint = { label: string; month: string; expense: number; income: number };

/** Last 12 months of spending for the trend line. */
export function spendingTrend(entries: readonly LedgerEntry[], endMonth: string, months: number = 12): TrendPoint[] {
  return monthRange(endMonth, months).map((month) => {
    const bucket = entries.filter((entry) => monthKey(entry.date) === month);
    const totals = totalsFor(bucket);
    return {
      label: formatMonthShort(month),
      month,
      expense: totals.expenseCents,
      income: totals.incomeCents,
    };
  });
}

export type ComparisonPoint = { category: string; color: string; current: number; previous: number };

/** Current month against the one before it, by expense category. */
export function monthlyComparison(entries: readonly LedgerEntry[], month: string): ComparisonPoint[] {
  const previous = previousMonthOf(month);
  const current = entriesInRange(entries, startOfMonth(month), endOfMonth(month));
  const before = entriesInRange(entries, startOfMonth(previous), endOfMonth(previous));

  const merged = new Map<string, ComparisonPoint>();
  for (const item of totalsByCategory(current, "expense")) {
    merged.set(item.id, { category: item.name, color: item.color, current: item.cents, previous: 0 });
  }
  for (const item of totalsByCategory(before, "expense")) {
    const known = merged.get(item.id);
    if (known) known.previous = item.cents;
    else merged.set(item.id, { category: item.name, color: item.color, current: 0, previous: item.cents });
  }

  return [...merged.values()].sort((a, b) => b.current + b.previous - (a.current + a.previous)).slice(0, 8);
}
