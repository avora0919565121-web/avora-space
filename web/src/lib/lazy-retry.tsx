import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * CC-09: `React.lazy` remembers a failed import for good, so after the network comes back "Thử lại"
 * would fail again. Here a failed load is forgotten: the next render (the boundary's retry, or the
 * `online` event) asks for the room's code once more.
 */
let generation = 0;

/** "Thử lại" (or the network coming back): failed room code may be fetched again on the next render. */
export function retryLazyLoads(): void {
  generation += 1;
}

/** The chunk URL inside the browser's "failed to fetch dynamically imported module: <url>" message. */
export function chunkUrlOf(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const found = /(https?:\/\/[^\s'"]+?\.(?:m?js|jsx|tsx?))(?:[?#][^\s'"]*)?/i.exec(error.message);
  return found === null ? null : found[1];
}

const RELOAD_KEY = "avora.chunk-reload-at";

/**
 * KT-08 · QA05-03: the browser keeps a failed module import for the life of the page, so asking for the
 * same URL again fails at once even when the network is back. A retry therefore asks for the chunk under
 * a fresh URL (`?retry=N`). If even that fails while online (a dependency that failed to preload is kept
 * failed too), the page reloads once — at most once a minute, never in a loop.
 */
async function loadAgain<T>(load: () => Promise<T>, attempt: number): Promise<T> {
  try {
    return await load();
  } catch (first: unknown) {
    const url = chunkUrlOf(first);
    if (url === null || !isChunkLoadError(first)) throw first;
    try {
      return (await import(/* @vite-ignore */ `${url}?retry=${attempt}-${Date.now()}`)) as T;
    } catch (second: unknown) {
      const online = typeof navigator === "undefined" || navigator.onLine !== false;
      if (online && isChunkLoadError(second) && typeof window !== "undefined") {
        let last = 0;
        try {
          last = Number(sessionStorage.getItem(RELOAD_KEY) ?? "0");
          sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        } catch {
          last = Date.now(); // no storage: never risk a reload loop
        }
        if (Date.now() - last > 60_000) window.location.reload();
      }
      throw second;
    }
  }
}

export function lazyRetry<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): ComponentType<P> {
  let failed = false;
  let madeAt = generation;
  let attempts = 0;
  const make = (): LazyExoticComponent<ComponentType<P>> => {
    madeAt = generation;
    failed = false;
    const attempt = attempts;
    attempts += 1;
    return lazy(() =>
      (attempt === 0 ? load() : loadAgain(load, attempt)).catch((error: unknown) => {
        failed = true;
        throw error;
      }),
    );
  };
  let current = make();
  function Retryable(props: P) {
    // Only after an explicit retry: React re-renders a failed part on its own, and that must not
    // turn into a request loop while the network is still down.
    if (failed && madeAt < generation) current = make();
    const Current = current as unknown as ComponentType<P>;
    return <Current {...props} />;
  }
  return Retryable;
}

/** Whether an error is the browser failing to fetch a lazily loaded chunk (network, or a stale deploy). */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "ChunkLoadError" ||
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(error.message)
  );
}

/** The room a path opens, for "Cần có mạng để mở {room} lần đầu". */
export function roomNameOf(path: string): string {
  if (path.startsWith("/ke-hoach")) return "Thư phòng";
  if (path.startsWith("/ket-sat")) return "Két sắt";
  if (path.startsWith("/nhiem-vu")) return "Nhiệm vụ";
  if (path.startsWith("/tin-nhan")) return "Kết nối";
  if (path.startsWith("/lien-he")) return "Liên hệ";
  if (path.startsWith("/cai-dat")) return "Cài đặt";
  if (path.startsWith("/du-an")) return "Dự án";
  return "phần này";
}

/** The words for a room whose code could not be fetched: offline → it needs the network once; online → try again. */
export function chunkFaultCopy(path: string, isOnline: boolean): { title: string; body: string } {
  const room = roomNameOf(path);
  return isOnline
    ? { title: `Chưa tải được ${room}`, body: "Mạng vừa chập chờn. Bạn thử lại nhé." }
    : { title: `Cần có mạng để mở ${room} lần đầu`, body: "AVORA sẽ tự mở lại khi có mạng." };
}
