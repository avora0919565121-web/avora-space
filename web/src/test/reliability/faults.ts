/**
 * 112-A · 3 — fault injection for one session's "network" (each person has their own).
 *
 * (a) cut / restore: `offline()` / `online()` — requests fail like a dropped fetch
 *     (`TypeError: Failed to fetch`), the realtime socket closes, and comes back with a fresh
 *     SUBSCRIBED (what supabase-js does on reconnect).
 * (b) slow: `slow({ latencyMs, jitterMs })` — every request and every pushed event waits.
 * (c) close / reopen mid-action: see `Session.reload()` in two-people.tsx (unmounts the whole
 *     app copy and starts a fresh one over the same device storage).
 * (d) double tap: `userEvent.dblClick` on the real control (see the tests).
 * (e) session expiry: `expireSession()` — the server answers `JWT expired` (401) until `renewSession()`.
 * Random faults: `chaos({ dropRequest, dropResponse, seed })` — a request lost on the way out (the
 * server never saw it) or a reply lost on the way back (the server DID apply it): the second is
 * the one that makes duplicates when a client is careless.
 */
export type NetworkStats = {
  requests: number;
  droppedRequests: number;
  droppedResponses: number;
  expiredReplies: number;
  offlineRefusals: number;
};

export type ChaosOptions = { dropRequest: number; dropResponse: number; seed: number };

export const NETWORK_ERROR_MESSAGE = "TypeError: Failed to fetch";

/** Small seeded PRNG so a failing chaos run can be replayed with the same seed. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class NetworkConditioner {
  isOffline = false;
  isExpired = false;
  latencyMs = 0;
  jitterMs = 0;
  private chaosOptions: ChaosOptions | null = null;
  private random: () => number = Math.random;
  readonly stats: NetworkStats = { requests: 0, droppedRequests: 0, droppedResponses: 0, expiredReplies: 0, offlineRefusals: 0 };
  private readonly listeners = new Set<(online: boolean) => void>();

  onChange(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  offline(): void {
    if (this.isOffline) return;
    this.isOffline = true;
    this.listeners.forEach((listener) => listener(false));
  }

  online(): void {
    if (!this.isOffline) return;
    this.isOffline = false;
    this.listeners.forEach((listener) => listener(true));
    // The page hears the network come back, as a real browser tab would.
    window.dispatchEvent(new Event("online"));
  }

  slow(options: { latencyMs: number; jitterMs?: number }): void {
    this.latencyMs = options.latencyMs;
    this.jitterMs = options.jitterMs ?? 0;
  }

  chaos(options: ChaosOptions | null): void {
    this.chaosOptions = options;
    this.random = options === null ? Math.random : mulberry32(options.seed);
  }

  expireSession(): void {
    this.isExpired = true;
  }

  renewSession(): void {
    this.isExpired = false;
  }

  /** One hop of delay (each direction pays it). */
  async delay(): Promise<void> {
    const wait = this.latencyMs + (this.jitterMs > 0 ? Math.floor(this.random() * this.jitterMs) : 0);
    if (wait > 0) await sleep(wait);
  }

  /**
   * Carries one request to the server and its reply back, applying the faults. `apply` runs only
   * when the request really reached the server.
   */
  async carry<T extends { data: unknown; error: unknown }>(apply: () => T): Promise<T | { data: null; error: { message: string; code?: string; status?: number } }> {
    this.stats.requests += 1;
    await this.delay();
    if (this.isOffline) {
      this.stats.offlineRefusals += 1;
      return { data: null, error: { message: NETWORK_ERROR_MESSAGE } };
    }
    if (this.isExpired) {
      this.stats.expiredReplies += 1;
      return { data: null, error: { message: "JWT expired", code: "PGRST301", status: 401 } };
    }
    if (this.chaosOptions !== null && this.random() < this.chaosOptions.dropRequest) {
      this.stats.droppedRequests += 1;
      return { data: null, error: { message: NETWORK_ERROR_MESSAGE } };
    }
    const reply = apply();
    await this.delay();
    if (this.chaosOptions !== null && this.random() < this.chaosOptions.dropResponse) {
      this.stats.droppedResponses += 1;
      return { data: null, error: { message: NETWORK_ERROR_MESSAGE } };
    }
    if (this.isOffline) {
      this.stats.droppedResponses += 1;
      return { data: null, error: { message: NETWORK_ERROR_MESSAGE } };
    }
    return reply;
  }
}
