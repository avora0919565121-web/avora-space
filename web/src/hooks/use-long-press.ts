import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent, type TouchEvent } from "react";

/** How long a finger must rest on a message bubble before it counts as "I mean this one". */
export const LONG_PRESS_MS = 500;

/** Movement beyond this is a scroll, not a press, so the gesture is abandoned. */
export const LONG_PRESS_SLOP_PX = 10;

/**
 * A tap and a hold on the same control, told apart. The one long-press hook in AVORA.
 *
 * The hold fires while the finger is still down (as a native app does) and swallows the click
 * that follows, so holding never also triggers the tap. Moving the finger away cancels it, so a
 * scroll that starts on the control is not mistaken for a hold. `isEnabled` is read at press
 * time, which lets the caller keep holds to phones only; `pointerTypes` limits which pointers
 * may start one (message bubbles: fingers only — a mouse already has hover and a visible "…").
 */
export function useLongPress({
  onTap,
  onHold,
  holdMs = LONG_PRESS_MS,
  isEnabled = () => true,
  pointerTypes,
  onPressChange,
  contextMenu = "always",
}: {
  onTap?: () => void;
  onHold: () => void;
  holdMs?: number;
  isEnabled?: () => boolean;
  /** e.g. ["touch"]. Omitted: any primary pointer. */
  pointerTypes?: readonly string[];
  /** True while a hold is being timed, so the control can dim before it fires. */
  onPressChange?: (pressing: boolean) => void;
  /** "always" blocks the system menu (held images on iOS); "after-hold" only once ours has answered. */
  contextMenu?: "always" | "after-hold";
}) {
  const timerRef = useRef<number | null>(null);
  /** AVORA-94B · B2: a finger is down (touch events), so a stray `pointercancel` from iOS does not end the hold. */
  const touchActiveRef = useRef<boolean>(false);
  const firedRef = useRef<boolean>(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const pressChangeRef = useRef(onPressChange);
  pressChangeRef.current = onPressChange;

  const clear = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      pressChangeRef.current?.(false);
    }
    timerRef.current = null;
    startRef.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const start = useCallback(
    (x: number, y: number): void => {
      clear();
      startRef.current = { x, y };
      pressChangeRef.current?.(true);
      timerRef.current = window.setTimeout(() => {
        firedRef.current = true;
        timerRef.current = null;
        pressChangeRef.current?.(false);
        // A short tick where the device supports it, the way a held icon answers on a phone.
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(12);
        onHold();
      }, holdMs);
    },
    [clear, holdMs, onHold],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      firedRef.current = false;
      if (!isEnabled() || event.button !== 0) return;
      if (pointerTypes !== undefined && !pointerTypes.includes(event.pointerType)) return;
      // The touch path below may already be timing this same press.
      if (timerRef.current !== null && touchActiveRef.current) return;
      start(event.clientX, event.clientY);
    },
    [isEnabled, pointerTypes, start],
  );

  /** iOS fallback: some controls get `pointercancel` mid-hold; touch events keep the press alive. */
  const onTouchStart = useCallback(
    (event: TouchEvent<HTMLElement>): void => {
      touchActiveRef.current = true;
      if (!isEnabled() || timerRef.current !== null) return;
      if (pointerTypes !== undefined && !pointerTypes.includes("touch")) return;
      const touch = event.touches[0];
      if (touch === undefined) return;
      firedRef.current = false;
      start(touch.clientX, touch.clientY);
    },
    [isEnabled, pointerTypes, start],
  );
  const onTouchEnd = useCallback((): void => {
    touchActiveRef.current = false;
    clear();
  }, [clear]);
  const onPointerCancel = useCallback((): void => {
    if (!touchActiveRef.current) clear();
  }, [clear]);
  // A finger rolling slightly off the control is still holding it; only a mouse leaving ends it.
  const onPointerLeave = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      if (event.pointerType === "mouse") clear();
    },
    [clear],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      const start = startRef.current;
      if (start === null || timerRef.current === null) return;
      if (Math.abs(event.clientX - start.x) > LONG_PRESS_SLOP_PX || Math.abs(event.clientY - start.y) > LONG_PRESS_SLOP_PX) {
        clear();
      }
    },
    [clear],
  );

  const onClick = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      clear();
      if (firedRef.current) {
        firedRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onTap?.();
    },
    [clear, onTap],
  );

  const onContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      if (contextMenu === "always" || firedRef.current) event.preventDefault();
    },
    [contextMenu],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerCancel,
    onPointerLeave,
    onTouchStart,
    onTouchEnd,
    onTouchCancel: onTouchEnd,
    onClick,
    onContextMenu,
  };
}
