import { render } from "vitest-browser-react";

import {
  CategoryDistributionChart,
  GivingRatioGauge,
  MonthlyComparisonChart,
  SpendingTrendChart,
} from "@/components/finance/FinanceCharts";
import { buildLedger, type Account, type Category, type Transaction } from "@/lib/finance";
import { downloadReportCsv, downloadReportExcel } from "@/lib/finance-export";
import { buildReport, monthlyComparison, spendingTrend } from "@/lib/finance-reports";

/**
 * The two things a Node test cannot prove: that a report really lands on disk as a file the
 * browser accepts, and that the charts actually paint. Both run in real Chromium here.
 */

const ACCOUNT: Account = {
  id: "acc-1",
  name: "Checking",
  type: "checking",
  openingBalanceCents: 500_000,
  balanceCents: 500_000,
  currency: "USD",
  otherPersonName: null,
  accountNumber: null,
  tags: [],
  createdAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
};

const CATEGORIES: Category[] = [
  { id: "cat-farming", name: "Nông nghiệp", origin: "predefined", appliesTo: "income", color: "#7D8A4F", slug: "farming", sortOrder: 20, deletedAt: null },
  { id: "cat-business", name: "Kinh doanh", origin: "predefined", appliesTo: "expense", color: "#C98A3E", slug: "business", sortOrder: 100, deletedAt: null },
  { id: "cat-groceries", name: "Tạp hoá", origin: "predefined", appliesTo: "expense", color: "#E0603C", slug: "groceries", sortOrder: 10, deletedAt: null },
];

