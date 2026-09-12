/*
 * AVORA service worker — deliberately minimal.
 *
 * Its only jobs are (1) to make the app installable on Android/Chrome, which
 * requires a fetch handler, and (2) to survive a flaky connection for static
 * build output. It is NOT an offline mode.
 *
 * Two rules are load-bearing and must never be relaxed:
 *   - Nothing from Supabase (API / RPC / Realtime / Storage / Auth) is ever
 *     read from or written to the cache. Only same-origin static files that
 *     this app itself builds are touched. User data lives in the network.
 *   - Every handled request goes to the network FIRST; the cache is only a
 *     fallback when the network fails. HTML documents are not handled at all,
 *     so a newly deployed build is always the one that loads. Nobody gets
 *     stranded on a stale version.
 *
 * Behaviour is covered by src/test/pwa.test.ts, which executes this exact file.
 */

const CACHE_NAME = "avora-static-v1";

/** File types this worker may keep a fallback copy of: build output only. */
const STATIC_EXTENSIONS = [
  ".js",
  ".mjs",
  ".css",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".ico",
  ".webmanifest",
];

/** Path prefixes that carry user data and must stay off the cache entirely. */
const DATA_PATH_PREFIXES = ["/rest/", "/auth/", "/realtime/", "/storage/", "/functions/", "/api/"];

/**
 * Decides whether a request may be served through the cache-backed path.
 * Anything that returns false is left to the browser, untouched.
 */
function isCacheableRequest(request, scopeOrigin) {
  if (request.method !== "GET") return false;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }

  // Same origin only. This alone excludes Supabase, but the checks below spell
  // the intent out so a future edit cannot quietly widen it.
  if (url.origin !== scopeOrigin) return false;
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) return false;
  if (DATA_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return false;

  // Documents are never cached: the HTML shell must always come from the network
  // so a fresh deploy is picked up immediately.
  if (request.mode === "navigate" || request.destination === "document") return false;

  const pathname = url.pathname.toLowerCase();
  return STATIC_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}

/** Network first, cache only as an offline fallback. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (!isCacheableRequest(event.request, self.location.origin)) return;
  event.respondWith(networkFirst(event.request));
});
