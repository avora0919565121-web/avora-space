import { Check, MoreHorizontal, Timer } from "lucide-react";
import { memo } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { dayTally, doneKey, kindText, tallyText, weekTally, type DoneIndex, type Habit } from "@/lib/habits";
import { cn } from "@/lib/utils";

/**
 * One habit of a day (AVORA-107 · PHẦN 1): its name, one round mark per window, then the quiet
 * `Hôm nay 2/3 · Tuần này 5/7`. A window past its time and not done stays as it is — no colour,
 * no "late"; it hangs until 24:00.
 */
export const HabitRow = memo(function HabitRow({
  habit,
  done,
  today,
  onToggle,
  onOpen,
  onEdit,
  onPause,
  onArchive,
  compact = false,
}: {
  habit: Habit;
  done: DoneIndex;
  today: string;
  onToggle: (habit: Habit, windowIndex: number, isDone: boolean) => void;
  onOpen: (habit: Habit) => void;
  onEdit?: (habit: Habit) => void;
  onPause?: (habit: Habit) => void;
  onArchive?: (habit: Habit) => void;
  /** Hôm nay's folded block: name + marks only. */
  compact?: boolean;
}) {
  const day = dayTally(habit, done, today);
  const week = weekTally(habit, done, today);
  const isKept = day.total > 0 && day.done === day.total;
  return (
    <li data-habit-id={habit.id} data-habit-kept={isKept ? "" : undefined} className="flex items-start gap-2 border-t border-border px-3 py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(habit)}
          className="press flex min-h-11 w-full min-w-0 flex-col items-start justify-center rounded-[8px] text-left"
        >
          <span className={cn("flex min-w-0 max-w-full items-center gap-1.5 text-[15px] font-semibold text-foreground", isKept && "text-foreground/70")}>
            {habit.kind === "timed" ? <Timer className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden="true" /> : null}
            <span className="truncate">{habit.name}</span>
          </span>
          {!compact ? <span className="text-[12px] text-muted-foreground">{kindText(habit)}</span> : null}
        </button>
        <div role="group" aria-label={`Khung giờ của ${habit.name}`} className="mt-1 flex flex-wrap gap-1.5">
          {habit.windows.map((window, index) => {
            const isDone = done.has(doneKey(habit.id, today, index));
            return (
              <button
                key={`${window.time}-${index}`}
                type="button"
                aria-pressed={isDone}
                aria-label={`${habit.name} · ${window.time} · ${isDone ? "Đã làm, chạm để bỏ" : "Chạm khi đã làm"}`}
                data-habit-window={index}
                onClick={() => onToggle(habit, index, isDone)}
                className={cn(
                  "press flex h-11 items-center gap-1.5 rounded-full border pl-1.5 pr-3 text-[13px] font-medium tabular transition-colors",
                  isDone ? "border-personal/40 bg-personal/10 text-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
                    isDone ? "border-personal bg-personal text-personal-foreground" : "border-muted-foreground/40",
                  )}
                >
                  {isDone ? <Check className="h-4 w-4" strokeWidth={2.5} /> : null}
                </span>
                {window.time}
              </button>
            );
          })}
        </div>
        {!compact ? (
          <p data-habit-tally="" className="mt-1.5 text-[12px] tabular text-muted-foreground">
            Hôm nay {tallyText(day)} · Tuần này {tallyText(week)}
          </p>
        ) : null}
      </div>
      {onEdit !== undefined || onPause !== undefined || onArchive !== undefined ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`Thêm cho ${habit.name}`} className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary">
              <MoreHorizontal className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onEdit !== undefined ? <DropdownMenuItem onSelect={() => onEdit(habit)}>Sửa</DropdownMenuItem> : null}
            {onPause !== undefined ? <DropdownMenuItem onSelect={() => onPause(habit)}>{habit.pausedAt === null ? "Tạm nghỉ" : "Tiếp tục"}</DropdownMenuItem> : null}
            {onArchive !== undefined ? <DropdownMenuItem onSelect={() => onArchive(habit)}>Lưu trữ</DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
});
