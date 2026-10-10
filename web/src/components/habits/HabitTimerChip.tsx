import { Timer } from "lucide-react";
import { useEffect, useState } from "react";

import { clockText, elapsedMs, remainingMs, type HabitSession } from "@/lib/habit-timer";
import { checkHabitTimer, showHabitTimer } from "@/lib/use-habit-timer";
import { cn } from "@/lib/utils";

/**
 * AVORA-107 · PHẦN 2 — the session in a corner of every tab (đặc tả mục 5). `Dừng khi rời`: it
 * stands still (the clock only counts on its own full screen). `Cứ chạy` (VMT 10/10 21:11): it
 * counts down, then shows the time gathered past the target. Tap = back to the clock.
 */
export function HabitTimerChip({ session, today, onReached }: { session: HabitSession; today: string; onReached: () => void }) {
  const [now, setNow] = useState<number>(() => Date.now());
  const isLive = session.runningSince !== null;

  useEffect(() => {
    setNow(Date.now());
    if (!isLive) return;
    const timer = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (checkHabitTimer(today, at) === "reached") onReached();
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [isLive, today, onReached]);

  const left = remainingMs(session, now);
  const isOver = isLive && left <= 0;
  const clock = isOver ? clockText(elapsedMs(session, now)) : clockText(left);
  const state = isLive ? (isOver ? "đã đủ giờ, đang chạy" : "đang chạy") : "đang dừng";

  return (
    <button
      type="button"
      onClick={() => showHabitTimer()}
      data-habit-timer-chip={isLive ? "running" : "stopped"}
      aria-label={`Đồng hồ ${session.habitName} ${state}, ${isOver ? "đã trôi qua" : "còn"} ${clock}. Chạm để mở lại`}
      className="press fixed bottom-[calc(max(env(safe-area-inset-bottom),10px)+66px)] left-3 z-[46] flex h-11 max-w-[min(70vw,280px)] items-center gap-2 rounded-full border border-border bg-card/95 pl-3 pr-4 text-[13px] font-medium text-foreground shadow-[0_6px_20px_rgba(0,0,0,0.12)] backdrop-blur-md md:bottom-6 md:left-auto md:right-6 short:bottom-4 short:left-auto short:right-[calc(var(--inset-r,0px)+16px)]"
    >
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <Timer className="h-4 w-4 text-personal" strokeWidth={2} aria-hidden="true" />
        {isLive ? <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-personal" /> : null}
      </span>
      <span className="truncate">{session.habitName}</span>
      <span className={cn("tabular shrink-0", isOver ? "text-personal" : "text-muted-foreground")} data-habit-timer-chip-clock="">
        {isOver ? `Đủ · ${clock}` : clock}
      </span>
    </button>
  );
}
