import { createClient } from "@supabase/supabase-js";

import type { Database } from "./types";
import { isGuestMachine } from "@/lib/guest-machine";
import { clampStoredSession, makeClockSafeFetch } from "@/lib/auth-clock";

const supabaseUrl: string = import.meta.env.EXPO_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey: string = import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

/**
 * AVORA-54 · A — the session lives in sessionStorage on a guest machine ("Đây là máy của người
 * khác"), in localStorage everywhere else. The choice is re-read on every call: the flag is set
 * before the sign-in that must be kept, so the session is written to the right store, and on a
 * reload the surviving flag keeps reading the same store. `removeItem` clears both stores so a
 * sign-out leaves nothing behind in either.
 *
 * Lỗi 01/11: when a write fails (storage full, private mode) the new session is kept in memory
 * and read from there, so this tab never falls back to an older, already-rotated session.
 */
const memorySession = new Map<string, string>();
const authStorage = {
  getItem: (key: string): string | null => {
    const kept = memorySession.get(key);
    if (kept !== undefined) return kept;
    try {
      const raw = isGuestMachine() ? window.sessionStorage.getItem(key) : window.localStorage.getItem(key);
      return clampStoredSession(raw, Date.now());
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      (isGuestMachine() ? window.sessionStorage : window.localStorage).setItem(key, value);
      memorySession.delete(key);
    } catch {
      memorySession.set(key, value);
    }
  },
  removeItem: (key: string): void => {
    memorySession.delete(key);
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Ignored — the other store is cleared below regardless.
    }
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignored — nothing more this tab can do.
    }
  },
};

/** Single Supabase client for the whole app. supabase-js owns the session. */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: authStorage,
  },
  global: { fetch: makeClockSafeFetch() },
});
