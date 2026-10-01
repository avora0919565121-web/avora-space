import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { stripReturn } from "@/lib/return-to";

/**
 * AVORA-53 · 2.2 — "Về là về thật". The router stamps each history entry with an index
 * (`history.state.idx`); remembering which path sat at which index lets a way-back chip go
 * back one step when the place it names is the entry just behind, instead of pushing a new
 * entry and making Back bounce A ↔ B.
 */
const pathsByIndex = new Map<number, string>();

function currentIndex(): number | null {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx : null;
}

/** Mounted once in the signed-in shell. */
export function useTrackHistory(): void {
  const location = useLocation();
  useEffect(() => {
    const idx = currentIndex();
    if (idx === null) return;
    pathsByIndex.set(idx, stripReturn(`${location.pathname}${location.search}`));
    // Entries beyond this one were replaced by a new branch.
    for (const key of [...pathsByIndex.keys()]) if (key > idx + 50) pathsByIndex.delete(key);
  }, [location.pathname, location.search]);
}

/** Whether the entry just behind this one is `path` (compared without the way-back params). */
export function isPreviousEntry(path: string): boolean {
  const idx = currentIndex();
  if (idx === null || idx === 0) return false;
  return pathsByIndex.get(idx - 1) === stripReturn(path);
}

/** For tests. */
export function rememberEntry(idx: number, path: string): void {
  pathsByIndex.set(idx, stripReturn(path));
}
