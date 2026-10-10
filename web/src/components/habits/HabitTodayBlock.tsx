import { ChevronDown } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { HabitRow } from "@/components/habits/HabitRow";
import { HABIT_PARAM, habitsForDay, isDayKept, tallyText, todaySummary, type Habit } from "@/lib/habits";
import { toggleHabitWindow, useHabits } from "@/lib/use-habits";
import { cn } from "@/lib/utils";

/**
 * Hôm nay's folded `Thói quen · 2/5` (AVORA-107 · 1.2 · 3): at the end of the list, open on tap.
 * A habit hangs here until it is done or the day ends — even past its window; once every window
 * of it is done it leaves the part that still needs doing. Nothing at all → nothing shown.
 */
export function HabitTodayBlock() {
  const navigate = useNavigate();
  const { habits, done, today } = useHabits();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const summary = useMemo(() => todaySummary(habits, done, today), [habits, done, today]);
  const waiting = useMemo(() => habitsForDay(habits, today).filter((habit) => !isDayKept(habit, done, today)), [habits, done, today]);
  const toggle = useCallback((habit: Habit, index: number, isDone: boolean) => toggleHabitWindow(habit, today, index, isDone), [today]);
  const open = useCallback((habit: Habit) => navigate(`/nhiem-vu?muc=thoi-quen&${HABIT_PARAM}=${encodeURIComponent(habit.id)}`), [navigate]);

  if (summary.total === 0) return null;
  return (
    <section aria-label="Thói quen" data-my-day-part="habits" className="mt-5">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="press flex min-h-11 w-full items-center gap-2 rounded-[10px] text-left"
      >
        <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground" data-my-day-head="habits">
          Thói quen · {tallyText(summary)}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} strokeWidth={2} aria-hidden="true" />
      </button>
      {isOpen ? (
        waiting.length === 0 ? (
          <p className="py-2 text-[13.5px] text-muted-foreground">Đã giữ hết thói quen của hôm nay.</p>
        ) : (
          <ul className="border-y border-border">
            {waiting.map((habit) => (
              <HabitRow key={habit.id} habit={habit} done={done} today={today} onToggle={toggle} onOpen={open} compact />
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
