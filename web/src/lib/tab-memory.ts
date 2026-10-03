import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { isGuestMachine } from "@/lib/guest-machine";
import { activeNavEntry, NAV_ITEMS } from "@/lib/navigation";

/**
 * AVORA-77 · G — every tab remembers where you stood.
 *
 * Leaving a tab keeps its full path (sub-tab, shelf, open board / conversation, `?…`) and the scroll
 * of its main content. Pressing that tab again in the nav goes back there; pressing the tab you are
 * already on goes to its root (as iOS does), so there is always a way to the top.
 *
 * Kept on this device per account. On a borrowed machine (AVORA-54) only for this browser tab
 * (`sessionStorage`). Signing out clears it. Never synced between devices. Only paths are kept —
 * never content — and Két sắt still asks to unlock first (its own gate runs on the remembered path).
 */
export type TabPlace = { path: string; scroll: number };
type Memory = Record<string, TabPlace>;

const PREFIX = "avora.tab-memory.v1";

function store(): Storage | null {
  try {
    return isGuestMachine() ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function keyOf(userId: string): string {
  return `${PREFIX}:${userId}`;
}

export function readTabMemory(userId: string | undefined): Memory {
  if (userId === undefined) return {};
  try {
    const raw = store()?.getItem(keyOf(userId));
    if (raw == null) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return {};
    const out: Memory = {};
    for (const [tab, value] of Object.entries(parsed as Record<string, unknown>)) {
      const place = value as Partial<TabPlace> | null;
      if (place !== null && typeof place.path === "string" && isInAppPath(place.path) && tabOfPath(place.path) === tab) {
        out[tab] = { path: place.path, scroll: typeof place.scroll === "number" && place.scroll > 0 ? place.scroll : 0 };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeTabMemory(userId: string, memory: Memory): void {
  try {
    store()?.setItem(keyOf(userId), JSON.stringify(memory));
  } catch {
    // Not remembering is the worst case: the tab opens at its root.
  }
}

/** Only an address inside AVORA, never another site. */
function isInAppPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

/** Which main tab owns a path (`/ke-hoach/ke-sach/doc/…` → `/ke-hoach`). */
export function tabOfPath(path: string): string | null {
  const pathname = path.split(/[?#]/)[0];
  return activeNavEntry(pathname)?.to ?? null;
}

/** Remembers where this tab stands now. One-shot parameters (`?moi=1`) are not worth keeping. */
export function rememberPlace(userId: string | undefined, path: string, scroll: number): void {
  if (userId === undefined) return;
  const tab = tabOfPath(path);
  if (tab === null) return;
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  for (const once of ["moi", "noi", "thay-doi", "nhin-lai", "toan-man"]) params.delete(once);
  const search = params.toString();
  const memory = readTabMemory(userId);
  memory[tab] = { path: search === "" ? pathname : `${pathname}?${search}`, scroll: Math.max(0, Math.round(scroll)) };
  writeTabMemory(userId, memory);
}

/**
 * Where pressing a tab leads: the tab you are on → its root; another tab → where you left it, or
 * its root the first time.
 */
export function tabTarget(tab: string, currentPathname: string, userId: string | undefined): { path: string; scroll: number; remembered: boolean } {
  if (activeNavEntry(currentPathname)?.to === tab) return { path: tab, scroll: 0, remembered: false };
  const place = readTabMemory(userId)[tab];
  if (place === undefined || place.path === tab) return { path: tab, scroll: 0, remembered: false };
  return { path: place.path, scroll: place.scroll, remembered: true };
}

/** Signing out forgets every account's places on this device. */
export function clearTabMemory(): void {
  for (const target of [safe(() => window.localStorage), safe(() => window.sessionStorage)]) {
    if (target === null) continue;
    try {
      for (let index = target.length - 1; index >= 0; index -= 1) {
        const key = target.key(index);
        if (key !== null && key.startsWith(PREFIX)) target.removeItem(key);
      }
    } catch {
      // Nothing more to do.
    }
  }
}

function safe(read: () => Storage): Storage | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/** The page's own scrolling area: marked `data-scroll-memory`, else the first scrolling block inside <main>. */
export function mainScroller(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const marked = document.querySelector<HTMLElement>("main [data-scroll-memory]");
  if (marked !== null) return marked;
  return document.querySelector<HTMLElement>("main .overflow-y-auto");
}

/** The state a tab press carries, so a page can stay quiet when the remembered place is gone. */
export type TabMemoryState = { fromTabMemory: true; scroll: number };

export function isFromTabMemory(state: unknown): state is TabMemoryState {
  return state !== null && typeof state === "object" && (state as { fromTabMemory?: unknown }).fromTabMemory === true;
}

/**
 * Mounted once in the signed-in frame: keeps the current place of the current tab up to date,
 * and puts the scroll back when a tab press brought us to a remembered place.
 */
export function useTabMemory(userId: string | undefined): void {
  const location = useLocation();
  const pathRef = useRef<string>(`${location.pathname}${location.search}`);
  pathRef.current = `${location.pathname}${location.search}`;

  // The place itself, on every move inside the tab.
  useEffect(() => {
    rememberPlace(userId, pathRef.current, 0);
  }, [userId, location.pathname, location.search]);

  // The scroll, while reading (throttled) and right before leaving.
  useEffect(() => {
    if (userId === undefined) return;
    let timer: number | null = null;
    const save = (): void => {
      const scroller = mainScroller();
      rememberPlace(userId, pathRef.current, scroller?.scrollTop ?? 0);
    };
    const onScroll = (): void => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        save();
      }, 400);
    };
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [userId, location.pathname, location.search]);

  // Back at a remembered place: restore its scroll once the content is tall enough (it may still be loading).
  useEffect(() => {
    if (!isFromTabMemory(location.state) || location.state.scroll <= 0) return;
    const wanted = location.state.scroll;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      const scroller = mainScroller();
      if (scroller !== null && scroller.scrollHeight - scroller.clientHeight >= wanted - 4) {
        scroller.scrollTop = wanted;
        window.clearInterval(timer);
      } else if (tries > 30) {
        if (scroller !== null) scroller.scrollTop = wanted;
        window.clearInterval(timer);
      }
    }, 60);
    return () => window.clearInterval(timer);
  }, [location.key, location.state]);
}

/** Every main tab, for tests and the nav. */
export const MEMORY_TABS: readonly string[] = NAV_ITEMS.map((item) => item.to);
