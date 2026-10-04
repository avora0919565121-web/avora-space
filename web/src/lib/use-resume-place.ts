import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ENTRY_PATH, isRootEntry } from "@/lib/day-open";
import { HOME_ROUTE } from "@/lib/navigation";
import { markNextEntryAsLanding } from "@/lib/nav-history";
import { decideResume, readLeftPlace, wasExplicitOpen, writeLeftPlace } from "@/lib/resume-place";
import { mainScroller } from "@/lib/tab-memory";

/**
 * A phone (AVORA-93 · 5, narrowed by AVORA-94 · 2b). AVORA installed on a computer keeps the old
 * behaviour: each tab remembers its own place (AVORA-77 · G).
 */
export function isResumeDevice(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 767px)").matches;
}

/**
 * AVORA-93 · 5 (ADR-059) — remembers where the app was left (`visibilitychange` → hidden, `pagehide`)
 * and applies `decideResume` at exactly two moments: the cold open (once per account) and coming
 * back to `visible`. Never because the path changed (AVORA-94). Moves always `replace`.
 *
 * `entryPath` is the path the page was loaded with; tests pass their own.
 */
export function useResumePlace(userId: string | undefined, entryPath: string = ENTRY_PATH): void {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef<string>(`${location.pathname}${location.search}`);
  pathRef.current = `${location.pathname}${location.search}`;
  // AVORA-94: `useNavigate()` changes identity on every pathname change; keep it out of the effect's deps.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const entryPathRef = useRef<string>(entryPath);
  // The cold open is judged once per account, even if StrictMode or a remount runs the effect again.
  const appliedForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (userId === undefined) return;
    const save = (): void => {
      writeLeftPlace(userId, { at: Date.now(), path: pathRef.current, scroll: mainScroller()?.scrollTop ?? 0 });
    };
    const apply = (isCold: boolean): void => {
      // A cold open at a specific address came from a notification or a link; the app's own door is `/`.
      const isExplicit = isCold ? !isRootEntry(entryPathRef.current, HOME_ROUTE) : wasExplicitOpen();
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
      const go = navigateRef.current;
      if (decision.kind === "home") go(HOME_ROUTE, { replace: true });
      else if (decision.kind === "connect") go(decision.path, { replace: true });
      else go(decision.path, { replace: true, state: { fromTabMemory: true, scroll: decision.scroll } });
    };
    if (appliedForUserRef.current !== userId) {
      appliedForUserRef.current = userId;
      apply(true);
    }
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") save();
      else apply(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", save);
    };
  }, [userId]);
}
