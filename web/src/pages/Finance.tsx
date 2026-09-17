import { Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  AccountBalanceChart,
  BusinessDashboard,
  CategoryDistributionChart,
  GivingRatioGauge,
  MonthlyComparisonChart,
  SpendingTrendChart,
  type PieDatum,
} from "@/components/finance/FinanceCharts";
import { DueStrip } from "@/components/finance/DueStrip";
import { TransactionForm } from "@/components/finance/TransactionForm";
import { CategoryDialog } from "@/components/finance/dialogs";
import { FinanceHeader, FinancePage, Money, Panel, StatCard } from "@/components/finance/primitives";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  activeAccounts,
  addMonths,
  endOfMonth,
  entriesInRange,
  formatMonthShort,
  givingRatio,
  hasBusinessActivity,
  hasOpenObligations,
  isLiabilityAccount,
  monthKey,
  netWorthInBase,
  obligationAttention,
  obligationPosition,
  startOfMonth,
  todayIso,
  totalsFor,
  withObligationPosition,
  type CategoryScope,
  type ObligationWindow,
} from "@/lib/finance";
import { convertCents } from "@/lib/currency";
import { monthlyComparison, spendingTrend } from "@/lib/finance-reports";
import { useLedger } from "@/lib/use-finance";

/**
 * The finance dashboard: four numbers that answer "how am I doing", then the charts that
 * explain them. Everything reads the same ledger, so no two figures can disagree.
 */
