import { useEffect } from "react";

/**
 * Which side of a phone on its side holds the notch (AVORA-61 · J).
 *
 * iPhone reports a safe-area inset on BOTH sides in landscape, but the notch is only on one.
 * The rotation tells which: turned so the top of the phone points left (angle 90) puts the notch
 * on the left; the other way (270 / -90) on the right. `html[data-notch]` then lets the layout
 * keep the inset only where the notch really is (`--inset-l` / `--inset-r`); the other side gets
 * the same 16px as a phone held upright. Unknown rotation keeps both insets, as before.
 */
export function notchSide(angle: number | null): "left" | "right" | null {
  if (angle === null || Number.isNaN(angle)) return null;
  const normalized = ((angle % 360) + 360) % 360;
  if (normalized === 90) return "left";
  if (normalized === 270) return "right";
  return null;
}

function currentAngle(): number | null {
  if (typeof window === "undefined") return null;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  // iOS Safari: window.orientation is the reliable one (screen.orientation.angle arrived late).
  if (typeof legacy === "number") return legacy;
  const angle = window.screen?.orientation?.angle;
  return typeof angle === "number" ? angle : null;
}

export function NotchSync() {
  useEffect(() => {
    const root = document.documentElement;
    const update = (): void => {
      const side = notchSide(currentAngle());
      if (side === null) root.removeAttribute("data-notch");
      else root.setAttribute("data-notch", side);
    };
    update();
    window.addEventListener("orientationchange", update);
    window.screen?.orientation?.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("orientationchange", update);
      window.screen?.orientation?.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return null;
}
