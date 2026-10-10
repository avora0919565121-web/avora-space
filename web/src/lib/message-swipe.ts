/** K4 · 4 — swipe on a message: thresholds and the scroll-vs-swipe decision (pure, testable). */
/** How far a finger must travel before a swipe acts (Đợt gộp 2 · A10, K4 · 4). */
export const SWIPE_REPLY_PX = 56;
/** The bubble follows the finger at most this far, then springs back to 0. */
export const SWIPE_MAX_PX = 72;
/** A swipe starting this close to the left edge belongs to "back" (ADR-062), never to the bubble. */
export const SWIPE_EDGE_PX = 24;
/** Mostly vertical (|dy| > 1.4·|dx|) is a scroll and cancels the swipe. */
export const SWIPE_VERTICAL_RATIO = 1.4;

export type SwipeDirection = "reply" | "task";

/**
 * AVORA-106 · K4 · 4 (VMT 08/10 11:15): swipe LEFT = Trả lời, swipe RIGHT = Tạo việc. Fingers
 * only. A start within 24 px of the left edge is the system's back swipe and is ignored; a mostly
 * vertical move is a scroll. The bubble follows up to 72 px, shows ↩ / ☑ as it goes, buzzes once
 * at the threshold and springs back on release.
 */
export function swipeIntent(dx: number, dy: number): "swipe" | "scroll" | null {
  if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8) return null;
  return Math.abs(dy) > Math.abs(dx) * SWIPE_VERTICAL_RATIO || Math.abs(dx) <= 8 ? "scroll" : "swipe";
}

