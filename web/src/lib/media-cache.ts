/**
 * K3 · N7: chat photos cached by the service worker (by path, token removed) belong to the
 * signed-in account only. Sign-out drops them on this device, both through the worker and,
 * when no worker answers, directly.
 */
export const MEDIA_CACHE_NAME = "avora-media-v1";

export function clearCachedMedia(): void {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "avora-clear-media" });
  } catch {
    // No worker in control: the direct delete below still runs.
  }
  if (typeof caches !== "undefined") void caches.delete(MEDIA_CACHE_NAME).catch(() => undefined);
}
