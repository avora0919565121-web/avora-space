import { AlertTriangle, CalendarClock, CalendarDays } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { DUE_SOON_DAYS, type ObligationAttention, type ObligationWindow } from "@/lib/finance";
import { cn } from "@/lib/utils";

type Cell = {
  window: ObligationWindow;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Only the late column is allowed to raise its voice. */
  urgent: boolean;
};

const CELLS: readonly Cell[] = [
  {
    window: "qua_han",
    label: "Quá hạn",
    hint: "Đã qua ngày hẹn",
    icon: AlertTriangle,
    urgent: true,
  },
  {
    window: "hom_nay",
    label: "Hôm nay",
    hint: "Đến hạn trong hôm nay",
    icon: CalendarClock,
    urgent: false,
  },
  {
    window: "tuan_nay",
    label: `${DUE_SOON_DAYS} ngày tới`,
    hint: "Còn kịp chuẩn bị",
    icon: CalendarDays,
    urgent: false,
  },
] as const;

function countOf(attention: ObligationAttention, window: ObligationWindow): number {
  if (window === "qua_han") return attention.overdue;
  if (window === "hom_nay") return attention.today;
  return attention.week;
}

/**
 * What money is asking for today, above everything else on the overview.
 *
 * Three counts, never amounts: this strip is a prompt to go and look, and a figure here would
 * only be a worse version of the one on the screen it leads to. Each number is a button — a
 * count nobody can act on is just anxiety, so every one of them opens the same list, filtered.
 *
 * Overdue is a column of its own rather than a share of "sắp tới", following Nhiệm vụ: a thing
 * that is already late cannot be allowed to hide inside a larger, calmer number.
 */
export function DueStrip({
  attention,
  onOpen,
}: {
  attention: ObligationAttention;
  onOpen: (window: ObligationWindow) => void;
}) {
  return (
    <section
      aria-labelledby="due-strip-title"
      className="mt-6 rounded-xl border border-border bg-card px-5 py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="due-strip-title" className="text-[15px] font-semibold tracking-tight text-foreground">
          Cần làm
        </h2>
        <p className="text-[12.5px] text-muted-foreground">
          {attention.total === 0
            ? "Không có khoản vay, cho vay hay thuế nào tới hạn."
            : attention.overdue > 0
              ? `${attention.overdue} khoản đã quá hạn`
              : `${attention.total} khoản cần để ý trong tuần`}
        </p>
      </div>

      <ul className="mt-3 grid gap-2 sm:grid-cols-3">
        {CELLS.map((cell) => {
          const count = countOf(attention, cell.window);
          const lit = count > 0;
          const Icon = cell.icon;
          return (
            <li key={cell.window}>
              <button
                type="button"
                onClick={() => onOpen(cell.window)}
                disabled={!lit}
                aria-label={`${cell.label}: ${count} khoản`}
                className={cn(
                  "press flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
                  lit
                    ? "border-border bg-background hover:bg-accent/40"
                    : "cursor-default border-dashed border-border/70 bg-transparent",
                )}
              >
                <Icon
                  aria-hidden="true"
                  strokeWidth={1.7}
                  className={cn(
                    "h-[18px] w-[18px] shrink-0",
                    lit && cell.urgent ? "text-[hsl(var(--task-overdue))]" : "text-muted-foreground",
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-muted-foreground">{cell.label}</span>
                  <span
                    className={cn(
                      "tabular block text-[22px] font-semibold leading-tight tracking-tight",
                      !lit
                        ? "text-muted-foreground/60"
                        : cell.urgent
                          ? "text-[hsl(var(--task-overdue))]"
                          : "text-foreground",
                    )}
                  >
                    {count}
                  </span>
                  <span className="block text-[12px] text-muted-foreground">
                    {lit ? cell.hint : "Không có khoản nào"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
