import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Draggable column widths for the desktop three-column layout (nav | list | detail).
 *
 * Each column owns one localStorage key — the choice is per device on purpose, not part of
 * the account. The stored pixel width is clamped back into range on read, so a value saved
 * by an older build can never leave a column unusable. Below `md` nothing applies: the
 * single-column phone layout is not resizable and is never given a width.
 */

export type ColumnSpec = {
  readonly key: string;
  readonly min: number;
  readonly max: number;
  readonly fallback: number;
};

/** Thanh điều hướng: wide enough for the longest label, never wider than a third of a laptop. */
export const NAV_COLUMN: ColumnSpec = { key: "nav", min: 200, max: 360, fallback: 240 };
/** Danh sách: the inbox/ledger column, kept out of both unreadable and ridiculous. */
export const LIST_COLUMN: ColumnSpec = { key: "list", min: 280, max: 520, fallback: 360 };

export function storageKey(key: string): string {
  return `avora.column.${key}`;
}

const DESKTOP_QUERY = "(min-width: 768px)";

export function clampColumnWidth(px: number, spec: ColumnSpec): number {
  return Math.min(spec.max, Math.max(spec.min, Math.round(px)));
}

/** A stored value, believed only as far as it can be clamped; anything else is the default. */
export function parseColumnWidth(raw: string | null, spec: ColumnSpec): number {
  if (raw === null) return spec.fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return spec.fallback;
  return clampColumnWidth(parsed, spec);
}

export type ColumnWidthControl = {
  /** Current width in px — applied only while `isDesktop`. */
  width: number;
  isDesktop: boolean;
  /** Sets the width (clamped) and remembers it. */
  resize: (px: number) => void;
  /** Keyboard and double-click helpers move/reset relative to the current width. */
  nudge: (delta: number) => void;
  /** Back to the default, and the stored choice is forgotten. */
  reset: () => void;
};

export function useColumnWidth(spec: ColumnSpec): ColumnWidthControl {
  const [width, setWidth] = useState<number>(spec.fallback);
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window === "undefined" ? false : window.matchMedia(DESKTOP_QUERY).matches,
  );
  // Drag events arrive faster than renders; the ref keeps each move reading the latest width.
  const widthRef = useRef<number>(spec.fallback);
  widthRef.current = width;

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(storageKey(spec.key));
    } catch {
      // Private mode or blocked storage: the default simply applies.
    }
    setWidth(parseColumnWidth(stored, spec));

    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setIsDesktop(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [spec.key, spec.min, spec.max, spec.fallback]);

  const persist = useCallback((next: number): void => {
    try {
      window.localStorage.setItem(storageKey(spec.key), String(next));
    } catch {
      // Same deal as reading: no storage, no memory — the layout still works.
    }
  }, [spec.key]);

  const resize = useCallback(
    (px: number): void => {
      const next = clampColumnWidth(px, spec);
      widthRef.current = next;
      setWidth(next);
      persist(next);
    },
    [spec, persist],
  );

  const nudge = useCallback(
    (delta: number): void => {
      resize(widthRef.current + delta);
    },
    [resize],
  );

  const reset = useCallback((): void => {
    widthRef.current = spec.fallback;
    setWidth(spec.fallback);
    try {
      window.localStorage.removeItem(storageKey(spec.key));
    } catch {
      // Nothing to forget if storage is unavailable.
    }
  }, [spec.key, spec.fallback]);

  return { width, isDesktop, resize, nudge, reset };
}
