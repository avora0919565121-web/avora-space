import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import { supabase } from "@/integrations/supabase/client";
import { ACTIVITY_FLUSH_MS, chunkSeconds, countableMs, countsTime, localDay, type ActivityKind } from "@/lib/activity";
import { useAuth } from "@/lib/auth";

const PENDING_KEY = "avora.activity.pending.v1";
type Pending = { kind: ActivityKind; key: string; day: string; seconds: number };

function readPending(): Pending[] {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    const list = raw === null ? [] : (JSON.parse(raw) as Pending[]);
    const yesterday = localDay(Date.now() - 86_400_000);
    // At most a day kept offline; older seconds are dropped rather than sent with a stale day.
    return Array.isArray(list) ? list.filter((item) => item.day >= yesterday && item.seconds > 0) : [];
  } catch {
    return [];
  }
}

function writePending(list: Pending[]): void {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    // Without storage, offline seconds are simply lost.
  }
}

async function send(kind: ActivityKind, key: string, day: string, open: boolean, seconds: number): Promise<boolean> {
  const { error } = await supabase.rpc("log_activity", { p_kind: kind, p_item_key: key, p_day: day, p_open: open, p_seconds: seconds });
  return error === null;
}

async function flushPending(): Promise<void> {
  const pending = readPending();
  if (pending.length === 0) return;
  writePending([]);
  const failed: Pending[] = [];
  for (const item of pending) {
    for (const part of chunkSeconds(item.seconds)) {
      if (!(await send(item.kind, item.key, item.day, false, part))) failed.push({ ...item, seconds: part });
    }
  }
  if (failed.length > 0) writePending([...readPending(), ...failed]);
}

function queue(kind: ActivityKind, key: string, seconds: number): void {
  const day = localDay();
  const list = readPending();
  const same = list.find((item) => item.kind === kind && item.key === key && item.day === day);
  if (same !== undefined) same.seconds += seconds;
  else list.push({ kind, key, day, seconds });
  writePending(list);
}

/**
 * AVORA-93 · PHẦN 2 — counts one open and then the time this board / book is really in use:
 * visible tab + a touch, scroll, key or page turn in the last 2 minutes. Sends every 60 s and on
 * leaving; offline seconds wait on this device (≤ 1 day).
 */
export function useActivityMeter(kind: ActivityKind, key: string | null): { touch: () => void } {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const lastInteraction = useRef<number>(Date.now());
  const touchRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (user?.id === undefined || key === null || key === "") return;
    const timesIt = countsTime(kind, key);
    let from = Date.now();
    lastInteraction.current = from;
    let carried = 0;
    void send(kind, key, localDay(), true, 0).then(() => void flushPending());

    const take = (): void => {
      const now = Date.now();
      carried += countableMs({ from, to: now, lastInteraction: lastInteraction.current, isVisible: document.visibilityState === "visible" });
      from = now;
    };
    const flush = (): void => {
      take();
      const seconds = Math.floor(carried / 1000);
      if (!timesIt || seconds <= 0) return;
      carried -= seconds * 1000;
      if (!navigator.onLine) {
        queue(kind, key, seconds);
        return;
      }
      for (const part of chunkSeconds(seconds)) {
        void send(kind, key, localDay(), false, part).then((ok) => {
          if (!ok) queue(kind, key, part);
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["room-stats"] });
    };
    const touch = (): void => {
      take();
      lastInteraction.current = Date.now();
    };
    touchRef.current = touch;
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true, capture: true });
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") flush();
      else {
        from = Date.now();
        lastInteraction.current = from;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", flushPending);
    const timer = window.setInterval(flush, ACTIVITY_FLUSH_MS);
    return () => {
      flush();
      window.clearInterval(timer);
      for (const name of events) window.removeEventListener(name, touch, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", flushPending);
      touchRef.current = () => undefined;
    };
  }, [user?.id, kind, key, queryClient]);

  // Stable, so callers can list it in their hook dependencies.
  return useMemo(() => ({ touch: () => touchRef.current() }), []);
}

export type RoomStatItem = { board_key: string; name: string | null; value: number };
export type RoomViewed = { kind: ActivityKind; item_key: string; name: string | null; opens: number; seconds: number; last_day: string };
export type RoomStats = {
  boards_by_status: { waiting: number; thinking: number; concluded: number };
  records_total: number;
  records_new: number;
  open_tasks: number;
  top_items: RoomStatItem[];
  top_opens: RoomStatItem[];
  top_time: RoomStatItem[];
  viewed: RoomViewed[];
};

/** `think_hub_room_stats(since)` — my numbers only (kệ 2, kệ 5). */
export function useRoomStats(since: string, enabled: boolean) {
  const { user } = useAuth();
  return useQuery<RoomStats, Error>({
    queryKey: ["room-stats", user?.id ?? "none", since],
    enabled: enabled && Boolean(user?.id),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("think_hub_room_stats", { p_since: since });
      if (error) throw new Error("Không tải được số liệu.");
      return normalizeRoomStats(data);
    },
  });
}

/** Per-day book reading seconds this week (kệ 5), straight from my own rows. */
export function useReadingDays(fromDay: string, enabled: boolean) {
  const { user } = useAuth();
  return useQuery<{ day: string; item_key: string; active_seconds: number }[], Error>({
    queryKey: ["room-stats", "reading", user?.id ?? "none", fromDay],
    enabled: enabled && Boolean(user?.id),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("activity_daily").select("day, item_key, active_seconds").eq("kind", "book").gte("day", fromDay);
      if (error) throw new Error("Không tải được thời gian đọc.");
      return data ?? [];
    },
  });
}

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Reads the RPC's JSON defensively: anything missing counts as zero / empty. */
export function normalizeRoomStats(raw: unknown): RoomStats {
  const data = (raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const status = (data.boards_by_status ?? {}) as Record<string, unknown>;
  return {
    boards_by_status: { waiting: num(status.waiting), thinking: num(status.thinking), concluded: num(status.concluded) },
    records_total: num(data.records_total),
    records_new: num(data.records_new),
    open_tasks: num(data.open_tasks),
    top_items: list<RoomStatItem>(data.top_items),
    top_opens: list<RoomStatItem>(data.top_opens),
    top_time: list<RoomStatItem>(data.top_time),
    viewed: list<RoomViewed>(data.viewed),
  };
}
