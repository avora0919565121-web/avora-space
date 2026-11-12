/**
 * KT-07a2 (QA-04, G-01): on a computer — a wide screen with a fine pointer — Enter sends a message and
 * Shift+Enter writes a new line. On a phone Enter stays a new line (AVORA-55 · 1): the Gửi button sends.
 */
export const ENTER_SENDS_QUERY = "(min-width: 768px) and (hover: hover) and (pointer: fine)";

export function enterSends(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(ENTER_SENDS_QUERY).matches;
  } catch {
    return false;
  }
}
