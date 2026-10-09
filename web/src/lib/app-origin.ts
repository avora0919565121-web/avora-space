/**
 * KHỐI 0 (09/10) — the one address of AVORA. Every link that leaves the app (emails, invites, QR,
 * device confirmations) is built from APP_ORIGIN, never from the address the person happens to
 * have open. Change it in one place: `EXPO_PUBLIC_APP_ORIGIN` (or the fallback below).
 *
 * Mirrored on the server by `private.app_origin_primary()` — keep the two equal.
 */
export const APP_ORIGIN: string = normalizeOrigin(
  (import.meta.env.EXPO_PUBLIC_APP_ORIGIN as string | undefined) ?? "https://avorachat.com",
);

/** Rork's own preview of this project: keeps running the app so it can be tested before publishing. */
export const PREVIEW_HOST_PATTERN = /^9gn7yyx8sbtban1pcozwb-web\.rork\.live$/;

/** Older addresses of AVORA. They no longer run the app (see `hostRoleOf`). */
export const RETIRED_HOSTS: readonly string[] = ["avoraspace.rork.app", "myavora.rork.app", "9gn7yyx8sbtban1pcozwb.rork.app"];

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export type HostRole =
  /** The real address — the app runs. */
  | "primary"
  /** Rork preview, localhost, tests — the app runs, links still point at APP_ORIGIN. */
  | "dev"
  /** Same owner, no data of its own (www.) — sent straight on. */
  | "alias"
  /** An old address: the app does not start, only "Avora đã chuyển". */
  | "retired";

/** What this host is to AVORA. Unknown hosts are treated as old addresses: one address only. */
export function hostRoleOf(hostname: string, primaryOrigin: string = APP_ORIGIN): HostRole {
  const host = hostname.toLowerCase();
  const primaryHost = new URL(primaryOrigin).hostname;
  if (host === primaryHost) return "primary";
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".local")) return "dev";
  if (PREVIEW_HOST_PATTERN.test(host)) return "dev";
  // Rork's sandbox preview host while building.
  if (host.endsWith(".e2b.app") || host.endsWith(".e2b.dev")) return "dev";
  if (host === `www.${primaryHost}`) return "alias";
  return "retired";
}

/** The same page on the real address — path, query and hash kept. */
export function movedUrl(location: { pathname: string; search: string; hash: string }, primaryOrigin: string = APP_ORIGIN): string {
  return `${primaryOrigin}${location.pathname}${location.search}${location.hash}`;
}

/** Display form of the address: `avorachat.com`. */
export const APP_HOST: string = new URL(APP_ORIGIN).hostname;
