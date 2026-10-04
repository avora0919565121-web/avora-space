import { useEffect, useSyncExternalStore } from "react";

/**
 * AVORA-89 · 2.3 (ADR-053 / ADR-057) — "one thing to focus on". A screen that opens one thing
 * (a board, the template library) takes over the phone's top row: `‹ · name + one line`, no logo,
 * and the bottom tab bar steps aside. Only one owner at a time; the last mounted wins.
 */
export type FocusHeader = { title: string; subtitle: string | null; onBack: () => void };

let current: FocusHeader | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFocusHeaderValue(): FocusHeader | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

/** While `header` is non-null, the phone's top row shows it instead of `A · tab name`. */
export function useFocusHeader(header: FocusHeader | null): void {
  const title = header?.title ?? null;
  const subtitle = header?.subtitle ?? null;
  const onBack = header?.onBack ?? null;
  useEffect(() => {
    if (title === null || onBack === null) return;
    const mine: FocusHeader = { title, subtitle, onBack };
    current = mine;
    emit();
    return () => {
      if (current === mine) {
        current = null;
        emit();
      }
    };
  }, [title, subtitle, onBack]);
}
