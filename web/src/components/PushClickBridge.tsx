import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/** A tapped notification on an open tab arrives here when the browser cannot navigate it (AVORA-46 · D). */
export function PushClickBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (typeof navigator === "undefined" || navigator.serviceWorker === undefined) return;
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type !== "avora-open" || typeof data.url !== "string") return;
      const url = new URL(data.url, window.location.origin);
      if (url.origin !== window.location.origin) return;
      navigate(`${url.pathname}${url.search}`);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate]);
  return null;
}