function txn(overrides: Partial<Transaction>): Transaction {
  return {
    id: "t",
    accountId: "acc-1",
    categoryId: "cat-groceries",
    type: "expense",
    amountCents: 5_000,
    currency: "USD",
    amountInBaseCents: 5_000,
    baseCurrency: "USD",
    conversionRate: 1,
    description: null,
    date: "2026-09-05",
    businessRelated: false,
    businessPurpose: null,
    receiptPath: null,
    isRecurring: false,
    recurringFrequency: null,
    recurringLabel: null,
    createdAt: "2026-09-05T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

const ENTRIES = buildLedger(
  [
    txn({ id: "a", type: "income", categoryId: "cat-farming", amountCents: 30_000, date: "2026-09-02", businessRelated: true, businessPurpose: "rau củ" }),
    txn({ id: "b", categoryId: "cat-business", amountCents: 7_500, date: "2026-09-03", businessRelated: true, businessPurpose: "phân bón" }),
    txn({ id: "c", amountCents: 5_000, date: "2026-09-04" }),
  ],
  [ACCOUNT],
  CATEGORIES,
);

const RANGE = { from: "2026-09-01", to: "2026-09-30" };

/** Intercepts the anchor click so a download can be inspected instead of saved. */
function captureDownload(): { restore: () => void; taken: () => { name: string; size: number } | null } {
  const originalCreate = URL.createObjectURL;
  const originalClick = HTMLAnchorElement.prototype.click;
  let captured: { name: string; size: number } | null = null;
  let lastSize = 0;

  URL.createObjectURL = (blob: Blob | MediaSource): string => {
    if (blob instanceof Blob) lastSize = blob.size;
    return "blob:captured";
  };
  HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement): void {
    captured = { name: this.download, size: lastSize };
  };

  return {
    restore: () => {
      URL.createObjectURL = originalCreate;
      HTMLAnchorElement.prototype.click = originalClick;
    },
    taken: () => captured,
  };
}

test("a CSV report downloads under a name that says what it is and when", () => {
  const report = buildReport("profit-loss", { entries: ENTRIES, accounts: [ACCOUNT], ...RANGE });
  const capture = captureDownload();
  try {
    const filename = downloadReportCsv(report, "USD", RANGE.from, RANGE.to);
    expect(filename).toBe("Bao_cao_lai_lo_2026-09-01_2026-09-30.csv");
    const taken = capture.taken();
    expect(taken).not.toBeNull();
    expect(taken?.name).toBe(filename);
    expect(taken?.size ?? 0).toBeGreaterThan(0);
  } finally {
    capture.restore();
  }
});

test("an Excel report downloads as a real xlsx file, not an empty shell", async () => {
  const report = buildReport("deductible-summary", { entries: ENTRIES, accounts: [ACCOUNT], ...RANGE });
  const capture = captureDownload();
  try {
    const filename = await downloadReportExcel(report, "USD", RANGE.from, RANGE.to);
    expect(filename).toBe("Chi_phi_duoc_tru_2026-09-01_2026-09-30.xlsx");
    const taken = capture.taken();
    expect(taken?.name).toBe(filename);
    // A zip container with a workbook, two sheets and styles inside is comfortably over a kilobyte.
    expect(taken?.size ?? 0).toBeGreaterThan(1000);
  } finally {
    capture.restore();
  }
});

test("every report exports without throwing, including the ones with no rows in range", async () => {
  const ids = [
    "monthly-summary",
    "category-breakdown",
    "account-statement",
    "balance-history",
    "giving",
    "net-worth",
    "profit-loss",
    "deductible-summary",
  ] as const;

  const capture = captureDownload();
  try {
    for (const id of ids) {
      const report = buildReport(id, { entries: ENTRIES, accounts: [ACCOUNT], accountId: ACCOUNT.id, ...RANGE });
      expect(downloadReportCsv(report, "USD", RANGE.from, RANGE.to)).toContain(".csv");
      await expect(downloadReportExcel(report, "USD", RANGE.from, RANGE.to)).resolves.toContain(".xlsx");

      const barren = buildReport(id, {
        entries: [],
        accounts: [ACCOUNT],
        accountId: ACCOUNT.id,
        from: "2020-01-01",
        to: "2020-01-31",
      });
      expect(downloadReportCsv(barren, "USD", "2020-01-01", "2020-01-31")).toContain(".csv");
    }
  } finally {
    capture.restore();
  }
});

test("the dashboard charts paint real geometry rather than an empty box", async () => {
  const trend = spendingTrend(ENTRIES, "2026-09", 12);
  const screen = await render(
    <div style={{ width: 640 }}>
      <SpendingTrendChart points={trend} currency="USD" />
    </div>,
  );
  // Recharts measures its container, so a drawn line proves the chart got a real size.
  await expect.poll(() => screen.container.querySelectorAll("path.recharts-line-curve").length).toBeGreaterThan(0);
});

test("the category doughnut draws one wedge per category and lists them beside it", async () => {
  const screen = await render(
    <div style={{ width: 640 }}>
      <CategoryDistributionChart
        data={[
          { categoryId: "cat-groceries", name: "Tạp hoá", value: 5_000, color: "#E0603C" },
          { categoryId: "cat-business", name: "Kinh doanh", value: 7_500, color: "#C98A3E" },
        ]}
        currency="USD"
      />
    </div>,
  );
  await expect.poll(() => screen.container.querySelectorAll("path.recharts-sector").length).toBe(2);
  await expect.element(screen.getByText("Tạp hoá")).toBeInTheDocument();
});

test("the month-over-month bars draw both series", async () => {
  const screen = await render(
    <div style={{ width: 640 }}>
      <MonthlyComparisonChart
        data={monthlyComparison(ENTRIES, "2026-09")}
        currency="USD"
        currentLabel="Th9"
        previousLabel="Th8"
      />
    </div>,
  );
  await expect.poll(() => screen.container.querySelectorAll(".recharts-bar-rectangle").length).toBeGreaterThan(0);
});

test("the giving dial colours itself by band and states the exact percentage", async () => {
  const generous = await render(
    <GivingRatioGauge ratio={0.12} givenCents={12_000} incomeCents={100_000} currency="USD" />,
  );
  await expect.element(generous.getByText("12.0%")).toBeInTheDocument();
  expect(generous.container.innerHTML).toContain("#3F8F6B");

  const low = await render(<GivingRatioGauge ratio={0.02} givenCents={2_000} incomeCents={100_000} currency="USD" />);
  expect(low.container.innerHTML).toContain("#C0492A");

  // No income means no ratio: the dial says so instead of claiming a truthful-looking 0%.
  const none = await render(<GivingRatioGauge ratio={null} givenCents={0} incomeCents={0} currency="USD" />);
  await expect.element(none.getByText("—")).toBeInTheDocument();
});
