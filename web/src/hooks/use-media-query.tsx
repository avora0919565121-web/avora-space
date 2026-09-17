import { useEffect, useState } from "react";

/** Where a side panel stops being the right shape and a centred window starts. */
export const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * Whether a CSS media query currently holds, kept in sync as the window changes.
 *
 * Used where the DIFFERENCE is structural rather than cosmetic — a sheet versus a dialog are
 * two different elements, not one element with different padding, so Tailwind's breakpoints
 * cannot express it and the component genuinely has to know.
 *
 * Starts false and corrects itself on mount: reading `matchMedia` during render would make
 * the first paint depend on the window, and there is no window at all in a test runner that
 * has not set one up.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}
