import { useEffect } from "react";

import { setCelebrationStyle } from "@/lib/confetti";
import { DEFAULT_BUTTON_STYLE, DEFAULT_CELEBRATION_STYLE } from "@/lib/look-prefs";
import { useProfileSettings } from "@/lib/use-settings";

/**
 * Keeps two personal looks in step with the profile (AVORA-56 · E, AVORA-57 · F):
 * the completion effect `celebrate()` plays, and `data-button-style` on <html>, which the
 * `--btn-radius` design variable in index.css reads. Renders nothing.
 */
export function LookSync() {
  const { data } = useProfileSettings();
  const celebration = data?.celebrationStyle ?? DEFAULT_CELEBRATION_STYLE;
  const button = data?.buttonStyle ?? DEFAULT_BUTTON_STYLE;

  useEffect(() => {
    setCelebrationStyle(celebration);
  }, [celebration]);

  useEffect(() => {
    document.documentElement.dataset.buttonStyle = button;
  }, [button]);

  return null;
}
