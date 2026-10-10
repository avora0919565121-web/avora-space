import { useMemo } from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  dayTally,
  fourWeeks,
  historyLineText,
  historyOf,
  isoWeekday,
  kindText,
  scheduleText,
  tallyText,
  weekTally,
  WEEKDAY_SHORT,
  type DoneIndex,
  type Habit,
  type HabitLog,
} from "@/lib/habits";
import { cn } from "@/lib/utils";

function dayLabel(day: string, today: string): string {
  const [, m, d] = day.split("-");
  if (day === today) return "Hôm nay";
  return `${WEEKDAY_SHORT[isoWeekday(day)]} · ${d}/${m}`;
}

/**
 * Chi tiết thói quen: this week, `4 tuần gần nhất`, `Tổng N lần` (said, never celebrated) and the
 * history — `Đã làm`, `Chưa làm` in the same quiet colour, `Đã bỏ phiên · 12 phút` with its note.
 */
export function HabitDetail({
  habit,
  logs,
  done,
  today,
  total,
  onClose,
  onEdit,
  onPause,
  onArchive,
}: {
  habit: Habit | null;
  logs: readonly HabitLog[];
  done: DoneIndex;
  today: string;
  total: number;
  onClose: () => void;
  onEdit: (habit: Habit) => void;
  onPause: (habit: Habit) => void;
  onArchive: (habit: Habit, archived: boolean) => void;
}) {
  const weeks = useMemo(() => (habit === null ? [] : fourWeeks(habit, done, today)), [habit, done, today]);
  const history = useMemo(() => (habit === null ? [] : historyOf(habit, logs, today)), [habit, logs, today]);
  return (
    <Sheet open={habit !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" backLabel="Thói quen" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[440px]" data-habit-detail={habit?.id ?? ""}>
        {habit !== null ? (
          <>
            <div className="shrink-0 border-b border-border px-5 pb-4 pt-5 md:pr-12">
              <SheetTitle className="text-[20px] font-semibold leading-tight text-foreground">{habit.name}</SheetTitle>
              <SheetDescription className="mt-0.5 text-[13px] text-muted-foreground">
                {kindText(habit)} · {scheduleText(habit)}
              </SheetDescription>
              {habit.archivedAt !== null ? <p className="mt-1 text-[12px] font-medium text-muted-foreground">Đã lưu trữ — lịch sử vẫn còn.</p> : null}
              {habit.archivedAt === null && habit.pausedAt !== null ? <p className="mt-1 text-[12px] font-medium text-muted-foreground">Đang tạm nghỉ — không hiện trong Hôm nay, không nhắc.</p> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              <dl className="grid grid-cols-3 gap-2">
                <div className="rounded-[12px] bg-secondary/60 px-3 py-2.5">
                  <dt className="text-[11.5px] text-muted-foreground">Hôm nay</dt>
                  <dd className="text-[18px] font-semibold tabular text-foreground">{tallyText(dayTally(habit, done, today))}</dd>
                </div>
                <div className="rounded-[12px] bg-secondary/60 px-3 py-2.5">
                  <dt className="text-[11.5px] text-muted-foreground">Tuần này</dt>
                  <dd className="text-[18px] font-semibold tabular text-foreground">{tallyText(weekTally(habit, done, today))}</dd>
                </div>
                <div className="rounded-[12px] bg-secondary/60 px-3 py-2.5">
                  <dt className="text-[11.5px] text-muted-foreground">Tổng</dt>
                  <dd data-habit-total="" className="text-[18px] font-semibold tabular text-foreground">{total} lần</dd>
                </div>
              </dl>

              <section aria-label="4 tuần gần nhất" className="mt-5">
                <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">4 tuần gần nhất</h3>
                <p data-habit-weeks="" className="mt-1 text-[13px] tabular text-foreground">{weeks.map(tallyText).join(" · ")}</p>
                <div className="mt-2 grid grid-cols-4 gap-2" aria-hidden="true">
                  {weeks.map((week, index) => (
                    <div key={index} className="h-10 overflow-hidden rounded-[8px] bg-secondary">
                      <div className="h-full origin-bottom bg-personal/50" style={{ transform: `scaleY(${week.total === 0 ? 0 : week.done / week.total})` }} />
                    </div>
                  ))}
                </div>
              </section>

              <section aria-label="Lịch sử" className="mt-6">
                <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Lịch sử</h3>
                {history.length === 0 ? (
                  <p className="py-2 text-[13.5px] text-muted-foreground">Chưa có gì — lần đầu sẽ hiện ở đây.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {history.map((entry) => (
                      <li key={entry.day} data-habit-history-day={entry.day} className="py-2.5">
                        <p className="text-[12.5px] font-semibold text-foreground">{dayLabel(entry.day, today)}</p>
                        <ul className="mt-1 space-y-0.5">
                          {entry.lines.map((line, index) => (
                            <li key={index} data-habit-history={line.kind} className={cn("flex items-baseline gap-2 text-[13.5px]", line.kind === "done" ? "text-foreground" : "text-muted-foreground")}>
                              <span className="w-12 shrink-0 tabular text-muted-foreground">{line.time}</span>
                              <span className="min-w-0 break-words">{historyLineText(line)}</span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
              {habit.archivedAt === null ? (
                <>
                  <button type="button" onClick={() => onArchive(habit, true)} className="press h-11 rounded-[10px] px-3 text-[14px] font-medium text-muted-foreground hover:bg-secondary">
                    Lưu trữ
                  </button>
                  <button type="button" onClick={() => onPause(habit)} className="press h-11 rounded-[10px] border border-border px-4 text-[14px] font-medium text-foreground hover:bg-secondary">
                    {habit.pausedAt === null ? "Tạm nghỉ" : "Tiếp tục"}
                  </button>
                  <button type="button" onClick={() => onEdit(habit)} className="press h-11 rounded-[10px] bg-primary px-5 text-[14px] font-semibold text-primary-foreground">
                    Sửa
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => onArchive(habit, false)} className="press h-11 rounded-[10px] border border-border px-4 text-[14px] font-medium text-foreground hover:bg-secondary">
                  Theo dõi lại
                </button>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
