import { useEffect } from "react";

import { setCelebrationStyle } from "@/lib/confetti";
import { DEFAULT_BUTTON_STYLE, DEFAULT_CELEBRATION_STYLE } from "@/lib/look-prefs";
import { cachedLook, DARK_MEDIA_QUERY, refreshLook, setSavedLook } from "@/lib/theme";
import { useProfileSettings } from "@/lib/use-settings";

/**
 * Keeps the personal looks in step with the profile (AVORA-56 · E, AVORA-57 · F, AVORA-74):
 * the completion effect, `data-button-style`, and Sắc màu + Tông màu on <html>. Before the
 * profile arrives the look last saved on this device is used (index.html already painted it).
 * Other devices pick a new tone up on their next start or when the tab is shown again — the
 * profile query refetches on focus; no realtime needed. Renders nothing.
 */
export function LookSync() {
  const { data, refetch } = useProfileSettings();
  const celebration = data?.celebrationStyle ?? DEFAULT_CELEBRATION_STYLE;
  const button = data?.buttonStyle ?? DEFAULT_BUTTON_STYLE;
  const fallback = cachedLook();
  const scheme = data?.colorScheme ?? fallback.scheme;
  const tone = data?.accentTone ?? fallback.tone;

  useEffect(() => {
    setCelebrationStyle(celebration);
  }, [celebration]);

  useEffect(() => {
    document.documentElement.dataset.buttonStyle = button;
  }, [button]);

  useEffect(() => {
    setSavedLook({ scheme, tone });
  }, [scheme, tone]);

  // 74.8: Theo thiết bị follows the device the moment it turns dark or light.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(DARK_MEDIA_QUERY);
    const onChange = (): void => refreshLook();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, []);

  // 74 · C.4: back to the tab → read the account's choice again (another device may have changed it).
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetch]);

  return null;
}
