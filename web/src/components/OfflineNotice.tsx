import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * 112-F · luồng 5: without a network every tab says so in one quiet line, so an empty list never reads as
 * "nothing here". Kết nối has its own line (`Đang kết nối lại`), so it is not repeated there.
 */
export function OfflineNotice() {
  const location = useLocation();
  const [isOffline, setIsOffline] = useState<boolean>(() => typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const update = (): void => setIsOffline(navigator.onLine === false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!isOffline || location.pathname.startsWith("/tin-nhan")) return null;
  return (
    <p role="status" data-offline-notice="" className="flex items-center gap-2 border-b border-border bg-accent/40 px-4 py-1.5 text-[12.5px] text-muted-foreground md:px-10">
      <WifiOff className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
      <span className="min-w-0 flex-1">Ngoại tuyến — đang hiện những gì đã tải trên máy này.</span>
    </p>
  );
}
