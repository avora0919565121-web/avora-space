import { useEffect, useState } from "react";

import { FocusModeSheet } from "@/components/chat/FocusModeSheet";
import { useRhythm } from "@/lib/use-rhythm";

/** Fired by every way in to Chế độ tập trung: hold / right-click / double-click on Kết nối, Cài đặt. */
export const OPEN_FOCUS_EVENT = "avora_open_focus";

export function openFocusSheet(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_FOCUS_EVENT));
}

/** One focus sheet for the whole app, so every entry point opens the same thing. */
export function FocusHost() {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const rhythm = useRhythm();

  useEffect(() => {
    const open = (): void => setIsOpen(true);
    window.addEventListener(OPEN_FOCUS_EVENT, open);
    return () => window.removeEventListener(OPEN_FOCUS_EVENT, open);
  }, []);

  return (
    <FocusModeSheet
      // Re-mount on open so the chosen level starts from what is on now.
      key={isOpen ? "open" : "closed"}
      open={isOpen}
      onOpenChange={setIsOpen}
      activeMode={rhythm.focus}
      onStart={rhythm.startFocus}
      onStop={rhythm.stopFocus}
    />
  );
}
