import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import {
  EmptyNote,
  FieldLabel,
  FinanceHeader,
  FinancePage,
  Panel,
  inputClass,
  selectChevron,
  selectClass,
} from "@/components/finance/primitives";
import {
  activeAccounts,
  addMonths,
  endOfMonth,
  formatDayVi,
  formatMoney,
  formatPercent,
  hasBusinessActivity,
  monthKey,
  startOfMonth,
  todayIso,
} from "@/lib/finance";
import { formatRate } from "@/lib/currency";
import { downloadReportCsv, downloadReportExcel } from "@/lib/finance-export";
import {
  REPORT_DEFINITIONS,
  buildReport,
  type ReportChart,
  type ReportId,
  type ReportResult,
} from "@/lib/finance-reports";
import { useLedger } from "@/lib/use-finance";
import { cn } from "@/lib/utils";

const AXIS = { stroke: "#6B635A", fontSize: 11 } as const;
const GRID = "#E6DFD3";

type Selection = {
  reportId: ReportId;
  from: string;
  to: string;
  accountId: string;
};

function ReportChartView({ chart, currency }: { chart: ReportChart; currency: string }) {
  if (chart.kind === "none") return null;

  const tooltip = (
    <Tooltip
      cursor={{ fill: "hsl(16 63% 92% / 0.4)", stroke: GRID }}
      formatter={(value: number | string) => (typeof value === "number" ? formatMoney(value, currency) : String(value))}
      contentStyle={{
        borderRadius: 10,
        border: "1px solid #E6DFD3",
        backgroundColor: "#FFFFFF",
        fontSize: 12.5,
      }}
    />
  );

  if (chart.kind === "pie") {
    if (chart.slices.length === 0) return null;
    const data = chart.slices.map((slice) => ({ name: slice.name, value: slice.valueCents, color: slice.color }));
    return (
      <div className="border-b border-border px-2 py-5">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" outerRadius={95} stroke="#FFFFFF" strokeWidth={2}>
              {data.map((item) => (
                <Cell key={item.name} fill={item.color} />
              ))}
            </Pie>
            {tooltip}
            <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 12, color: "#6B635A" }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (chart.points.length === 0) return null;

  const Chart = chart.kind === "bar" ? BarChart : LineChart;

  return (
    <div className="border-b border-border px-2 py-5">
      <ResponsiveContainer width="100%" height={260}>
        <Chart data={chart.points} margin={{ top: 6, right: 16, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={chart.xKey} tickLine={false} axisLine={{ stroke: GRID }} tick={AXIS} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={AXIS}
            width={58}
            tickFormatter={(value: number) => {
              const units = value / 100;
              if (Math.abs(units) >= 1000) return `${Math.round(units / 1000)}K`;
              return String(Math.round(units));
            }}
          />
          {tooltip}
          <Legend verticalAlign="top" height={26} wrapperStyle={{ fontSize: 12, color: "#6B635A" }} />
          {chart.series.map((series) =>
            chart.kind === "bar" ? (
              <Bar key={series.key} dataKey={series.key} name={series.name} fill={series.color} radius={[3, 3, 0, 0]} />
            ) : (
              <Line
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={series.name}
                stroke={series.color}
                strokeWidth={2}
                dot={false}
              />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

function ReportTable({ report, currency }: { report: ReportResult; currency: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[13.5px]">
        <thead>
          <tr className="border-b border-border bg-background/70">
            {report.columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "px-4 py-2.5 text-[12.5px] font-semibold uppercase tracking-wide text-muted-foreground",
                  column.kind === "money" || column.kind === "percent" ? "text-right" : "text-left",
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr
              key={row.key}
              className={cn(
                "border-b border-border last:border-b-0",
                row.heading && "bg-secondary/50",
                row.emphasis && "bg-accent/25",
              )}
            >
              {report.columns.map((column, index) => {
                const value = row.cells[column.key] ?? null;
                const numeric = column.kind === "money" || column.kind === "percent";
                return (
                  <td
                    key={column.key}
                    className={cn(
                      "px-4 py-2.5",
                      numeric ? "tabular text-right" : "text-left",
                      row.emphasis || row.heading ? "font-semibold text-foreground" : "text-foreground",
                    )}
                  >
                    {index === 0 && row.color !== undefined && !row.heading && !row.emphasis ? (
                      <span
                        aria-hidden="true"
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                        style={{ backgroundColor: row.color }}
                      />
                    ) : null}
                    {value === null || value === ""
                      ? ""
                      : column.kind === "money" && typeof value === "number"
                        ? formatMoney(value, currency)
                        : column.kind === "percent" && typeof value === "number"
                          ? formatPercent(value)
                          : column.kind === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
                            ? formatDayVi(value)
                            : String(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FinanceReports = () => {
  // Reports total across accounts, so they are built from the base-converted ledger. Every
  // report stays a pure function of "entries plus a range" — it never learns about rates.
  const { accounts, baseEntries, currency, rates, unvalued, isLoading } = useLedger();

  const today = todayIso();
  const thisMonth = monthKey(today);
  const open = useMemo(() => activeAccounts(accounts), [accounts]);
  const business = useMemo(() => hasBusinessActivity(baseEntries), [baseEntries]);

  const [draft, setDraft] = useState<Selection>({
    reportId: "monthly-summary",
    from: startOfMonth(thisMonth),
    to: today,
    accountId: "",
  });
  const [applied, setApplied] = useState<Selection | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // The account statement is meaningless without an account; pick the first one for them.
  useEffect(() => {
    if (draft.accountId === "" && open.length > 0) {
      setDraft((current) => (current.accountId === "" ? { ...current, accountId: open[0].id } : current));
    }
  }, [draft.accountId, open]);

  // Show something real on arrival rather than an empty frame asking to be clicked.
  useEffect(() => {
    if (applied === null && !isLoading) setApplied(draft);
  }, [applied, draft, isLoading]);

  const available = useMemo(
    () => REPORT_DEFINITIONS.filter((definition) => definition.kind === "personal" || business),
    [business],
  );

  const report = useMemo<ReportResult | null>(() => {
    if (applied === null) return null;
    return buildReport(applied.reportId, {
      entries: baseEntries,
      accounts,
      from: applied.from,
      to: applied.to,
      accountId: applied.accountId,
    });
  }, [accounts, applied, baseEntries]);

  /** The rates behind the figures, so a converted total can be checked rather than trusted. */
  const conversions = useMemo(() => {
    const used = new Set<string>();
    for (const account of open) {
      const code = account.currency.toUpperCase();
      if (code !== currency.toUpperCase()) used.add(code);
    }
    return [...used]
      .sort()
      .map((code) => ({ code, rate: formatRate(code, currency, rates) }))
      .filter((entry): entry is { code: string; rate: string } => entry.rate !== null);
  }, [open, currency, rates]);

  const applyPreset = useCallback(
    (preset: "this-month" | "last-month" | "this-year" | "last-12"): void => {
      const ranges: Record<typeof preset, { from: string; to: string }> = {
        "this-month": { from: startOfMonth(thisMonth), to: today },
        "last-month": {
          from: startOfMonth(addMonths(thisMonth, -1)),
          to: endOfMonth(addMonths(thisMonth, -1)),
        },
        "this-year": { from: `${today.slice(0, 4)}-01-01`, to: today },
        "last-12": { from: startOfMonth(addMonths(thisMonth, -11)), to: today },
      };
      setDraft((current) => ({ ...current, ...ranges[preset] }));
    },
    [thisMonth, today],
  );

  const handleCsv = useCallback((): void => {
    if (report === null || applied === null) return;
    const filename = downloadReportCsv(report, currency, applied.from, applied.to);
    toast.success(`Đã tải ${filename}`);
  }, [applied, currency, report]);

  const handleExcel = useCallback(async (): Promise<void> => {
    if (report === null || applied === null) return;
    setIsExporting(true);
    try {
      const filename = await downloadReportExcel(report, currency, applied.from, applied.to);
      toast.success(`Đã tải ${filename}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không tạo được file Excel.");
    } finally {
      setIsExporting(false);
    }
  }, [applied, currency, report]);

  const definition = available.find((item) => item.id === draft.reportId) ?? available[0];
  const rangeInvalid = draft.from > draft.to;

  return (
    <FinancePage>
      <FinanceHeader subtitle="Tám báo cáo, tải về CSV hoặc Excel để giữ trên máy của bạn." />

      <div className="mt-6">
        <Panel title="Chọn báo cáo">
          <div className="grid gap-4 px-5 py-5 md:grid-cols-2 lg:grid-cols-4">
            <div className="md:col-span-2">
              <FieldLabel htmlFor="report-type" required>
                Báo cáo
              </FieldLabel>
              <select
                id="report-type"
                value={draft.reportId}
                onChange={(event) => setDraft((current) => ({ ...current, reportId: event.target.value as ReportId }))}
                className={cn(selectClass, "mt-1.5")}
                style={{ backgroundImage: selectChevron }}
              >
                {available.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                    {item.kind === "business" ? " (kinh doanh)" : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">{definition?.description}</p>
            </div>

            <div>
              <FieldLabel htmlFor="report-from" required>
                Từ ngày
              </FieldLabel>
              <input
                id="report-from"
                type="date"
                value={draft.from}
                onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
                className={cn(inputClass, "mt-1.5", rangeInvalid && "border-money-out")}
              />
            </div>

            <div>
              <FieldLabel htmlFor="report-to" required>
                Đến ngày
              </FieldLabel>
              <input
                id="report-to"
                type="date"
                value={draft.to}
                onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
                className={cn(inputClass, "mt-1.5", rangeInvalid && "border-money-out")}
              />
            </div>

            {definition?.needsAccount ? (
              <div className="md:col-span-2">
                <FieldLabel htmlFor="report-account" required>
                  Tài khoản
                </FieldLabel>
                <select
                  id="report-account"
                  value={draft.accountId}
                  onChange={(event) => setDraft((current) => ({ ...current, accountId: event.target.value }))}
                  className={cn(selectClass, "mt-1.5")}
                  style={{ backgroundImage: selectChevron }}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                      {account.deletedAt !== null ? " (đã đóng)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="md:col-span-2 lg:col-span-4">
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    ["this-month", "Tháng này"],
                    ["last-month", "Tháng trước"],
                    ["this-year", "Từ đầu năm"],
                    ["last-12", "12 tháng"],
                  ] as const
                ).map(([preset, label]) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="press rounded-full border border-border px-3.5 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                  >
                    {label}
                  </button>
                ))}

                <button
                  type="button"
                  disabled={rangeInvalid}
                  onClick={() => setApplied(draft)}
                  className={cn(
                    "press ml-auto rounded-md px-5 py-2.5 text-[14px] font-semibold transition-colors",
                    rangeInvalid
                      ? "cursor-not-allowed bg-primary/35 text-primary-foreground"
                      : "bg-primary text-primary-foreground hover:bg-primary/92",
                  )}
                >
                  Tạo báo cáo
                </button>
              </div>
              {rangeInvalid ? (
                <p className="mt-2 text-[12.5px] text-money-out">Ngày bắt đầu phải trước ngày kết thúc.</p>
              ) : null}
            </div>
          </div>
        </Panel>
      </div>

      {report !== null ? (
        <div className="mt-3">
          <Panel>
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-[18px] font-semibold tracking-tight text-foreground">{report.title}</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{report.subtitle}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCsv}
                  disabled={report.empty}
                  className="press inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-[13.5px] font-medium text-foreground transition-colors hover:bg-accent/35 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-4 w-4" strokeWidth={1.8} />
                  CSV
                </button>
                <button
                  type="button"
                  onClick={() => void handleExcel()}
                  disabled={report.empty || isExporting}
                  className="press inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-[13.5px] font-medium text-foreground transition-colors hover:bg-accent/35 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isExporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="h-4 w-4" strokeWidth={1.8} />
                  )}
                  Excel
                </button>
              </div>
            </header>

            {conversions.length > 0 ? (
              <p className="border-b border-border bg-background/40 px-5 py-2.5 text-[12.5px] text-muted-foreground">
                Quy đổi sang {currency}:{" "}
                {conversions.map((entry, index) => (
                  <span key={entry.code}>
                    {index > 0 ? " · " : ""}
                    <span className="tabular">
                      1 {entry.code} = {entry.rate} {currency}
                    </span>
                  </span>
                ))}
              </p>
            ) : null}

            {unvalued.length > 0 ? (
              <p className="border-b border-border px-5 py-2.5 text-[12.5px] text-task-overdue">
                {unvalued.length} giao dịch chưa có tỷ giá nên không nằm trong báo cáo này.
              </p>
            ) : null}

            {report.empty ? (
              <EmptyNote>{report.emptyMessage}</EmptyNote>
            ) : (
              <>
                {report.stats.length > 0 ? (
                  <div className="grid gap-3 border-b border-border px-5 py-4 sm:grid-cols-3">
                    {report.stats.map((stat) => (
                      <div key={stat.label}>
                        <p className="text-[12.5px] font-medium text-muted-foreground">{stat.label}</p>
                        <p
                          className={cn(
                            "tabular mt-0.5 text-[19px] font-semibold tracking-tight",
                            stat.tone === "positive" && "text-money-in",
                            stat.tone === "negative" && "text-money-out",
                            (stat.tone === "neutral" || stat.tone === undefined) && "text-foreground",
                          )}
                        >
                          {stat.value === null
                            ? "—"
                            : stat.kind === "percent"
                              ? formatPercent(stat.value)
                              : stat.kind === "count"
                                ? String(stat.value)
                                : formatMoney(stat.value, currency)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}

                <ReportChartView chart={report.chart} currency={currency} />
                <ReportTable report={report} currency={currency} />
              </>
            )}
          </Panel>
        </div>
      ) : null}

      {!business ? (
        <p className="mt-4 text-[13px] text-muted-foreground">
          Báo cáo lãi lỗ và Chi phí được trừ sẽ tự xuất hiện khi bạn đánh dấu giao dịch đầu tiên là kinh doanh.
        </p>
      ) : null}
    </FinancePage>
  );
};

export default FinanceReports;
