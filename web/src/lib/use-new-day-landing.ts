import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ENTRY_PATH, decideDayOpen } from "@/lib/day-open";
import { fetchLastOpenedDate, recordOpenedDate } from "@/lib/day-open-api";
import { HOME_ROUTE } from "@/lib/navigation";
import { todayIso } from "@/lib/tasks";
import { isResumeDevice } from "@/lib/use-resume-place";

/**
 * Runs the new-day check when the app opens fresh and every time it comes back from the
 * background. Nothing polls: the check happens only at those two moments.
 *
 * A local memory of the last day seen saves the round trip on the many same-day returns; only
 * when that memory says "another day" is the database asked, since another device may already
 * have opened today.
 */
export function useNewDayLanding(userId: string | undefined): void {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef<string>(location.pathname);
  const seenDayRef = useRef<string | null>(null);
  const isCheckingRef = useRef<boolean>(false);
  // The first check after the page loads is a cold open, judged by the path the page loaded with.
  const isColdRef = useRef<boolean>(true);

  pathRef.current = location.pathname;

  useEffect(() => {
    if (userId === undefined) return;
    let isCancelled = false;

    const check = async (): Promise<void> => {
      const today = todayIso();
      if (seenDayRef.current === today || isCheckingRef.current) return;
      isCheckingRef.current = true;
      try {
        const lastOpened = await fetchLastOpenedDate(userId);
        if (isCancelled) return;
        const isCold = isColdRef.current;
        isColdRef.current = false;
        const decision = decideDayOpen(lastOpened, today, isCold ? ENTRY_PATH : pathRef.current, HOME_ROUTE, isCold ? "cold" : "resume");
        seenDayRef.current = today;
        if (decision === "stay") return;
        // AVORA-93 · 5: a phone follows the 04:00 resume rule instead (use-resume-place); only the day is recorded here.
        if (decision === "go-home" && !isResumeDevice()) navigate(HOME_ROUTE, { replace: true });
        await recordOpenedDate(userId, today);
      } catch {
        // A failed read leaves the person where they are: missing the morning overview once is
        // far better than being thrown out of whatever they opened.
      } finally {
        isCheckingRef.current = false;
      }
    };

    void check();
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      isCancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, navigate]);
}
