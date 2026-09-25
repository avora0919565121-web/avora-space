import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

/**
 * A tap and a hold on the same control, told apart.
 *
 * The hold fires while the finger is still down (as a native app does) and swallows the click
 * that follows, so holding never also triggers the tap. Moving the finger away cancels it, so a
 * scroll that starts on the control is not mistaken for a hold. `isEnabled` is read at press
 * time, which lets the caller keep holds to phones only.
 */
export function useLongPress({
  onTap,
  onHold,
  holdMs,
  isEnabled,
}: {
  onTap: () => void;
  onHold: () => void;
  holdMs: number;
  isEnabled: () => boolean;
}) {
  const timerRef = useRef<number | null>(null);
  const firedRef = useRef<boolean>(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback((): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      firedRef.current = false;
      if (!isEnabled() || event.button !== 0) return;
      startRef.current = { x: event.clientX, y: event.clientY };
      clear();
      timerRef.current = window.setTimeout(() => {
        firedRef.current = true;
        timerRef.current = null;
        // A short tick where the device supports it, the way a held icon answers on a phone.
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(12);
        onHold();
      }, holdMs);
    },
    [clear, holdMs, isEnabled, onHold],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      const start = startRef.current;
      if (start === null || timerRef.current === null) return;
      if (Math.abs(event.clientX - start.x) > 10 || Math.abs(event.clientY - start.y) > 10) clear();
    },
    [clear],
  );

  const onClick = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      clear();
      if (firedRef.current) {
        firedRef.current = false;
        event.preventDefault();
        return;
      }
      onTap();
    },
    [clear, onTap],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onClick,
    // Holding an image on iOS otherwise opens the system "save image" menu.
    onContextMenu: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
  };
}
