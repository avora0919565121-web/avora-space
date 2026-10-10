import { Check, Minimize2, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { clockText, elapsedMs, minutesText, remainingMs, stoppedLine, type HabitSession } from "@/lib/habit-timer";
import { currentRhythm } from "@/lib/motion";
import {
  abandonHabitTimer,
  beginHabitTimer,
  checkHabitTimer,
  closeHabitTimer,
  completeHabitTimer,
  dismissHabitTimerScreen,
  resumeHabitTimer,
  stopHabitTimer,
  type HabitTimerScreen as Screen,
} from "@/lib/use-habit-timer";
import { cn } from "@/lib/utils";

const RADIUS = 118;
const CIRCLE = 2 * Math.PI * RADIUS;

/**
 * AVORA-107 · PHẦN 2 — the countdown, full screen (đặc tả mục 5). Nothing else on screen: the
 * habit's name, one ring, the minutes left. Leaving (✕, Esc, another tab, the screen going dark)
 * stops the clock; `Hoàn thành` writes `Đã làm` with the real time; reaching 00:00 writes `Đã làm`
 * on its own; `Bỏ phiên` asks for an optional note. With reduced motion / Space Rhythm Tĩnh the
 * ring steps once a second and nothing breathes.
 */
export function HabitTimerScreen({ screen, session, today, onFinished }: { screen: Screen; session: HabitSession | null; today: string; onFinished: () => void }) {
  const [now, setNow] = useState<number>(() => Date.now());
  const [isAbandoning, setIsAbandoning] = useState<boolean>(false);
  const [note, setNote] = useState<string>("");
  const isCalm = currentRhythm() === "tinh";
  const isRunning = screen.mode === "session" && session !== null && session.runningSince !== null;

  useEffect(() => {
    setNow(Date.now());
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (checkHabitTimer(today, at) === "finished") onFinished();
    }, 250);
    return () => window.clearInterval(timer);
  }, [isRunning, today, onFinished]);

  useEffect(() => {
    if (screen.mode !== "done") return;
    const timer = window.setTimeout(() => dismissHabitTimerScreen(), 6_000);
    return () => window.clearTimeout(timer);
  }, [screen.mode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (isAbandoning) setIsAbandoning(false);
      else if (screen.mode === "done") dismissHabitTimerScreen();
      else closeHabitTimer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAbandoning, screen.mode]);

  const name = screen.mode === "ready" ? screen.habitName : screen.mode === "done" ? screen.habitName : (session?.habitName ?? "");
  const targetMs = screen.mode === "ready" ? screen.targetMinutes * 60_000 : (session?.targetSeconds ?? 0) * 1000;
  const left = screen.mode === "ready" ? targetMs : screen.mode === "done" ? 0 : session === null ? 0 : remainingMs(session, now);
  const gathered = screen.mode === "session" && session !== null ? elapsedMs(session, now) : screen.mode === "done" ? targetMs : 0;
  const progress = screen.mode === "done" ? 1 : targetMs === 0 ? 0 : Math.min(1, gathered / targetMs);
  // Tĩnh: the ring moves in whole seconds, never in a sweep.
  const shown = isCalm ? Math.floor(progress * (targetMs / 1000)) / Math.max(1, targetMs / 1000) : progress;
  const windowTime = screen.mode === "ready" ? screen.windowTime : (session?.windowTime ?? "");

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Đồng hồ · ${name}`}
      data-habit-timer={screen.mode === "session" ? (isRunning ? "running" : "stopped") : screen.mode}
      className="fixed inset-0 z-[70] flex flex-col bg-background pb-[max(env(safe-area-inset-bottom),16px)] pt-[env(safe-area-inset-top)]"
    >
      {/* Atmosphere: one soft glow in the person's tone; it breathes only in Cân bằng and only while running. */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 bg-[radial-gradient(60%_45%_at_50%_42%,hsl(var(--personal)/0.16),transparent_70%)]",
          isRunning && !isCalm && "animate-[habit-breathe_6s_ease-in-out_infinite]",
        )}
      />
      <header className="relative flex h-14 shrink-0 items-center gap-2 px-2 short:h-12">
        {screen.mode === "done" ? (
          <span className="h-11 w-11" />
        ) : (
          <button type="button" onClick={() => closeHabitTimer()} aria-label="Thu nhỏ — đồng hồ sẽ dừng" data-habit-timer-close="" className="icon-btn h-11 w-11 text-foreground">
            <Minimize2 className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
        <p className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold text-foreground" data-habit-timer-name="">
          {name}
        </p>
        <span className="h-11 w-11" />
      </header>

      {/* A phone on its side: the ring on the left, the buttons on the right. */}
      <div className="relative flex min-h-0 flex-1 flex-col short:flex-row short:items-center short:pr-[var(--inset-r,0px)]">
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <div className="relative h-[min(72vw,272px)] w-[min(72vw,272px)] short:h-[min(56vh,200px)] short:w-[min(56vh,200px)]">
          <svg viewBox="0 0 260 260" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="130" cy="130" r={RADIUS} fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
            <circle
              cx="130"
              cy="130"
              r={RADIUS}
              fill="none"
              stroke="hsl(var(--personal))"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={CIRCLE}
              strokeDashoffset={CIRCLE * (1 - shown)}
              data-habit-timer-ring={shown.toFixed(3)}
              style={{ transition: isCalm || !isRunning ? "none" : "stroke-dashoffset 260ms linear" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {screen.mode === "done" ? (
              <>
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-personal text-personal-foreground">
                  <Check className="h-7 w-7" strokeWidth={2.5} aria-hidden="true" />
                </span>
                <span className="mt-3 text-[20px] font-semibold text-foreground" data-habit-timer-done="">
                  Đã làm
                </span>
                <span className="mt-0.5 text-[13px] tabular text-muted-foreground">{minutesText(screen.seconds)}</span>
              </>
            ) : (
              <>
                <span className="tabular text-[56px] font-semibold leading-none tracking-tight text-foreground short:text-[44px]" data-habit-timer-clock="">
                  {clockText(left)}
                </span>
                <span className="mt-2 text-[13px] text-muted-foreground">
                  còn lại · mục tiêu {Math.round(targetMs / 60_000)} phút
                </span>
              </>
            )}
          </div>
        </div>
        <p className="mt-6 min-h-5 text-center short:mt-3 text-[13px] text-muted-foreground" data-habit-timer-line="" aria-live="polite">
          {screen.mode === "ready"
            ? windowTime !== ""
              ? `Khung ${windowTime}`
              : ""
            : screen.mode === "done"
              ? "Đã ghi vào Thói quen."
              : isRunning
                ? `Khung ${windowTime} · rời màn này là đồng hồ dừng`
                : stoppedLine(session?.stoppedBy ?? null)}
        </p>
      </div>

      <div className="relative mx-auto w-full max-w-[420px] shrink-0 px-5 short:mx-0 short:w-[360px]">
        {isAbandoning ? (
          <div data-habit-abandon="" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-[15px] font-semibold text-foreground">Bỏ phiên này?</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Lịch sử ghi “Đã bỏ phiên · {minutesText(Math.round(gathered / 1000))}”. Khung giờ vẫn còn trong hôm nay.
            </p>
            <label className="mt-3 block">
              <span className="text-[12px] font-medium text-muted-foreground">Ghi chú (không bắt buộc)</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Ví dụ: có khách"
                data-habit-abandon-note=""
                className="mt-1 w-full resize-none rounded-[10px] border border-input bg-background px-3 py-2 text-[16px] text-foreground outline-none focus:border-personal/60 md:text-[14px]"
              />
            </label>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setIsAbandoning(false)} className="press h-12 flex-1 rounded-full border border-border text-[15px] font-medium text-foreground">
                Quay lại
              </button>
              <button
                type="button"
                data-habit-abandon-confirm=""
                onClick={() => abandonHabitTimer(note)}
                className="press h-12 flex-1 rounded-full bg-foreground text-[15px] font-semibold text-background"
              >
                Bỏ phiên
              </button>
            </div>
          </div>
        ) : screen.mode === "ready" ? (
          <button
            type="button"
            onClick={() => beginHabitTimer()}
            data-habit-timer-start=""
            className="press flex h-14 w-full items-center justify-center gap-2 rounded-full bg-personal text-[16px] font-semibold text-personal-foreground"
          >
            <Play className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
            Bắt đầu
          </button>
        ) : screen.mode === "done" ? (
          <button type="button" onClick={() => dismissHabitTimerScreen()} data-habit-timer-dismiss="" className="press h-14 w-full rounded-full border border-border bg-card text-[16px] font-semibold text-foreground">
            Xong
          </button>
        ) : (
          <>
            <div className="flex gap-3">
              {isRunning ? (
                <button
                  type="button"
                  onClick={() => stopHabitTimer("user")}
                  data-habit-timer-stop=""
                  className="press flex h-14 flex-1 items-center justify-center gap-2 rounded-full border border-border bg-card text-[16px] font-semibold text-foreground"
                >
                  <Pause className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                  Dừng
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => resumeHabitTimer()}
                  data-habit-timer-resume=""
                  className="press flex h-14 flex-1 items-center justify-center gap-2 rounded-full bg-personal text-[16px] font-semibold text-personal-foreground"
                >
                  <Play className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                  Tiếp tục
                </button>
              )}
              <button
                type="button"
                onClick={() => completeHabitTimer()}
                data-habit-timer-complete=""
                className={cn(
                  "press flex h-14 flex-1 items-center justify-center gap-2 rounded-full text-[16px] font-semibold",
                  isRunning ? "bg-personal text-personal-foreground" : "border border-border bg-card text-foreground",
                )}
              >
                <Check className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
                Hoàn thành
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                stopHabitTimer("user");
                setIsAbandoning(true);
              }}
              data-habit-timer-abandon=""
              className="press mx-auto mt-2 flex min-h-11 items-center px-4 text-[14px] font-medium text-muted-foreground"
            >
              Bỏ phiên
            </button>
          </>
        )}
      </div>
      </div>
    </div>,
    document.body,
  );
}
