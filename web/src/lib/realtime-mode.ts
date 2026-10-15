import { supabase } from "@/integrations/supabase/client";

/**
 * 112-D · ADR-091: how this device listens. `broadcast` (default): every event arrives on the person's own
 * private topic `user-<id>`, recipients computed once by the server. `legacy`: the old table subscriptions
 * (`postgres_changes`), kept as the way back. Read from `app_config.realtime_mode`; the last answer is kept
 * on the device so an offline start uses it; with none, `broadcast`.
 */
export type RealtimeMode = "broadcast" | "legacy";

const CACHE_KEY = "avora.realtime-mode";

export function parseRealtimeMode(value: unknown): RealtimeMode {
  return value === "legacy" ? "legacy" : "broadcast";
}

export function cachedRealtimeMode(): RealtimeMode {
  try {
    return parseRealtimeMode(localStorage.getItem(CACHE_KEY));
  } catch {
    return "broadcast";
  }
}

export async function readRealtimeMode(): Promise<RealtimeMode> {
  try {
    const { data, error } = await supabase.from("app_config").select("value").eq("key", "realtime_mode").maybeSingle();
    if (error || data === null) return cachedRealtimeMode();
    const mode = parseRealtimeMode((data as { value?: unknown }).value);
    try {
      localStorage.setItem(CACHE_KEY, mode);
    } catch {
      // Not remembered; the next start asks again.
    }
    return mode;
  } catch {
    return cachedRealtimeMode();
  }
}
