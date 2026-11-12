import { Plus } from "lucide-react";
import { NavLink } from "react-router-dom";

import { StickyBar } from "@/components/nav/StickyBar";
import { createContext, useContext, type ReactNode } from "react";

import { OBLIGATION_STATUS_LABELS, formatMoney, type ObligationStatus } from "@/lib/finance";
import { knownAtLine } from "@/lib/last-known";
import type { Figures } from "@/lib/use-known-figures";
import { useOnline } from "@/lib/use-online";
import { CHIP_ON_PLAIN } from "@/lib/chip";
import { TYPE } from "@/lib/type-scale";
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
  // KT-08 · QA05-06: on the sample book every number card says "Mẫu" itself — the strip above scrolls away.
  const isSample = useContext(FinanceBookContext)?.isSample === true;
  return (
    <div className="rounded-card border border-border bg-card px-5 py-4" data-stat-sample={isSample ? "" : undefined}>
      <p className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <span className="min-w-0">{label}</span>
        {isSample ? <span className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-px text-[11px] font-semibold text-amber-800 dark:text-amber-200">Mẫu</span> : null}
      </p>
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
    <section className={cn("rounded-card border border-border bg-card", className)}>
      {title !== undefined ? (
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          {/* CC-14: the house block title (TYPE.blockTitle), the same as Avora Space's blocks. */}
          <h2 className={cn(TYPE.blockTitle, "tracking-tight")}>{title}</h2>
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

/**
 * One header for the whole finance section (KT-06 · E, CEO 12/11 23:41): the four tabs sit right under
 * the Két sắt strip and stick there while the page scrolls; the page's own action (e.g. `+ Tài khoản`)
 * rides at the end of that same row; the one-line description comes after, as a quiet line that opens
 * the content — never between two strips of navigation.
 */
export function FinanceHeader({ subtitle, action }: { subtitle: string; action?: ReactNode }) {
  return (
    <>
      <StickyBar name="finance" className="-mx-4 px-4 sm:-mx-6 sm:px-6 md:-mx-10 md:px-10">
        {() => (
          <div data-finance-head="" className="flex items-center justify-between gap-2 border-b border-border py-2">
            {/* AVORA-53 · 6.10: Két sắt already names the place; no second "Tài chính" title inside. */}
            <nav aria-label="Mục tài chính" className="min-w-0">
              {/* QA01-12: one line on a phone — tighter pads there, and a sideways scroll before any wrap. */}
              <ul data-finance-tabs="" data-h-scroll="" className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] sm:gap-1">
                {TABS.map((tab) => (
                  <li key={tab.to}>
                    <NavLink
                      to={tab.to}
                      end={tab.end}
                      className={({ isActive }) =>
                        cn(
                          "press inline-block whitespace-nowrap rounded-md px-1.5 py-2 text-[14px] font-medium transition-colors min-[400px]:px-2 sm:px-3.5",
                          isActive ? CHIP_ON_PLAIN : "text-muted-foreground hover:bg-accent/35 hover:text-foreground",
                        )
                      }
                    >
                      {tab.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
            {action !== undefined ? (
              <div data-finance-action="" className="shrink-0">
                {action}
              </div>
            ) : null}
          </div>
        )}
      </StickyBar>
      <p data-finance-subtitle="" className="mt-3 text-[13.5px] text-muted-foreground">
        {subtitle}
      </p>
      <FinanceBookSlot />
    </>
  );
}

/** KT-06 · E: a page action at the end of the tab row — the standard small size, icon only on a phone. */
export function RowAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="press inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-[13.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 sm:px-3"
    >
      <Plus className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/** What the shell needs to know about which book is open (KT-07c). */
export type FinanceBookState = {
  isSample: boolean;
  canShowSample: boolean;
  setBook: (mode: "mine" | "sample") => void;
  hideSample: () => void;
};

/**
 * The page shell every finance screen sits in.
 *
 * KT-07c (CEO 12/11 · 17): with a `book`, it carries the two-step switch "Sổ của tôi · Sổ mẫu"
 * and, on the sample, a strip saying it is not the person's data (with "Ẩn sổ mẫu"). The sample is
 * read-only: everything inside sits in a disabled fieldset, so no button can write, edit or export.
 */
export function FinancePage({ children, book }: { children: ReactNode; book?: FinanceBookState }) {
  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div className="animate-rise-in mx-auto max-w-6xl px-4 pb-10 sm:px-6 md:px-10">
        <FinanceBookContext.Provider value={book ?? null}>
          {book?.isSample === true ? (
            // Read-only: every control inside is switched off (the switch itself carries data-sample-ok).
            <div
              data-sample-book=""
              onClickCapture={(event) => {
                const control = (event.target as HTMLElement).closest("button, input, select, textarea, label");
                if (control !== null && control.closest("[data-sample-ok]") === null) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              onKeyDownCapture={(event) => {
                const control = (event.target as HTMLElement).closest("button, input, select, textarea");
                if (control !== null && control.closest("[data-sample-ok]") === null && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              className="[&_:is(button,input,select,textarea):not([data-sample-ok]_*,[data-sample-ok])]:pointer-events-none [&_:is(button,input,select,textarea):not([data-sample-ok]_*,[data-sample-ok])]:opacity-60"
            >
              {children}
            </div>
          ) : (
            children
          )}
        </FinanceBookContext.Provider>
      </div>
    </div>
  );
}

const FinanceBookContext = createContext<FinanceBookState | null>(null);

/** KT-07c: the switch sits right after the page's own header line — never between the two strips. */
function FinanceBookSlot() {
  const book = useContext(FinanceBookContext);
  if (book === null || !(book.isSample || book.canShowSample)) return null;
  return <FinanceBookBar book={book} />;
}

function FinanceBookBar({ book }: { book: FinanceBookState }) {
  return (
    <div className="mt-3" data-sample-ok="" data-finance-book={book.isSample ? "sample" : "mine"}>
      <div role="radiogroup" aria-label="Sổ đang xem" className="inline-flex rounded-full border border-border bg-secondary/60 p-0.5">
        {(["mine", "sample"] as const).map((mode) => {
          const on = (mode === "sample") === book.isSample;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => book.setBook(mode)}
              className={cn(
                "press h-9 rounded-full px-3.5 text-[13.5px] font-medium transition-colors",
                on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {mode === "mine" ? "Sổ của tôi" : "Sổ mẫu"}
            </button>
          );
        })}
      </div>
      {book.isSample ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-amber-500/30 bg-amber-500/[0.07] px-3.5 py-2.5" data-sample-banner="">
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[12px] font-semibold text-amber-800 dark:text-amber-200">Mẫu</span>
          <p className="min-w-0 flex-1 text-[13.5px] text-foreground">
            Đây là sổ mẫu để bạn hình dung Tài chính dùng thế nào. Không phải dữ liệu của bạn, không cộng vào số thật.
          </p>
          <button type="button" onClick={book.hideSample} className="press min-h-9 px-1 text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Ẩn sổ mẫu
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * KT-06 · B: the small line under totals that are not fresh — "Đang ngoại tuyến · cập nhật lúc 14:05".
 * Nothing when the figures are live and online.
 */
export function FiguresStamp({ figures, className }: { figures: Figures<unknown>; className?: string }) {
  if (figures.kind === "live" && !figures.offline) return null;
  if (figures.kind !== "live" && figures.kind !== "known") return null;
  const at = figures.at > 0 ? ` · ${knownAtLine(figures.at)}` : "";
  return (
    <p data-figures-stamp={figures.kind} role="status" className={cn("text-[12.5px] text-muted-foreground", className)}>
      Đang ngoại tuyến{at}
    </p>
  );
}

/** KT-06 · B: nothing read yet and no network — said plainly, instead of a ledger of zeros. */
export function FinanceUnavailable({ what = "số liệu Tài chính", className }: { what?: string; className?: string }) {
  const online = useOnline();
  return (
    <Panel className={cn("mt-6", className)}>
      <div data-finance-unavailable="" role="status" className="px-6 py-10 text-center">
        <p className="text-[16px] font-semibold text-foreground">Chưa tải được {what}</p>
        <p className="mx-auto mt-2 max-w-md text-[14px] text-muted-foreground">
          {online ? "Máy chủ chưa trả lời. Thử lại sau ít phút nhé." : "Máy đang không có mạng. Có mạng lại, các con số sẽ tự hiện."}
        </p>
      </div>
    </Panel>
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
  "h-10 w-full rounded-md border border-border bg-card px-3 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-personal/60 disabled:opacity-60";

// CC-06: `bg-[position:…]`, not `bg-[right_…]` — tailwind-merge read the bare form as a colour and dropped
// `bg-card`, leaving the browser's grey select beside white inputs (glaring in dark mode).
export const selectClass =
  "h-10 w-full appearance-none rounded-md border border-border bg-card bg-[length:16px] bg-[position:right_0.6rem_center] bg-no-repeat pl-3 pr-9 text-[14px] text-foreground outline-none transition-colors focus:border-personal/60 disabled:opacity-60";

/** Chevron drawn in the border colour, so a native select still reads as AVORA paper. */
export const selectChevron: string =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B635A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";
