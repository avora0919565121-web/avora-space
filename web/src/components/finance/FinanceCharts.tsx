import { useMemo } from "react";
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

import { Money, Panel } from "@/components/finance/primitives";
import {
  GIVING_BAND_COLORS,
  GIVING_BAND_LABELS,
  formatMoney,
  givingBand,
  type Account,
  type LedgerEntry,
} from "@/lib/finance";
import { balanceCheckpoints, CHART_PALETTE, type ComparisonPoint, type TrendPoint } from "@/lib/finance-reports";
import { balanceAt, formatDayVi } from "@/lib/finance";

/**
 * Six charts in one warm, printed palette. Every one of them names an exact amount on
 * hover — a chart that can only be squinted at is decoration, not information.
 */

const AXIS = { stroke: "#6B635A", fontSize: 11 } as const;
const GRID = "#E6DFD3";

/** Compact axis labels: 12.5K instead of 12,500 so the ticks stay legible. */
function compactAxis(cents: number, currency: string): string {
  const units = cents / 100;
  const abs = Math.abs(units);
  if (abs >= 1_000_000) return `${(units / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(units / 1_000)}K`;
  return formatMoney(cents, currency).replace(/[^\d.,\-−]/g, "");
}

type TooltipRow = { name: string; value: number; color: string };

