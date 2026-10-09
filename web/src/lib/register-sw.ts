import { logError } from "@/lib/log";
/**
 * Registers the minimal service worker that makes AVORA installable.
 *
 * Only runs in a real build: in dev the Vite module graph is served live and a
 * worker sitting in front of it would only get in the way. Registration failure
 * is never fatal — the app works exactly the same without a worker.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability is a bonus, not a requirement. Stay silent in the UI.
      logError("service-worker", { code: "register_failed" });
    });
  });
}

/**
 * KHỐI 0 — an old address keeps no worker (and so no push subscription): pushes arrive only on the
 * real address once the person turns them on there.
 */
export async function unregisterServiceWorkers(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
  } catch {
    logError("service-worker", { code: "unregister_failed" });
  }
}
