import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";

import { HabitTimerBackCard } from "@/components/habits/HabitTimerBackCard";
import { HabitTimerChip } from "@/components/habits/HabitTimerChip";
import { HabitTimerScreen } from "@/components/habits/HabitTimerScreen";
import { useAuth } from "@/lib/auth";
import { playSoftTone } from "@/lib/habit-chime";
import { habitChimeAllowed } from "@/lib/habits";
import { activeFocus } from "@/lib/mute";
import { checkHabitTimer, clearHabitTimerNotice, closeHabitTimer, leaveHabitTimer, loadHabitTimer, returnToHabitTimer, useHabitTimer } from "@/lib/use-habit-timer";
import { useLocalDay } from "@/lib/use-habits";
import { useMuteSettings } from "@/lib/use-mute";
import { useProfileSettings } from "@/lib/use-settings";

/**
 * AVORA-107 · PHẦN 2 — the habit clock's home on every screen: the full-screen countdown when open,
 * the corner chip while a session waits or runs. `Dừng khi rời`: whatever takes the person away
 * stops the clock (another route, the page hidden, the window losing focus). `Cứ chạy` (VMT 10/10
 * 21:11): nothing stops it; coming back to a hidden page asks what to write.
 */
export function HabitTimerHost() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const today = useLocalDay();
  const { session, screen, notice } = useHabitTimer();
  const location = useLocation();
  const { data: settings } = useProfileSettings();
  const { decide } = useMuteSettings();

  useEffect(() => {
    if (userId !== null) loadHabitTimer(userId, today);
  }, [userId, today]);

  // 24:00: a stopped session of yesterday cancels itself.
  useEffect(() => {
    checkHabitTimer(today);
  }, [today]);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") leaveHabitTimer("hidden");
      else returnToHabitTimer();
    };
    const onHide = (): void => leaveHabitTimer("hidden");
    const onBlur = (): void => leaveHabitTimer("blur");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pageshow", returnToHabitTimer);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pageshow", returnToHabitTimer);
    };
  }, []);

  // Moving to another screen is leaving the clock.
  const firstPath = useRef<string>(`${location.pathname}${location.search}`);
  useEffect(() => {
    const here = `${location.pathname}${location.search}`;
    if (here === firstPath.current) return;
    firstPath.current = here;
    closeHabitTimer();
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (notice === null) return;
    toast(notice, { duration: 5_000 });
    clearHabitTimerNotice();
  }, [notice]);

  const latest = useRef({ settings, decide });
  latest.current = { settings, decide };
  const onFinished = useCallback((): void => {
    const { settings: now, decide: decideNow } = latest.current;
    const avoraMuted = decideNow({ surface: "direct", isFromFamily: false, mentionsRecipient: false }).decidedBy === "avora";
    const allowed = habitChimeAllowed({
      focusActive: activeFocus(now?.focusMode, now?.focusUntil) !== null,
      avoraMuted,
      restWeekday: now?.restWeekday ?? 0,
      now: new Date(),
      soundOn: now?.soundReminders ?? true,
    });
    if (allowed) playSoftTone();
  }, []);

  if (screen?.mode === "back" && session !== null) return <HabitTimerBackCard session={session} today={today} />;
  if (screen !== null && screen.mode !== "back") return <HabitTimerScreen screen={screen} session={session} today={today} onFinished={onFinished} />;
  if (session !== null) return <HabitTimerChip session={session} today={today} onReached={onFinished} />;
  return null;
}
