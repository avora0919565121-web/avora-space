import { Check, Timer, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { elapsedMs, minutesText, passedLine, type HabitSession } from "@/lib/habit-timer";
import { abandonHabitTimer, checkHabitTimer, completeHabitTimer, dismissHabitTimerScreen } from "@/lib/use-habit-timer";

/**
 * VMT 10/10 21:11 — back in Avora after a `Cứ chạy` session ran unwatched. Nothing was written: the
 * card says how long has passed and the person chooses `Ghi Đã làm (n phút)` (the real n, no
 * ceiling) or `Bỏ phiên` (optional note). Closing it leaves the clock running in the corner chip.
 */
export function HabitTimerBackCard({ session, today }: { session: HabitSession; today: string }) {
  const [now, setNow] = useState<number>(() => Date.now());
  const [isAbandoning, setIsAbandoning] = useState<boolean>(false);
  const [note, setNote] = useState<string>("");
  const isRunning = session.runningSince !== null;

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      checkHabitTimer(today, at);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [isRunning, today]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (isAbandoning) setIsAbandoning(false);
      else dismissHabitTimerScreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAbandoning]);

  const seconds = Math.round(elapsedMs(session, now) / 1000);
  const minutes = minutesText(seconds);
  const isEnough = seconds >= session.targetSeconds;
  const target = Math.round(session.targetSeconds / 60);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-center" data-habit-timer="back">
      <button type="button" aria-label="Đóng — đồng hồ vẫn chạy" tabIndex={-1} onClick={() => dismissHabitTimerScreen()} className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Đồng hồ · ${session.habitName}`}
        className="relative w-full max-w-[440px] rounded-t-[var(--radius-card)] border border-border bg-card px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-4 shadow-[0_-8px_32px_rgba(0,0,0,0.14)] animate-in slide-in-from-bottom-4 fade-in-0 md:rounded-[var(--radius-card)] md:pb-5 short:max-w-[520px]"
      >
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 shrink-0 text-personal" strokeWidth={2} aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-muted-foreground">{session.habitName}</p>
          <button type="button" onClick={() => dismissHabitTimerScreen()} aria-label="Đóng — đồng hồ vẫn chạy" data-habit-back-close="" className="icon-btn -mr-2 h-11 w-11 text-muted-foreground">
            <X className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        <p className="tabular text-[26px] font-semibold leading-tight text-foreground" data-habit-back-line="" aria-live="polite">
          {passedLine(session, now)}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {isEnough ? `Đã trôi qua ${minutes} · mục tiêu ${target} phút` : `Mục tiêu ${target} phút · đồng hồ vẫn đang chạy`}. Chưa ghi gì.
        </p>

        {isAbandoning ? (
          <div data-habit-abandon="" className="mt-4">
            <label className="block">
              <span className="text-[12px] font-medium text-muted-foreground">Ghi chú (không bắt buộc)</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Ví dụ: có khách"
                data-habit-abandon-note=""
                className="mt-1 w-full resize-none rounded-[var(--radius-card)] border border-input bg-background px-3 py-2 text-[16px] text-foreground outline-none focus:border-personal/60 md:text-[14px]"
              />
            </label>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setIsAbandoning(false)} className="press h-12 flex-1 rounded-full border border-border text-[15px] font-medium text-foreground">
                Quay lại
              </button>
              <button type="button" data-habit-abandon-confirm="" onClick={() => abandonHabitTimer(note)} className="press h-12 flex-1 rounded-full bg-foreground text-[15px] font-semibold text-background">
                Bỏ phiên
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => completeHabitTimer()}
              data-habit-back-log=""
              className="press flex h-14 w-full items-center justify-center gap-2 rounded-full bg-personal text-[16px] font-semibold text-personal-foreground"
            >
              <Check className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
              Ghi Đã làm ({minutes})
            </button>
            <button type="button" onClick={() => setIsAbandoning(true)} data-habit-back-abandon="" className="press h-12 w-full rounded-full border border-border bg-card text-[15px] font-medium text-foreground">
              Bỏ phiên
            </button>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
