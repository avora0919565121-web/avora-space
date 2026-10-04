import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { goBack, isAreaRoot } from "@/lib/go-back";
import { closeTopOverlay } from "@/lib/use-back-closes";

/** Left edge width that starts a back swipe, and the travel that completes it (AVORA-94B · A5). */
export const EDGE_PX = 20;
export const EDGE_TRAVEL_PX = 60;
export const EDGE_DRIFT_PX = 30;
const HINT_KEY = "avora.nav.hold-back-hint-seen";

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
 * - the first time a phone reaches a screen without the logo, one quiet line: `Giữ ‹ để mở các tab`.
 */
export function NavGestures() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isHintShown, setIsHintShown] = useState<boolean>(false);

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
          Giữ ‹ để mở các tab
        </p>
      ) : null}
    </>
  );
}
