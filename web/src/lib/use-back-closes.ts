import { useEffect, useRef } from "react";

/**
 * AVORA-94B · luật 5 (ADR-062) — every overlay (sheet, dialog, alert, floating panel, photo viewer,
 * lookup card…) closes on Back first, never the screen beneath.
 *
 * While an overlay is open one history entry is added for it; Back pops that entry and closes the
 * top overlay only. On a normal close the entry is taken back if it is still the current one (a
 * navigation started from inside the overlay is never undone). `closeTopOverlay()` lets `‹`, the
 * edge swipe and Escape-less paths close the same top overlay.
 */
type Open = { token: string; close: () => void };
const openStack: Open[] = [];
/**
 * AVORA-104 · 1: history entries left by overlays that already closed (e.g. one that was swapped
 * for another before its own clean-up could step back). Landing on one must not read as "Back"
 * for whatever overlay is open beneath — that closed Sửa nhiệm vụ right after a day was picked.
 */
const closedTokens = new Set<string>();

/** Closes the top open overlay. False when none is open. */
export function closeTopOverlay(): boolean {
  const top = openStack[openStack.length - 1];
  if (top === undefined) return false;
  top.close();
  return true;
}

export function hasOpenOverlay(): boolean {
  return openStack.length > 0;
}

export function useBackCloses(isActive: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!isActive || typeof window === "undefined") return;
    const token = `overlay-${Math.random().toString(36).slice(2)}`;
    const entry: Open = { token, close: () => closeRef.current() };
    openStack.push(entry);
    const base = (window.history.state ?? {}) as Record<string, unknown>;
    window.history.pushState({ ...base, avoraSheet: token }, "");
    let closedByBack = false;

    const onPop = (event: PopStateEvent): void => {
      const isTop = openStack[openStack.length - 1]?.token === token;
      const state = (event.state ?? {}) as Record<string, unknown>;
      if (!isTop || state.avoraSheet === token) return;
      if (typeof state.avoraSheet === "string" && closedTokens.has(state.avoraSheet)) {
        // An orphan step of a closed overlay: walk past it, close nothing.
        closedTokens.delete(state.avoraSheet);
        event.stopImmediatePropagation();
        window.history.back();
        return;
      }
      closedByBack = true;
      // Stop the router from treating this Back as a page change.
      event.stopImmediatePropagation();
      closeRef.current();
    };
    // Capture: ahead of the router's own popstate listener.
    window.addEventListener("popstate", onPop, true);

    return () => {
      window.removeEventListener("popstate", onPop, true);
      const at = openStack.findIndex((item) => item.token === token);
      if (at !== -1) openStack.splice(at, 1);
      if (closedByBack) return;
      closedTokens.add(token);
      // One tick later, and only if nothing navigated meanwhile: a close never undoes a navigation.
      window.setTimeout(() => {
        const current = (window.history.state ?? {}) as Record<string, unknown>;
        if (current.avoraSheet === token) {
          closedTokens.delete(token);
          window.history.back();
        }
      }, 0);
    };
  }, [isActive]);
}

/** Renders nothing; binds Back to an overlay while it is mounted. */
export function BackClosesBinding({ close }: { close: () => void }) {
  useBackCloses(true, close);
  return null;
}
