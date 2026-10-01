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

/*
 * AVORA-46 — Web Push. The server decides every word (privacy by default); this only shows it.
 * No action buttons: a tap opens the right place, nothing runs from the notification itself.
 * Nothing is sent back to the sender — there is no "seen" signal (ADR-028).
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title !== "" ? data.title : "AVORA";
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    tag: typeof data.tag === "string" ? data.tag : undefined,
    renotify: typeof data.tag === "string",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/tin-nhan" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : "/tin-nhan", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const same = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (same) {
        await same.focus();
        // AVORA-53 · 1.3: an open app moves in place (PushClickBridge) instead of reloading. Only when
        // nothing answers within a second (signed-out screen, old build) is the tab navigated.
        const answered = await new Promise((resolve) => {
          try {
            const channel = new MessageChannel();
            const timer = setTimeout(() => resolve(false), 1000);
            channel.port1.onmessage = () => {
              clearTimeout(timer);
              resolve(true);
            };
            same.postMessage({ type: "avora-open", url: target }, [channel.port2]);
          } catch {
            resolve(false);
          }
        });
        if (answered) return;
        if ("navigate" in same) {
          try {
            await same.navigate(target);
          } catch {
            // Nothing more to try: the tab is focused, the person is one tap away.
          }
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
