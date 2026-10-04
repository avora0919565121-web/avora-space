import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { goBack, isAreaRoot, TAB_ROOT_EVENT, tabRootOf } from "@/lib/go-back";
import { closeTopOverlay } from "@/lib/use-back-closes";

/** Left edge width that starts a back swipe, and the travel that completes it (AVORA-94B · A5). */
export const EDGE_PX = 20;
export const EDGE_TRAVEL_PX = 60;
export const EDGE_DRIFT_PX = 30;
const HINT_KEY = "avora.nav.hold-back-hint-seen.v2";

function isStandalone(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
}

function isPhone(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
}

/**
 * AVORA-94B · luật 1 / 3 / 5 (ADR-062), mounted once in the signed-in shell:
 * - installed app only (Safari / Chrome keep their own gesture): a swipe from the left 20 px is `‹`
 *   — it closes the top overlay first, else steps back one screen;
 * - the first time a phone reaches a screen without the logo, one quiet line (AVORA-100 · C mục 4.4):
 *   `Chạm ‹ để lùi · Giữ ‹ để về đầu {tên tab}`;
 * - a held `‹` (goToTabRoot) says `Về đầu {tab}` for 1.5 s.
 */
export function NavGestures() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isHintShown, setIsHintShown] = useState<boolean>(false);
  const [rootNotice, setRootNotice] = useState<string | null>(null);

  useEffect(() => {
    let timer: number | null = null;
    const onRoot = (event: Event): void => {
      const label = (event as CustomEvent<string>).detail;
      setRootNotice(label);
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setRootNotice(null), 1500);
    };
    window.addEventListener(TAB_ROOT_EVENT, onRoot);
    return () => {
      window.removeEventListener(TAB_ROOT_EVENT, onRoot);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!isStandalone()) return;
    let start: { x: number; y: number } | null = null;
    const onStart = (event: TouchEvent): void => {
      const touch = event.touches[0];
      start = touch !== undefined && touch.clientX <= EDGE_PX ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onEnd = (event: TouchEvent): void => {
      const touch = event.changedTouches[0];
      const from = start;
      start = null;
      if (from === null || touch === undefined) return;
      const dx = touch.clientX - from.x;
      if (dx < EDGE_TRAVEL_PX || Math.abs(touch.clientY - from.y) >= EDGE_DRIFT_PX) return;
      if (closeTopOverlay()) return;
      goBack(navigate, window.location);
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, [navigate]);

  const isInside = !isAreaRoot(location);
  const rootLabel = tabRootOf(location).label;
  useEffect(() => {
    if (!isInside || !isPhone()) return;
    try {
      if (window.localStorage.getItem(HINT_KEY) === "1") return;
      window.localStorage.setItem(HINT_KEY, "1");
    } catch {
      return;
    }
    setIsHintShown(true);
    const timer = window.setTimeout(() => setIsHintShown(false), 4000);
    return () => window.clearTimeout(timer);
  }, [isInside]);

  return (
    <>
      {/* The edge strip the swipe starts on: vertical scrolling still passes through. */}
      <div aria-hidden="true" data-edge-swipe="" className="pointer-events-none fixed inset-y-0 left-0 z-[1] w-5 [touch-action:pan-y]" />
      {isHintShown ? (
        <p
          role="status"
          data-hold-back-hint=""
          className="animate-rise-in pointer-events-none fixed inset-x-0 z-[70] mx-auto w-fit rounded-full bg-foreground/85 px-3.5 py-1.5 text-[12.5px] font-medium text-background shadow-md"
          style={{ top: "calc(env(safe-area-inset-top) + 60px)" }}
        >
          Chạm ‹ để lùi · Giữ ‹ để về đầu {rootLabel}
        </p>
      ) : null}
      {rootNotice !== null ? (
        <p
          role="status"
          data-tab-root-notice=""
          className="animate-rise-in pointer-events-none fixed inset-x-0 z-[70] mx-auto w-fit rounded-full bg-foreground/85 px-3.5 py-1.5 text-[12.5px] font-medium text-background shadow-md"
          style={{ top: "calc(env(safe-area-inset-top) + 60px)" }}
        >
          Về đầu {rootNotice}
        </p>
      ) : null}
    </>
  );
}
