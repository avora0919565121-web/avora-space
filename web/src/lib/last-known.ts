/**
 * KT-06 · B (QA03-04) — the last figures this person saw, for when the network is gone.
 *
 * ONE small store with a plain shape, so screens never know where it lives:
 *   get(userId, key) → { value, at } | null · set(userId, key, value) · clearUser(userId) · clearAll()
 * Every entry is tied to a user id and carries the moment it was written.
 *
 * Today (web) it sits on localStorage, and keeps only the TOTALS a screen shows (Tài sản, Nợ, Giá trị
 * ròng, thu / chi của tháng) — never accounts, transactions, names or notes. Signing out clears it.
 * The native app (CEO 12/11) will swap in an encrypted on-device store with `setLastKnownStore()`;
 * the interface is async for exactly that reason, and no screen changes.
 */

export type Known<T> = { value: T; at: number };

export interface LastKnownStore {
  get<T>(userId: string, key: string): Promise<Known<T> | null>;
  set<T>(userId: string, key: string, value: T): Promise<void>;
  clearUser(userId: string): Promise<void>;
  clearAll(): Promise<void>;
}

const PREFIX = "avora.last-known.v1:";

function storageKey(userId: string, key: string): string {
  return `${PREFIX}${userId}:${key}`;
}

/** The web store: localStorage, totals only, per user. Any failure (private mode, quota) reads as "nothing known". */
export const webLastKnownStore: LastKnownStore = {
  async get<T>(userId: string, key: string): Promise<Known<T> | null> {
    try {
      const raw = window.localStorage.getItem(storageKey(userId, key));
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as { v?: unknown; at?: unknown };
      if (typeof parsed.at !== "number" || parsed.v === undefined) return null;
      return { value: parsed.v as T, at: parsed.at };
    } catch {
      return null;
    }
  },
  async set<T>(userId: string, key: string, value: T): Promise<void> {
    try {
      window.localStorage.setItem(storageKey(userId, key), JSON.stringify({ v: value, at: Date.now() }));
    } catch {
      // Not remembered this time; the screen still shows the live figure.
    }
  },
  async clearUser(userId: string): Promise<void> {
    removeWhere((name) => name.startsWith(`${PREFIX}${userId}:`));
  },
  async clearAll(): Promise<void> {
    removeWhere((name) => name.startsWith(PREFIX));
  },
};

function removeWhere(test: (name: string) => boolean): void {
  try {
    const names: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const name = window.localStorage.key(i);
      if (name !== null && test(name)) names.push(name);
    }
    for (const name of names) window.localStorage.removeItem(name);
  } catch {
    // Nothing to clear.
  }
}

let current: LastKnownStore = webLastKnownStore;

/** The native shell calls this once at start with its encrypted store. */
export function setLastKnownStore(store: LastKnownStore): void {
  current = store;
}

export const lastKnown: LastKnownStore = {
  get: (userId, key) => current.get(userId, key),
  set: (userId, key, value) => current.set(userId, key, value),
  clearUser: (userId) => current.clearUser(userId),
  clearAll: () => current.clearAll(),
};

/** `cập nhật lúc 14:05` today, `cập nhật lúc 14:05 · 11/11` on another day. */
export function knownAtLine(at: number, now: number = Date.now()): string {
  const when = new Date(at);
  const today = new Date(now);
  const hhmm = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  const sameDay = when.getFullYear() === today.getFullYear() && when.getMonth() === today.getMonth() && when.getDate() === today.getDate();
  return sameDay ? `cập nhật lúc ${hhmm}` : `cập nhật lúc ${hhmm} · ${when.getDate()}/${when.getMonth() + 1}`;
}
