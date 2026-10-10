import { CloudOff, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { HabitDetail } from "@/components/habits/HabitDetail";
import { HabitEditor } from "@/components/habits/HabitEditor";
import { HabitRow } from "@/components/habits/HabitRow";
import { openHabitTimer } from "@/lib/use-habit-timer";
import { HABIT_PARAM, HABIT_SUGGESTIONS, habitsForDay, isRunning, readingRepeatTask, scheduleText, tallyText, todaySummary, type Habit, type HabitDraft } from "@/lib/habits";
import { useTasks } from "@/lib/use-tasks";
import { archiveHabit, pauseHabit, toggleHabitWindow, useHabits } from "@/lib/use-habits";
import { useOnline } from "@/lib/use-online";

const MOVE_DISMISSED_KEY = "avora-habit-reading-move-dismissed";


/**
 * Nhiệm vụ › Thói quen (AVORA-107 · PHẦN 1): today's habits by their first window, each window a
 * round mark, `Hôm nay 2/3 · Tuần này 5/7` under each. Habits not asked for today and resting ones
 * sit below, quieter. Archived ones leave the list (their history stays in the detail / search).
 */
export function HabitsSection({ createRequest, startWithCreate = false, onStarted }: { createRequest: number; startWithCreate?: boolean; onStarted?: () => void }) {
  const { habits, logs, done, today, isLoaded, loadFailed, pendingCount, totalOf, retry } = useHabits();
  const isOnline = useOnline();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editor, setEditor] = useState<{ key: number; habit: Habit | null; initial?: HabitDraft } | null>(() => (startWithCreate ? { key: Date.now(), habit: null } : null));
  useEffect(() => {
    if (startWithCreate) onStarted?.();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The head `+` asks by bumping a counter; the value it had when this list opened is not a request.
  const seenRequest = useRef<number>(createRequest);
  useEffect(() => {
    if (createRequest === seenRequest.current) return;
    seenRequest.current = createRequest;
    setEditor({ key: Date.now(), habit: null });
  }, [createRequest]);

  const openId = searchParams.get(HABIT_PARAM);
  const opened = useMemo(() => habits.find((habit) => habit.id === openId) ?? null, [habits, openId]);
  const openDetail = useCallback(
    (habit: Habit): void => {
      const next = new URLSearchParams(searchParams);
      next.set(HABIT_PARAM, habit.id);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );
  const closeDetail = useCallback((): void => {
    const next = new URLSearchParams(searchParams);
    next.delete(HABIT_PARAM);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const todays = useMemo(() => habitsForDay(habits, today), [habits, today]);
  const others = useMemo(() => habits.filter((habit) => isRunning(habit) && !todays.includes(habit)).sort((a, b) => a.name.localeCompare(b.name, "vi")), [habits, todays]);
  const resting = useMemo(() => habits.filter((habit) => habit.archivedAt === null && habit.pausedAt !== null), [habits]);
  const summary = useMemo(() => todaySummary(habits, done, today), [habits, done, today]);

  const toggle = useCallback((habit: Habit, index: number, isDone: boolean) => toggleHabitWindow(habit, today, index, isDone), [today]);
  const start = useCallback((habit: Habit, index: number) => openHabitTimer(habit, index, today), [today]);
  const edit = useCallback((habit: Habit) => setEditor({ key: Date.now(), habit }), []);
  const pause = useCallback((habit: Habit) => {
    const willPause = habit.pausedAt === null;
    pauseHabit(habit.id, willPause);
    toast(willPause ? `Đã tạm nghỉ “${habit.name}”.` : `“${habit.name}” chạy lại từ hôm nay.`);
  }, []);
  const archive = useCallback((habit: Habit, archived: boolean = true) => {
    archiveHabit(habit.id, archived);
    if (archived) toast(`Đã lưu trữ “${habit.name}”. Lịch sử vẫn còn.`, { action: { label: "Hoàn tác", onClick: () => archiveHabit(habit.id, false) } });
    else toast(`Đang theo dõi lại “${habit.name}”.`);
  }, []);

  const hasAny = habits.some((habit) => habit.archivedAt === null);

  // AVORA-77 D6: a repeating reading task stays as it is; here we only offer the habit instead.
  const { data: tasks } = useTasks();
  const [isMoveDismissed, setIsMoveDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MOVE_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const readingTask = useMemo(() => (isLoaded && !isMoveDismissed ? readingRepeatTask(tasks ?? [], habits) : null), [isLoaded, isMoveDismissed, tasks, habits]);
  const startReadingHabit = (): void => {
    const reading = HABIT_SUGGESTIONS.find((item) => item.id === "doc-sach");
    setEditor({ key: Date.now(), habit: null, initial: reading === undefined ? undefined : { ...reading.draft, windows: reading.draft.windows.map((window) => ({ ...window })) } });
  };
  const dismissMove = (): void => {
    setIsMoveDismissed(true);
    try {
      localStorage.setItem(MOVE_DISMISSED_KEY, "1");
    } catch {
      // Not remembered on this device: it only comes back next time.
    }
  };

  return (
    <div data-habits="" className="space-y-5">
      {pendingCount > 0 && !isOnline ? (
        <p data-habits-offline="" className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <CloudOff className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Đã lưu trên máy · gửi khi có mạng
        </p>
      ) : null}

      {readingTask !== null ? (
        <div data-habit-move="" className="rounded-[12px] border border-border bg-card px-4 py-3">
          <p className="text-[14px] text-foreground">
            Bạn đang đọc bằng việc lặp lại “{readingTask.title}”. Muốn theo dõi như một thói quen <span className="font-semibold">Đọc sách</span> có đồng hồ?
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Việc lặp lại cũ vẫn giữ nguyên — bạn tự quyết bỏ hay không.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={startReadingHabit} className="press h-10 rounded-[10px] bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground">
              Tạo thói quen Đọc sách
            </button>
            <button type="button" onClick={dismissMove} className="press h-10 rounded-[10px] px-3 text-[13.5px] font-medium text-muted-foreground hover:bg-secondary">
              Để sau
            </button>
          </div>
        </div>
      ) : null}

      {!isLoaded ? (
        <p role="status" className="py-10 text-center text-[14px] text-muted-foreground">Đang mở thói quen…</p>
      ) : loadFailed ? (
        <div className="rounded-[12px] border border-border bg-card px-4 py-4">
          <p className="text-[14px] text-foreground">Chưa tải được thói quen.</p>
          <button type="button" onClick={retry} className="press mt-2 h-11 rounded-[10px] border border-border px-4 text-[14px] font-medium">
            Thử lại
          </button>
        </div>
      ) : !hasAny ? (
        <div data-habits-empty="" className="rounded-[14px] bg-personal-soft/60 px-4 py-5">
          <p className="text-[15px] font-semibold text-foreground">Một thói quen nhỏ, một giờ cụ thể</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
            Thói quen là kỷ luật của riêng bạn. Lỡ một hôm thì mai bắt đầu lại — không có gì bị mất.
          </p>
          <button type="button" onClick={() => setEditor({ key: Date.now(), habit: null })} className="press mt-3 flex h-11 items-center gap-1.5 rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground">
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Tạo thói quen
          </button>
        </div>
      ) : (
        <>
          <section aria-label="Thói quen hôm nay" data-habits-part="today">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground" data-habits-head="today">
                Hôm nay · {tallyText(summary)}
              </h3>
              <button type="button" onClick={() => setEditor({ key: Date.now(), habit: null })} className="press flex h-10 items-center gap-1 rounded-[8px] px-2 text-[13px] font-medium text-foreground hover:bg-secondary">
                <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                Tạo thói quen
              </button>
            </div>
            {todays.length === 0 ? (
              <p className="py-3 text-[14px] text-muted-foreground">Hôm nay không có thói quen nào.</p>
            ) : (
              <ul className="overflow-hidden rounded-[12px] border border-border bg-card">
                {todays.map((habit) => (
                  <HabitRow key={habit.id} habit={habit} done={done} today={today} onToggle={toggle} onOpen={openDetail} onEdit={edit} onPause={pause} onArchive={archive} onStart={start} />
                ))}
              </ul>
            )}
          </section>

          {others.length > 0 ? (
            <section aria-label="Không có hôm nay" data-habits-part="other-days">
              <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Ngày khác</h3>
              <ul className="overflow-hidden rounded-[12px] border border-border bg-card">
                {others.map((habit) => (
                  <li key={habit.id} className="border-t border-border first:border-t-0">
                    <button type="button" onClick={() => openDetail(habit)} className="press flex min-h-12 w-full flex-col items-start justify-center px-3 py-2 text-left">
                      <span className="text-[14.5px] font-medium text-foreground">{habit.name}</span>
                      <span className="text-[12px] text-muted-foreground">{scheduleText(habit)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {resting.length > 0 ? (
            <section aria-label="Đang tạm nghỉ" data-habits-part="resting">
              <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Đang tạm nghỉ</h3>
              <ul className="overflow-hidden rounded-[12px] border border-border bg-card">
                {resting.map((habit) => (
                  <li key={habit.id} className="flex items-center gap-2 border-t border-border pr-2 first:border-t-0">
                    <button type="button" onClick={() => openDetail(habit)} className="press flex min-h-12 min-w-0 flex-1 flex-col items-start justify-center px-3 py-2 text-left">
                      <span className="truncate text-[14.5px] font-medium text-muted-foreground">{habit.name}</span>
                    </button>
                    <button type="button" onClick={() => pause(habit)} className="press h-10 shrink-0 rounded-[8px] border border-border px-3 text-[13px] font-medium text-foreground hover:bg-secondary">
                      Tiếp tục
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <HabitDetail
        habit={opened}
        logs={logs}
        done={done}
        today={today}
        total={opened === null ? 0 : totalOf(opened.id)}
        onClose={closeDetail}
        onEdit={edit}
        onPause={pause}
        onArchive={archive}
      />
      {editor !== null ? <HabitEditor key={editor.key} open onOpenChange={(open) => (open ? undefined : setEditor(null))} habit={editor.habit} initial={editor.initial} /> : null}
    </div>
  );
}
