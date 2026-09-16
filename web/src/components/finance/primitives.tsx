import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";

import { OBLIGATION_STATUS_LABELS, formatMoney, type ObligationStatus } from "@/lib/finance";
import { cn } from "@/lib/utils";

/**
 * The state of an obligation, in the same warm deadline palette the tasks module uses:
 * urgency here is a flag to read, never a red alarm to panic at.
 */
export function StatusBadge({ status, className }: { status: ObligationStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold",
        status === "qua_han" && "bg-[hsl(var(--task-overdue))]/16 text-[hsl(var(--task-overdue))]",
        status === "den_han" && "bg-[hsl(var(--task-due-soon))]/16 text-[hsl(var(--task-due-soon))]",
        status === "hoan_thanh_mot_phan" && "bg-[hsl(var(--task-important))]/16 text-[hsl(var(--task-important))]",
        status === "ke_hoach" && "bg-secondary text-muted-foreground",
        status === "hoan_thanh" && "bg-money-in/14 text-money-in",
        className,
      )}
    >
      {OBLIGATION_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Money on screen. Income reads green and expense reads deep rust; neither uses the
 * terracotta accent, so a number can never be mistaken for a button.
 */
export function Money({
  cents,
  currency,
  tone = "auto",
  signed = false,
  className,
}: {
  cents: number;
  currency: string;
  tone?: "auto" | "in" | "out" | "ink" | "muted";
  signed?: boolean;
  className?: string;
}) {
  const resolved = tone === "auto" ? (cents > 0 ? "in" : cents < 0 ? "out" : "muted") : tone;
  return (
    <span
      className={cn(
        "tabular",
        resolved === "in" && "text-money-in",
        resolved === "out" && "text-money-out",
        resolved === "ink" && "text-foreground",
        resolved === "muted" && "text-muted-foreground",
        className,
      )}
    >
      {formatMoney(cents, currency, { signed })}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "ink" | "in" | "out";
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular mt-1.5 text-[24px] font-semibold tracking-tight",
          tone === "ink" && "text-foreground",
          tone === "in" && "text-money-in",
          tone === "out" && "text-money-out",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[12.5px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card", className)}>
      {title !== undefined ? (
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

const TABS = [
  { to: "/ket-sat", label: "Tổng quan", end: true },
  { to: "/ket-sat/giao-dich", label: "Giao dịch", end: false },
  { to: "/ket-sat/tai-khoan", label: "Tài khoản", end: false },
  { to: "/ket-sat/bao-cao", label: "Báo cáo", end: false },
] as const;

/** One header for the whole finance section: title, section tabs, and a right-hand slot. */
export function FinanceHeader({ subtitle, action }: { subtitle: string; action?: ReactNode }) {
  return (
    <header className="border-b border-border pb-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Tài chính</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">{subtitle}</p>
        </div>
        {action}
      </div>

      <nav aria-label="Mục tài chính" className="mt-5">
        <ul className="flex flex-wrap gap-1">
          {TABS.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    "press inline-block rounded-md px-3.5 py-2 text-[14px] font-medium transition-colors",
                    isActive
                      ? "bg-accent/70 text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/35 hover:text-foreground",
                  )
                }
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

/** The page shell every finance screen sits in. */
export function FinancePage({ children }: { children: ReactNode }) {
  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div className="animate-rise-in mx-auto max-w-6xl px-6 py-10 md:px-10">{children}</div>
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-5 py-10 text-center text-[14px] text-muted-foreground">{children}</p>;
}

/** A required field is marked once, visibly and for screen readers alike. */
export function FieldLabel({
  children,
  required = false,
  htmlFor,
}: {
  children: ReactNode;
  required?: boolean;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-[13px] font-medium text-foreground">
      {children}
      {required ? (
        <>
          <span aria-hidden="true" className="ml-0.5 text-primary">
            *
          </span>
          <span className="sr-only"> (bắt buộc)</span>
        </>
      ) : null}
    </label>
  );
}

export const inputClass =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60 disabled:opacity-60";

export const selectClass =
  "h-10 w-full appearance-none rounded-md border border-border bg-card bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pl-3 pr-9 text-[14px] text-foreground outline-none transition-colors focus:border-primary/60 disabled:opacity-60";

/** Chevron drawn in the border colour, so a native select still reads as AVORA paper. */
export const selectChevron: string =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B635A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";
