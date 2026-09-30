import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth";
import { useNotes } from "@/lib/use-notes";
import {
  dailyReviewLine,
  isReviewDismissed,
  isWeeklyReviewDay,
  reviewRange,
  summarizeReview,
  type ReviewKind,
  type ReviewRange,
  type ReviewSummary,
} from "@/lib/review";
import { useProfileSettings } from "@/lib/use-settings";
import { todayIso } from "@/lib/tasks";
import { useTasks } from "@/lib/use-tasks";
import { useThinkHub } from "@/lib/use-think-hub";

/** The clock, ticking once a minute — enough for "from 19:00". */
function useMinuteClock(): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export type ReviewState = {
  /** Which prompt is due right now, if any (the weekly card wins on its day). */
  due: ReviewKind | null;
  /** The one-line "Hôm nay: …" for the daily prompt. */
  dayLine: string | null;
  summaryOf: (kind: ReviewKind) => { range: ReviewRange; summary: ReviewSummary };
  today: string;
  isReady: boolean;
  /** Re-reads "Để sau" after it was set on this device. */
  refresh: () => void;
};

/**
 * Nhìn lại tuần / hôm nay (C7, AVORA-50 · B): when a prompt is due and what it would say.
 * The weekly card shows on the day before the rest day; the daily line from the chosen hour,
 * only when something happened, never on the weekly day. "Để sau" folds either for the day.
 */
export function useReview(): ReviewState {
  const { user } = useAuth();
  const userId = user?.id;
  const now = useMinuteClock();
  const today = todayIso(now);
  const { data: settings } = useProfileSettings();
  const { tables, records, isPending: isHubPending } = useThinkHub();
  const { data: tasks, isPending: isTasksPending } = useTasks();
  const notesData = useNotes();
  const [version, setVersion] = useState<number>(0);

  const readingFolderId = useMemo(
    () => (notesData.folders.data ?? []).find((folder) => folder.systemKey === "reading")?.id ?? null,
    [notesData.folders.data],
  );

  const summaryOf = useMemo(() => {
    const cache = new Map<ReviewKind, { range: ReviewRange; summary: ReviewSummary }>();
    return (kind: ReviewKind) => {
      const hit = cache.get(kind);
      if (hit !== undefined) return hit;
      const range = reviewRange(kind, now);
      const summary = summarizeReview({
        range,
        today,
        userId,
        tables,
        records,
        tasks: tasks ?? [],
        notes: notesData.notes.data ?? [],
        readingFolderId,
      });
      const value = { range, summary };
      cache.set(kind, value);
      return value;
    };
    // `version` re-runs this after "Để sau" or a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, today, userId, tables, records, tasks, notesData.notes.data, readingFolderId, version]);

  const isReady = settings !== undefined && !isHubPending && !isTasksPending;
  const weeklyDay = settings !== undefined && isWeeklyReviewDay(now, settings.restWeekday);
  const dayLine = isReady ? dailyReviewLine(summaryOf("day").summary) : null;

  let due: ReviewKind | null = null;
  if (isReady && settings !== undefined) {
    if (weeklyDay) {
      if (settings.reviewWeeklyEnabled && !isReviewDismissed(userId, "week", today)) due = "week";
    } else if (
      settings.reviewDailyEnabled &&
      now.getHours() >= settings.reviewDailyHour &&
      dayLine !== null &&
      !isReviewDismissed(userId, "day", today)
    ) {
      due = "day";
    }
  }

  return { due, dayLine, summaryOf, today, isReady, refresh: () => setVersion((current) => current + 1) };
}
