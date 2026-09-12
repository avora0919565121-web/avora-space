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
      console.warn("[avora] service worker registration failed");
    });
  });
}
