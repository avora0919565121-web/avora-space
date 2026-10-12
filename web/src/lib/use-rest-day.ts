import { useEffect, useLayoutEffect, useState } from "react";

import { cacheRestPrefs, isRestDay, msUntilMidnight, REST_TONE, type RestInnerScope } from "@/lib/rest-day";
import { setRestTone } from "@/lib/theme";
import { useProfileSettings } from "@/lib/use-settings";

const PREVIEW_END = "avora:rest-preview-end";
const PREVIEW_MS = 3000;
let previewing = false;

/** The device's "now", refreshed at midnight and whenever the app comes back to the front. */
function useDeviceDay(): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(new Date()), msUntilMidnight(now) + 500);
    const refresh = (): void => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [now]);
  return now;
}

/** AVORA-110: is today a rest day on this device, and does the person want the colours to change? */
export function useRestDay(): { isRest: boolean; themeOn: boolean; now: Date } {
  const { data: settings } = useProfileSettings();
  const now = useDeviceDay();
  const prefs = { restWeekday: settings?.restWeekday ?? 0, restSaturday: settings?.restSaturday ?? false };
  return { isRest: settings !== undefined && isRestDay(now, prefs), themeOn: settings?.restThemeEnabled ?? true, now };
}

/** Renders nothing: puts the rest tone on <html> on a rest day (and takes it off at midnight). */
export function RestDaySync() {
  const { data: settings } = useProfileSettings();
  const { isRest, themeOn } = useRestDay();
  const [previewEnded, setPreviewEnded] = useState<number>(0);
  useEffect(() => {
    if (settings === undefined) return;
    cacheRestPrefs({ restWeekday: settings.restWeekday, restSaturday: settings.restSaturday, enabled: settings.restThemeEnabled });
  }, [settings]);
  useEffect(() => {
    if (previewing) return;
    setRestTone(isRest && themeOn ? REST_TONE : null);
  }, [isRest, themeOn, previewEnded]);
  useEffect(() => {
    const onEnd = (): void => setPreviewEnded((n) => n + 1);
    window.addEventListener(PREVIEW_END, onEnd);
    return () => {
      window.removeEventListener(PREVIEW_END, onEnd);
      setRestTone(null);
    };
  }, []);
  return null;
}

/** `Xem thử`: the rest colours for 3 seconds, without changing any setting. */
export function previewRestTone(): void {
  previewing = true;
  setRestTone(REST_TONE);
  window.setTimeout(() => {
    previewing = false;
    window.dispatchEvent(new Event(PREVIEW_END));
  }, PREVIEW_MS);
}

const FRAME_SELECTOR = "[data-app-main]";

/**
 * Marks the page frame as an inward place (or not) before the browser paints, so moving between a
 * work place and an inward one on a rest day never flashes the wrong colour.
 */
export function useRestScope(scope: RestInnerScope | null): void {
  useLayoutEffect(() => {
    if (scope === null) return;
    const frame = document.querySelector<HTMLElement>(FRAME_SELECTOR);
    if (frame === null) return;
    frame.dataset.restScope = "inner";
    frame.dataset.restPlace = scope;
    return () => {
      if (frame.dataset.restPlace === scope) {
        delete frame.dataset.restScope;
        delete frame.dataset.restPlace;
      }
    };
  }, [scope]);
}
