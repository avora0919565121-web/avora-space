import { ChevronRight, Repeat } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { tallyText, todaySummary } from "@/lib/habits";
import { useHabits } from "@/lib/use-habits";

/**
 * Avora Space's one line for habits (AVORA-107 · 1.2 · 7, ADR-013): it only shows and opens —
 * ticking happens in Nhiệm vụ › Thói quen. No habit today → no line.
 */
export function HabitSpaceLine({ href }: { href: string }) {
  const { habits, done, today } = useHabits();
  const summary = useMemo(() => todaySummary(habits, done, today), [habits, done, today]);
  if (summary.total === 0) return null;
  return (
    <Link
      to={href}
      data-space-habits=""
      aria-label={`Thói quen hôm nay ${tallyText(summary)}. Mở Thói quen trong Nhiệm vụ`}
      className="press mt-3 flex min-h-11 items-center gap-2 rounded-[12px] border border-border bg-card px-4 text-[14px] text-foreground transition-colors hover:bg-accent/30"
    >
      <Repeat className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        Thói quen hôm nay <span className="tabular font-semibold">{tallyText(summary)}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
    </Link>
  );
}
