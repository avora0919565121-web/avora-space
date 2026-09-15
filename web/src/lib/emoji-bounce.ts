/**
 * The small physical answer to dropping a feeling on something.
 *
 * Every emoji gets it, not just the heart: the bar is deliberately not all-positive, and a
 * press that only feels alive when you agree teaches people that only agreement counts.
 *
 * The picker stays open for exactly as long as the bounce lasts. The reaction itself is saved
 * the instant the button is pressed — the wait is the animation's, never the data's — but
 * closing the sheet on the same frame would throw away the one bit of feedback that tells
 * somebody which of eight small faces actually took their tap.
 */

/** Long enough to read as weight, short enough that nobody waits for it. */
export const EMOJI_BOUNCE_MS = 260;

/** Scale down, overshoot, settle. `inline-block` because transforms do nothing on inline. */
export const EMOJI_BOUNCE_CLASS = "inline-block animate-emoji-bounce motion-reduce:animate-none";

/** Neutral resting state — kept beside the active class so both paths stay inline-block. */
export const EMOJI_REST_CLASS = "inline-block";

/**
 * Whether this particular emoji is the one that was just pressed.
 *
 * One emoji bounces at a time on purpose: two moving at once would make it ambiguous which
 * one was chosen, which is the entire job of the animation.
 */
export function isBouncing(pressed: string | null, emoji: string): boolean {
  return pressed !== null && pressed === emoji;
}

/** The class an emoji should wear right now. */
export function emojiBounceClass(pressed: string | null, emoji: string): string {
  return isBouncing(pressed, emoji) ? EMOJI_BOUNCE_CLASS : EMOJI_REST_CLASS;
}
