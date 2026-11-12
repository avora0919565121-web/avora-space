import { useEffect } from "react";

/**
 * CC-04: a full-screen layer (the habit clock, its "back" card) hides the phone's tab bar under it, so
 * toasts drop back to the bottom edge instead of floating over the layer's own main button.
 */
export function useCoversToolBelt(): void {
  useEffect(() => {
    const root = document.documentElement;
    const count = Number(root.getAttribute("data-covers-tool-belt") ?? "0") + 1;
    root.setAttribute("data-covers-tool-belt", String(count));
    return () => {
      const left = Number(root.getAttribute("data-covers-tool-belt") ?? "1") - 1;
      if (left <= 0) root.removeAttribute("data-covers-tool-belt");
      else root.setAttribute("data-covers-tool-belt", String(left));
    };
  }, []);
}
