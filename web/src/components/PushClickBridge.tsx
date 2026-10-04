import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { markNextEntryAsLanding } from "@/lib/nav-history";
import { markExplicitOpen } from "@/lib/resume-place";

/** A tapped notification on an open tab arrives here first and moves the app without a reload (AVORA-46 · D, AVORA-53 · 1.3). */
export function PushClickBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (typeof navigator === "undefined" || navigator.serviceWorker === undefined) return;
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type !== "avora-open" || typeof data.url !== "string") return;
      const url = new URL(data.url, window.location.origin);
      if (url.origin !== window.location.origin) return;
      // Tell the service worker this tab took it, so it does not reload the page (AVORA-53 · 1.3).
      event.ports[0]?.postMessage("ok");
      // AVORA-93 · 5: a notification beats the reopen rule, and `‹` from there goes to Kết nối, not to whatever was behind.
      markExplicitOpen();
      markNextEntryAsLanding();
      navigate(`${url.pathname}${url.search}`);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate]);
  return null;
}
