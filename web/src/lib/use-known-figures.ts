import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth";
import { lastKnown, type Known } from "@/lib/last-known";
import { useOnline } from "@/lib/use-online";

/**
 * KT-06 · B: what a total on screen may say.
 *  · live     — fresh from the server (offline = it is still what we last read; the screen says so);
 *  · known    — no live data now, but the figures last seen on this device (with their time);
 *  · loading  — being read;
 *  · unknown  — nothing to show: the screen says "chưa tải được", never "0 ₫".
 */
export type Figures<T> =
  | { kind: "live"; value: T; at: number; offline: boolean }
  | { kind: "known"; value: T; at: number }
  | { kind: "loading" }
  | { kind: "unknown" };

export function useKnownFigures<T>(
  key: string,
  live: T | null,
  state: { isLoading: boolean; isUnavailable: boolean; updatedAt: number },
): Figures<T> {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const online = useOnline();
  const [known, setKnown] = useState<Known<T> | null | undefined>(undefined);
  const serial = live === null ? null : JSON.stringify(live);

  // Remember the totals each time they change (only the totals the screen shows — see last-known.ts).
  useEffect(() => {
    if (userId === null || serial === null || !online) return;
    void lastKnown.set(userId, key, JSON.parse(serial) as T);
  }, [userId, key, serial, online]);

  // Nothing live and nothing coming: read what this device last saw.
  const needKnown = live === null && state.isUnavailable;
  useEffect(() => {
    if (!needKnown || userId === null) return;
    let alive = true;
    void lastKnown.get<T>(userId, key).then((found) => {
      if (alive) setKnown(found);
    });
    return () => {
      alive = false;
    };
  }, [needKnown, userId, key]);

  return useMemo<Figures<T>>(() => {
    if (live !== null) return { kind: "live", value: live, at: state.updatedAt, offline: !online };
    if (!state.isUnavailable) return { kind: "loading" };
    if (known === undefined) return { kind: "loading" };
    if (known === null) return { kind: "unknown" };
    return { kind: "known", value: known.value, at: known.at };
  }, [live, state.updatedAt, state.isUnavailable, online, known]);
}
