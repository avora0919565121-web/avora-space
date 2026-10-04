import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ENTRY_PATH, isRootEntry } from "@/lib/day-open";
import { HOME_ROUTE } from "@/lib/navigation";
import { markNextEntryAsLanding } from "@/lib/nav-history";
import { decideResume, readLeftPlace, wasExplicitOpen, writeLeftPlace } from "@/lib/resume-place";
import { mainScroller } from "@/lib/tab-memory";

/** A phone, or AVORA installed to a home screen (AVORA-93 · 5). */
export function isResumeDevice(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 767px)").matches || window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * AVORA-93 · 5 (ADR-059) — remembers where the app was left (`visibilitychange` → hidden, `pagehide`)
 * and, on a cold start or on coming back, applies `decideResume`. Moves always `replace`.
 */
export function useResumePlace(userId: string | undefined): void {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef<string>(`${location.pathname}${location.search}`);
  pathRef.current = `${location.pathname}${location.search}`;
  const isColdRef = useRef<boolean>(true);

  useEffect(() => {
    if (userId === undefined) return;
    const save = (): void => {
      writeLeftPlace(userId, { at: Date.now(), path: pathRef.current, scroll: mainScroller()?.scrollTop ?? 0 });
    };
    const apply = (): void => {
      const isCold = isColdRef.current;
      isColdRef.current = false;
      // A cold open at a specific address came from a notification or a link; the app's own door is `/`.
      const isExplicit = isCold ? !isRootEntry(ENTRY_PATH, HOME_ROUTE) : wasExplicitOpen();
      const decision = decideResume({
        now: Date.now(),
        left: readLeftPlace(userId),
        isPhone: isResumeDevice(),
        isExplicit,
        currentPath: pathRef.current,
        homePath: HOME_ROUTE,
      });
      if (decision.kind === "keep") return;
      markNextEntryAsLanding();
      if (decision.kind === "home") navigate(HOME_ROUTE, { replace: true });
      else if (decision.kind === "connect") navigate(decision.path, { replace: true });
      else navigate(decision.path, { replace: true, state: { fromTabMemory: true, scroll: decision.scroll } });
    };
    apply();
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") save();
      else apply();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", save);
    };
  }, [userId, navigate]);
}
