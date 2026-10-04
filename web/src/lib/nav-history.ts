import { useLayoutEffect, useSyncExternalStore } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

import { stripReturn } from "@/lib/return-to";

/**
 * AVORA-53 · 2.2 / AVORA-94B (ADR-062) — the screens this tab has actually walked through, as the
 * router saw them (`location.key`). `‹` steps back only onto one of these, so it never leaves
 * AVORA and never lands on a screen the person did not come from.
 *
 * PUSH adds an entry, REPLACE swaps the top one, POP to a known key trims back to it. Tracked by
 * key rather than `window.history.state.idx`, so it is the same under every router (and in tests).
 */
type Entry = { key: string; path: string; noBack: boolean; scroll: number };

const stack: Entry[] = [];
let markNextNoBack = false;
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** The next entry the router settles on is a fresh landing (reopen / notification): nothing behind it. */
export function markNextEntryAsLanding(): void {
  markNextNoBack = true;
}

/** Whether `‹` can step back to a page inside the app (one the person actually came from). */
export function hasInAppPrevious(): boolean {
  const top = stack[stack.length - 1];
  return top !== undefined && !top.noBack && stack.length > 1;
}

/** The in-app path one step behind, when there is one (for the `‹` label). */
export function previousEntryPath(): string | null {
  return hasInAppPrevious() ? (stack[stack.length - 2]?.path ?? null) : null;
}

/** AVORA-100 · C: the walked screens, oldest first (for `goToTabRoot`). */
export function walkedEntries(): readonly { path: string; noBack: boolean }[] {
  return stack.map((item) => ({ path: item.path, noBack: item.noBack }));
}

/** Whether the screen just behind is exactly `path` (compared without the way-back params). */
export function isPreviousEntry(path: string): boolean {
  return previousEntryPath() === stripReturn(path);
}

/** Re-renders a component when the walked path changes (the `‹` label follows it). */
export function useHistoryVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => 0,
  );
}

/** Mounted once in the signed-in shell. */
export function useTrackHistory(): void {
  const location = useLocation();
  const type = useNavigationType();
  useLayoutEffect(() => {
    const top = stack[stack.length - 1];
    if (top?.key === location.key) return;
    const noBack = markNextNoBack;
    markNextNoBack = false;
    const entry: Entry = { key: location.key, path: stripReturn(`${location.pathname}${location.search}`), noBack, scroll: 0 };
    if (type === "POP") {
      const at = stack.findIndex((item) => item.key === location.key);
      if (at !== -1) {
        stack.length = at + 1;
        // AVORA-94B · luật 1: stepping back lands at the same scroll the screen was left at.
        restoreScroll(stack[at]?.scroll ?? 0);
      } else {
        // A router's first location (page load), or a step to an entry this tab never saw: the walk starts here.
        if (location.key === "default") stack.length = 0;
        stack.push(entry);
      }
    } else if (type === "REPLACE" && top !== undefined) {
      stack[stack.length - 1] = { ...entry, noBack: noBack || top.noBack };
    } else {
      stack.push(entry);
      if (stack.length > 100) stack.splice(0, stack.length - 100);
    }
    emit();
  }, [location.key, location.pathname, location.search, type]);
}

/** The page's own scrolling area (same rule as tab memory). */
function scroller(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const marked = document.querySelector<HTMLElement>("main [data-scroll-memory]");
  if (marked !== null) return marked;
  for (const element of document.querySelectorAll<HTMLElement>("main *")) {
    const overflow = getComputedStyle(element).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && element.scrollHeight > element.clientHeight) return element;
  }
  return null;
}

function restoreScroll(wanted: number): void {
  if (wanted <= 0 || typeof window === "undefined") return;
  let tries = 0;
  const timer = window.setInterval(() => {
    tries += 1;
    const element = scroller();
    if (element !== null && element.scrollHeight - element.clientHeight >= wanted - 4) {
      element.scrollTop = wanted;
      window.clearInterval(timer);
    } else if (tries > 30) {
      if (element !== null) element.scrollTop = wanted;
      window.clearInterval(timer);
    }
  }, 60);
}

/** Keeps the current screen's scroll on its entry, so Back can bring it back. */
export function useTrackScroll(): void {
  useLayoutEffect(() => {
    const onScroll = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.closest("main") === null) return;
      const top = stack[stack.length - 1];
      if (top !== undefined && target === scroller()) top.scroll = target.scrollTop;
    };
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);
}

/** For tests: start a fresh walk. */
export function resetNavHistory(): void {
  stack.length = 0;
  markNextNoBack = false;
  emit();
}