const Finance = () => {
  const navigate = useNavigate();
  // Totals and charts read `baseEntries`: every figure on this screen is a sum across
  // accounts, and adding VND to USD would produce a number that means nothing.
  const { accounts, categories, entries, baseEntries, currency, rates, unvalued, isLoading, error } =
    useLedger();

  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [categoryScope, setCategoryScope] = useState<CategoryScope | null>(null);

  const today = todayIso();
  const thisMonth = monthKey(today);
  const open = useMemo(() => activeAccounts(accounts), [accounts]);

  const monthEntries = useMemo(
    () => entriesInRange(baseEntries, startOfMonth(thisMonth), endOfMonth(thisMonth)),
    [baseEntries, thisMonth],
  );
  const monthTotals = useMemo(() => totalsFor(monthEntries), [monthEntries]);
  const allTotals = useMemo(() => totalsFor(baseEntries), [baseEntries]);

  // Accounts first, exactly as before, then what is still owed each way folded on top: the
  // account-based figure keeps its own meaning and the two can never be mixed up.
  const accountNetWorth = useMemo(
    () => netWorthInBase(accounts, entries, today, currency, rates),
    [accounts, entries, today, currency, rates],
  );
  const position = useMemo(() => obligationPosition(baseEntries), [baseEntries]);
  const netWorth = useMemo(
    () => withObligationPosition(accountNetWorth, position),
    [accountNetWorth, position],
  );

  const attention = useMemo(() => obligationAttention(baseEntries, today), [baseEntries, today]);
  const anyObligations = useMemo(() => hasOpenObligations(baseEntries), [baseEntries]);
  const assetsOnly = useMemo(
    () =>
      open
        .filter((account) => !isLiabilityAccount(account.type))
        .reduce((sum, account) => sum + (convertCents(account.balanceCents, account.currency, currency, rates) ?? 0), 0),
    [open, currency, rates],
  );

  const business = hasBusinessActivity(baseEntries);

  const trend = useMemo(() => spendingTrend(baseEntries, thisMonth, 12), [baseEntries, thisMonth]);
  const comparison = useMemo(() => monthlyComparison(baseEntries, thisMonth), [baseEntries, thisMonth]);

  const pie = useMemo<PieDatum[]>(() => {
    const totals = new Map<string, PieDatum>();
    for (const entry of monthEntries) {
      if (entry.type !== "expense") continue;
      const known = totals.get(entry.categoryId);
      if (known) known.value += entry.amountCents;
      else
        totals.set(entry.categoryId, {
          categoryId: entry.categoryId,
          name: entry.category.name,
          value: entry.amountCents,
          color: entry.category.color,
        });
    }
    return [...totals.values()].sort((a, b) => b.value - a.value);
  }, [monthEntries]);

  const businessTrend = useMemo(
    () =>
      trend.map((point) => {
        const bucket = baseEntries.filter(
          (entry) => monthKey(entry.date) === point.month && entry.businessRelated,
        );
        const revenue = bucket
          .filter((entry) => entry.type === "income")
          .reduce((sum, entry) => sum + entry.amountCents, 0);
        const cost = bucket
          .filter((entry) => entry.type === "expense")
          .reduce((sum, entry) => sum + entry.amountCents, 0);
        return { label: point.label, revenue, cost, profit: revenue - cost };
      }),
    [baseEntries, trend],
  );

  const goToTransactions = useCallback(
    (params: Record<string, string>): void => {
      navigate(`/ket-sat/giao-dich?${new URLSearchParams(params).toString()}`);
    },
    [navigate],
  );

  const openDue = useCallback(
    (window: ObligationWindow): void => {
      goToTransactions({ can_lam: window });
    },
    [goToTransactions],
  );

  return (
    <FinancePage>
      <FinanceHeader
        subtitle={
          isLoading
            ? "Đang tải sổ của bạn…"
            : open.length === 0
              ? "Bắt đầu bằng một tài khoản, rồi ghi khoản thu chi đầu tiên."
              : "Thu chi cá nhân và kinh doanh hộ gia đình, trong một cuốn sổ."
        }
        action={
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            disabled={open.length === 0}
            className="press inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:cursor-not-allowed disabled:bg-primary/35"
          >
            <Plus className="h-4 w-4" strokeWidth={2.2} />
            Thêm giao dịch
          </button>
        }
      />

      {error !== null ? (
        <p className="mt-6 rounded-xl border border-border bg-card px-5 py-4 text-[14px] text-money-out">
          {error.message}
        </p>
      ) : null}

      {open.length === 0 && !isLoading ? (
        <Panel className="mt-6">
          <div className="px-6 py-12 text-center">
            <p className="text-[16px] font-semibold text-foreground">Sổ của bạn còn trống</p>
            <p className="mx-auto mt-2 max-w-md text-[14px] text-muted-foreground">
              Tạo tài khoản đầu tiên — tiền mặt, tài khoản ngân hàng, hay cả tiền đang gửi ở nhà người thân — rồi
              bắt đầu ghi thu chi.
            </p>
            <button
              type="button"
              onClick={() => navigate("/ket-sat/tai-khoan")}
              className="press mt-5 rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92"
            >
              Tạo tài khoản
            </button>
          </div>
        </Panel>
      ) : (
        <>
          {anyObligations ? <DueStrip attention={attention} onOpen={openDue} /> : null}

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Tổng tài sản"
              value={<Money cents={assetsOnly} currency={currency} tone="ink" />}
              hint={`${open.length} tài khoản đang mở`}
            />
            <StatCard
              label="Thu tháng này"
              value={<Money cents={monthTotals.incomeCents} currency={currency} tone="in" />}
              hint={formatMonthShort(thisMonth)}
              tone="in"
            />
            <StatCard
              label="Chi tháng này"
              value={<Money cents={monthTotals.expenseCents} currency={currency} tone="out" />}
              hint={
                monthTotals.netCents >= 0
                  ? `Còn dư ${Math.abs(monthTotals.netCents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                  : "Chi nhiều hơn thu"
              }
              tone="out"
            />
            <StatCard
              label="Giá trị ròng"
              value={<Money cents={netWorth.netCents} currency={currency} tone="ink" />}
              hint={
                netWorth.liabilitiesCents > 0 ? (
                  <>
                    Đã trừ nợ <Money cents={netWorth.liabilitiesCents} currency={currency} tone="muted" />
                    {position.receivableCents > 0 ? (
                      <>
                        {" · đã cộng "}
                        <Money cents={position.receivableCents} currency={currency} tone="muted" /> cho vay
                      </>
                    ) : null}
                  </>
                ) : position.receivableCents > 0 ? (
                  <>
                    Đã cộng <Money cents={position.receivableCents} currency={currency} tone="muted" /> cho vay
                    chưa thu về
                  </>
                ) : (
                  "Không có khoản nợ nào"
                )
              }
            />
          </div>

          {business ? (
            <div className="mt-3">
              <BusinessDashboard
                incomeCents={allTotals.businessIncomeCents}
                expenseCents={allTotals.businessExpenseCents}
                profitCents={allTotals.grossProfitCents}
                trend={businessTrend}
                currency={currency}
              />
            </div>
          ) : null}

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <SpendingTrendChart
              points={trend}
              currency={currency}
              onSelectMonth={(month) => goToTransactions({ thang: month })}
            />
            <CategoryDistributionChart
              data={pie}
              currency={currency}
              onSelectCategory={(categoryId) => goToTransactions({ hang_muc: categoryId, thang: thisMonth })}
            />
            <AccountBalanceChart
              accounts={open}
              entries={entries}
              from={startOfMonth(addMonths(thisMonth, -5))}
              to={today}
              currency={currency}
            />
            <MonthlyComparisonChart
              data={comparison}
              currency={currency}
              currentLabel={formatMonthShort(thisMonth)}
              previousLabel={formatMonthShort(addMonths(thisMonth, -1))}
            />
            <GivingRatioGauge
              ratio={givingRatio(allTotals)}
              givenCents={allTotals.givingCents}
              incomeCents={allTotals.incomeCents}
              currency={currency}
            />
            {!business ? (
              <Panel title="Kinh doanh hộ gia đình">
                <div className="px-5 py-8">
                  <p className="text-[14px] text-muted-foreground">
                    Nếu nhà bạn có làm nông, cho thuê hay nghề thủ công, hãy tích{" "}
                    <span className="font-medium text-foreground">“Giao dịch này thuộc việc kinh doanh”</span> khi ghi
                    sổ. AVORA sẽ tự mở bảng lãi lỗ và danh sách chi phí được trừ.
                  </p>
                </div>
              </Panel>
            ) : null}
          </div>
        </>
      )}

      <Dialog open={isAdding} onOpenChange={setIsAdding}>
        <DialogContent className="max-w-[640px] p-0">
          <div className="border-b border-border px-5 py-4">
            <DialogTitle className="text-[20px] font-semibold tracking-tight">Thêm giao dịch</DialogTitle>
            <DialogDescription className="text-[14px] text-muted-foreground">
              Một biểu mẫu cho cả khoản thu và khoản chi.
            </DialogDescription>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            <TransactionForm
              accounts={accounts}
              categories={categories}
              onDone={() => setIsAdding(false)}
              onCancel={() => setIsAdding(false)}
              onRequestCategory={(scope) => setCategoryScope(scope)}
            />
          </div>
        </DialogContent>
      </Dialog>

      <CategoryDialog
        open={categoryScope !== null}
        onOpenChange={(next) => {
          if (!next) setCategoryScope(null);
        }}
        categories={categories}
        editing={null}
        defaultScope={categoryScope ?? "expense"}
      />
    </FinancePage>
  );
};

export default Finance;
