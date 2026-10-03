import { useSyncExternalStore } from "react";

/**
 * AVORA-81 · C5 — Đọc yên tĩnh on this screen: no strip, no in-app sound while it is on. The server
 * side (`profiles.quiet_reading_until`) holds pushes to this account for at most 3 hours.
 */
let quiet = false;
let missed = 0;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((listener) => listener());

export function setQuietReading(on: boolean): void {
  quiet = on;
  if (on) missed = 0;
  emit();
}

export function isQuietReading(): boolean {
  return quiet;
}

/** A message that arrived while reading quietly. */
export function countMissed(): void {
  missed += 1;
  emit();
}

export function takeMissed(): number {
  const n = missed;
  missed = 0;
  emit();
  return n;
}

export function useQuietReading(): { quiet: boolean; missed: number } {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => `${quiet ? 1 : 0}:${missed}`,
    () => "0:0",
  );
  const [q, m] = snapshot.split(":");
  return { quiet: q === "1", missed: Number(m) };
}
