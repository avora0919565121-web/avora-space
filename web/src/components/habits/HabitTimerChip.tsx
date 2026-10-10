import { Timer } from "lucide-react";

import { clockText, remainingMs, type HabitSession } from "@/lib/habit-timer";
import { showHabitTimer } from "@/lib/use-habit-timer";

/**
 * AVORA-107 · PHẦN 2 — the stopped session waiting in a corner of every tab (đặc tả mục 5). It
 * never runs here: the clock only counts on its own full screen. Tap = back to the clock.
 */
export function HabitTimerChip({ session }: { session: HabitSession }) {
  return (
    <button
      type="button"
      onClick={() => showHabitTimer()}
      data-habit-timer-chip=""
      aria-label={`Đồng hồ ${session.habitName} đang dừng, còn ${clockText(remainingMs(session, Date.now()))}. Chạm để mở lại`}
      className="press fixed bottom-[calc(max(env(safe-area-inset-bottom),10px)+66px)] left-3 z-[46] flex h-11 max-w-[min(70vw,280px)] items-center gap-2 rounded-full border border-border bg-card/95 pl-3 pr-4 text-[13px] font-medium text-foreground shadow-[0_6px_20px_rgba(0,0,0,0.12)] backdrop-blur-md md:bottom-6 md:left-auto md:right-6 short:bottom-4 short:left-auto short:right-[calc(var(--inset-r,0px)+16px)]"
    >
      <Timer className="h-4 w-4 shrink-0 text-personal" strokeWidth={2} aria-hidden="true" />
      <span className="truncate">{session.habitName}</span>
      <span className="tabular shrink-0 text-muted-foreground">{clockText(remainingMs(session, Date.now()))}</span>
    </button>
  );
}
