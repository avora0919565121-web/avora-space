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

export function lazyRetry<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): ComponentType<P> {
  let failed = false;
  let madeAt = generation;
  const make = (): LazyExoticComponent<ComponentType<P>> => {
    madeAt = generation;
    failed = false;
    return lazy(() =>
      load().catch((error: unknown) => {
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