function PaperTooltip({
  active,
  label,
  rows,
  currency,
}: {
  active: boolean;
  label: string;
  rows: TooltipRow[];
  currency: string;
}) {
  if (!active || rows.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[12px] font-semibold text-foreground">{label}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center gap-2 text-[12.5px]">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
            <span className="text-muted-foreground">{row.name}</span>
            <span className="tabular ml-auto font-semibold text-foreground">{formatMoney(row.value, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type RechartsTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: { name?: string | number; value?: number | string; color?: string; payload?: Record<string, unknown> }[];
};

function makeTooltip(currency: string) {
  return function RenderTooltip({ active, label, payload }: RechartsTooltipProps) {
    const rows: TooltipRow[] = (payload ?? [])
      .filter((item) => typeof item.value === "number")
      .map((item) => ({
        name: String(item.name ?? ""),
        value: Number(item.value),
        color: item.color ?? "#6B635A",
      }));
    return <PaperTooltip active={Boolean(active)} label={String(label ?? "")} rows={rows} currency={currency} />;
  };
}

function ChartEmpty({ children }: { children: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center px-6">
      <p className="text-center text-[13.5px] text-muted-foreground">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------- 1. spending trend

export function SpendingTrendChart({
  points,
  currency,
  onSelectMonth,
}: {
  points: readonly TrendPoint[];
  currency: string;
  onSelectMonth?: (month: string) => void;
}) {
  const hasData = points.some((point) => point.expense > 0);
  const Tip = useMemo(() => makeTooltip(currency), [currency]);

  return (
    <Panel title="Xu hướng chi tiêu">
      {!hasData ? (
        <ChartEmpty>Chưa đủ dữ liệu để vẽ xu hướng. Ghi vài khoản chi rồi quay lại.</ChartEmpty>
      ) : (
        <div className="px-2 py-4">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart
              data={[...points]}
              margin={{ top: 6, right: 14, bottom: 0, left: 4 }}
              onClick={(state) => {
                const index = typeof state?.activeTooltipIndex === "number" ? state.activeTooltipIndex : -1;
                if (index >= 0 && points[index] && onSelectMonth) onSelectMonth(points[index].month);
              }}
            >
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={AXIS} />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={AXIS}
                width={52}
                tickFormatter={(value: number) => compactAxis(value, currency)}
              />
              <Tooltip content={<Tip />} cursor={{ stroke: GRID }} />
              <Line
                type="monotone"
                dataKey="expense"
                name="Chi"
                stroke="#E0603C"
                strokeWidth={2}
                dot={{ r: 2.5, fill: "#E0603C", strokeWidth: 0 }}
                activeDot={{ r: 4.5 }}
              />
            </LineChart>
          </ResponsiveContainer>
          <p className="px-3 pt-1 text-[12px] text-muted-foreground">12 tháng gần nhất · bấm vào một tháng để xem giao dịch</p>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- 2. category distribution

export type PieDatum = { name: string; value: number; color: string; categoryId: string };

export function CategoryDistributionChart({
  data,
  currency,
  onSelectCategory,
}: {
  data: readonly PieDatum[];
  currency: string;
  onSelectCategory?: (categoryId: string) => void;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <Panel title="Cơ cấu chi tiêu">
      {data.length === 0 ? (
        <ChartEmpty>Chưa có khoản chi nào trong tháng này.</ChartEmpty>
      ) : (
        <div className="grid gap-2 px-4 py-4 sm:grid-cols-[200px_1fr] sm:items-center">
          <ResponsiveContainer width="100%" height={190}>
            <PieChart>
              <Pie
                data={[...data]}
                dataKey="value"
                nameKey="name"
                innerRadius={46}
                outerRadius={78}
                paddingAngle={1.5}
                stroke="#FFFFFF"
                strokeWidth={2}
                onClick={(entry: unknown) => {
                  const datum = entry as PieDatum | undefined;
                  if (datum?.categoryId && onSelectCategory) onSelectCategory(datum.categoryId);
                }}
              >
                {data.map((item) => (
                  <Cell key={item.categoryId} fill={item.color} cursor={onSelectCategory ? "pointer" : "default"} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }: RechartsTooltipProps) => {
                  const first = payload?.[0];
                  if (!active || !first || typeof first.value !== "number") return null;
                  const share = total > 0 ? (first.value / total) * 100 : 0;
                  return (
                    <div className="rounded-md border border-border bg-card px-3 py-2">
                      <p className="text-[12px] font-semibold text-foreground">{String(first.name ?? "")}</p>
                      <p className="tabular mt-0.5 text-[13px] text-foreground">
                        {formatMoney(first.value, currency)}{" "}
                        <span className="text-muted-foreground">· {share.toFixed(1)}%</span>
                      </p>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>

          <ul className="space-y-1.5 pr-1">
            {data.slice(0, 7).map((item) => (
              <li key={item.categoryId}>
                <button
                  type="button"
                  onClick={() => onSelectCategory?.(item.categoryId)}
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-accent/35"
                >
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: item.color }} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{item.name}</span>
                  <span className="tabular shrink-0 text-[12.5px] text-muted-foreground">
                    {total > 0 ? `${((item.value / total) * 100).toFixed(0)}%` : "—"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- 3. account balance

export function AccountBalanceChart({
  accounts,
  entries,
  from,
  to,
  currency,
}: {
  accounts: readonly Account[];
  entries: readonly LedgerEntry[];
  from: string;
  to: string;
  currency: string;
}) {
  const Tip = useMemo(() => makeTooltip(currency), [currency]);

  const points = useMemo(() => {
    const checkpoints = balanceCheckpoints(entries, from, to);
    return checkpoints.map((date) => {
      const point: Record<string, string | number> = { label: formatDayVi(date).slice(0, 5) };
      for (const account of accounts) point[account.id] = balanceAt(account, entries, date);
      return point;
    });
  }, [accounts, entries, from, to]);

  return (
    <Panel title="Số dư tài khoản">
      {accounts.length === 0 ? (
        <ChartEmpty>Chưa có tài khoản nào để theo dõi.</ChartEmpty>
      ) : (
        <div className="px-2 py-4">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={points} margin={{ top: 6, right: 14, bottom: 0, left: 4 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={AXIS} />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={AXIS}
                width={52}
                tickFormatter={(value: number) => compactAxis(value, currency)}
              />
              <Tooltip content={<Tip />} cursor={{ stroke: GRID }} />
              {accounts.length > 1 ? (
                <Legend
                  verticalAlign="bottom"
                  height={26}
                  iconType="plainline"
                  wrapperStyle={{ fontSize: 12, color: "#6B635A" }}
                />
              ) : null}
              {accounts.map((account, index) => (
                <Line
                  key={account.id}
                  type="monotone"
                  dataKey={account.id}
                  name={account.name}
                  stroke={CHART_PALETTE[index % CHART_PALETTE.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- 4. monthly comparison

export function MonthlyComparisonChart({
  data,
  currency,
  currentLabel,
  previousLabel,
}: {
  data: readonly ComparisonPoint[];
  currency: string;
  currentLabel: string;
  previousLabel: string;
}) {
  const Tip = useMemo(() => makeTooltip(currency), [currency]);

  return (
    <Panel title="So sánh với tháng trước">
      {data.length === 0 ? (
        <ChartEmpty>Chưa có khoản chi nào trong hai tháng gần đây.</ChartEmpty>
      ) : (
        <div className="px-2 py-4">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={[...data]} margin={{ top: 6, right: 14, bottom: 0, left: 4 }} barGap={2}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis
                dataKey="category"
                tickLine={false}
                axisLine={{ stroke: GRID }}
                tick={AXIS}
                interval={0}
                height={44}
                angle={-22}
                textAnchor="end"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={AXIS}
                width={52}
                tickFormatter={(value: number) => compactAxis(value, currency)}
              />
              <Tooltip content={<Tip />} cursor={{ fill: "hsl(16 63% 92% / 0.5)" }} />
              <Legend verticalAlign="top" height={26} wrapperStyle={{ fontSize: 12, color: "#6B635A" }} />
              <Bar dataKey="previous" name={previousLabel} fill="#D9CFBE" radius={[3, 3, 0, 0]} />
              <Bar dataKey="current" name={currentLabel} fill="#E0603C" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- 5. giving ratio gauge

/**
 * A half-dial rather than a bar: generosity is a proportion of a whole, and the arc says
 * so at a glance. Colour carries the verdict, the number carries the fact.
 */
export function GivingRatioGauge({
  ratio,
  givenCents,
  incomeCents,
  currency,
}: {
  ratio: number | null;
  givenCents: number;
  incomeCents: number;
  currency: string;
}) {
  const band = givingBand(ratio);
  const color = GIVING_BAND_COLORS[band];
  // The dial is full at 15%: beyond that the exact figure matters more than the sweep.
  const swept = Math.min(Math.max(ratio ?? 0, 0), 0.15) / 0.15;

  const radius = 68;
  const circumference = Math.PI * radius;
  const cx = 88;
  const cy = 80;
  const arc = `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`;

  return (
    <Panel title="Tỉ lệ dâng hiến">
      <div className="flex flex-col items-center px-5 py-5">
        <svg width="176" height="96" viewBox="0 0 176 96" role="img" aria-label={`Tỉ lệ dâng hiến ${ratio === null ? "chưa có" : `${(ratio * 100).toFixed(1)}%`}`}>
          <path d={arc} fill="none" stroke="#EFE7DA" strokeWidth={13} strokeLinecap="round" />
          <path
            d={arc}
            fill="none"
            stroke={color}
            strokeWidth={13}
            strokeLinecap="round"
            strokeDasharray={`${circumference * swept} ${circumference}`}
            style={{ transition: "stroke-dasharray 600ms cubic-bezier(0.16,1,0.3,1)" }}
          />
          {/* 5% and 10% are the boundaries the colour changes on; mark them on the dial. */}
          {[0.05, 0.1].map((mark) => {
            const angle = Math.PI * (1 - mark / 0.15);
            return (
              <line
                key={mark}
                x1={cx + Math.cos(angle) * (radius - 8)}
                y1={cy - Math.sin(angle) * (radius - 8)}
                x2={cx + Math.cos(angle) * (radius + 8)}
                y2={cy - Math.sin(angle) * (radius + 8)}
                stroke="#FFFFFF"
                strokeWidth={2}
              />
            );
          })}
        </svg>

        <p className="tabular -mt-6 text-[30px] font-semibold tracking-tight" style={{ color }}>
          {ratio === null ? "—" : `${(ratio * 100).toFixed(1)}%`}
        </p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">{GIVING_BAND_LABELS[band]}</p>
        <p className="mt-3 text-center text-[13px] text-muted-foreground">
          <Money cents={givenCents} currency={currency} tone="ink" className="font-semibold" /> đã dâng hiến trên{" "}
          <Money cents={incomeCents} currency={currency} tone="ink" className="font-semibold" /> thu nhập
        </p>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- 6. business dashboard

export function BusinessDashboard({
  incomeCents,
  expenseCents,
  profitCents,
  trend,
  currency,
}: {
  incomeCents: number;
  expenseCents: number;
  profitCents: number;
  trend: readonly { label: string; revenue: number; cost: number; profit: number }[];
  currency: string;
}) {
  const Tip = useMemo(() => makeTooltip(currency), [currency]);
  const hasTrend = trend.some((point) => point.revenue > 0 || point.cost > 0);

  return (
    <Panel title="Kinh doanh hộ gia đình">
      <div className="grid gap-3 px-5 py-5 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-background/60 px-4 py-3">
          <p className="text-[12.5px] font-medium text-muted-foreground">Doanh thu</p>
          <Money cents={incomeCents} currency={currency} tone="in" className="mt-1 block text-[20px] font-semibold" />
        </div>
        <div className="rounded-lg border border-border bg-background/60 px-4 py-3">
          <p className="text-[12.5px] font-medium text-muted-foreground">Chi phí</p>
          <Money cents={expenseCents} currency={currency} tone="out" className="mt-1 block text-[20px] font-semibold" />
        </div>
        <div className="rounded-lg border border-primary/35 bg-accent/40 px-4 py-3">
          <p className="text-[12.5px] font-medium text-muted-foreground">Lãi gộp</p>
          <Money
            cents={profitCents}
            currency={currency}
            tone={profitCents >= 0 ? "in" : "out"}
            className="mt-1 block text-[20px] font-semibold"
          />
        </div>
      </div>

      {hasTrend ? (
        <div className="px-2 pb-4">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={[...trend]} margin={{ top: 6, right: 14, bottom: 0, left: 4 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={AXIS} />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={AXIS}
                width={52}
                tickFormatter={(value: number) => compactAxis(value, currency)}
              />
              <Tooltip content={<Tip />} cursor={{ stroke: GRID }} />
              <Legend verticalAlign="top" height={26} iconType="plainline" wrapperStyle={{ fontSize: 12, color: "#6B635A" }} />
              <Line type="monotone" dataKey="revenue" name="Doanh thu" stroke="#3F8F6B" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="cost" name="Chi phí" stroke="#E0603C" strokeWidth={2} dot={false} />
              <Line
                type="monotone"
                dataKey="profit"
                name="Lãi gộp"
                stroke="#C98A3E"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </Panel>
  );
}
