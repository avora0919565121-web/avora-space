import tokens from "@/lib/AVORA-Motion.tokens.json";

/**
 * The one place new UI reads motion from.
 *
 * Every value comes from `AVORA-Motion.tokens.json`; nothing here invents a duration or an
 * easing. The rhythm follows the device's own "reduce motion" setting until AVORA has a
 * rhythm setting of its own: reduced → Tĩnh (the short duration), otherwise Cân bằng.
 *
 * Both rhythms animate opacity and nothing else, so there is no path by which a token can
 * move, scale or bounce anything on screen.
 */
export type SpaceRhythm = "tinh" | "can_bang";

export type MotionSpec = {
  durationMs: number;
  easing: string;
  /** A ready-to-use CSS `transition` value, opacity only. */
  transition: string;
};

export const MOTION_DURATION = tokens.duration;
export const MOTION_EASING = tokens.easing.out;

/** Whether the device has asked for calmer motion. False where it cannot be read. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function currentRhythm(reduced: boolean = prefersReducedMotion()): SpaceRhythm {
  return reduced ? "tinh" : "can_bang";
}

export function motionFor(rhythm: SpaceRhythm): MotionSpec {
  const key = tokens.rhythm[rhythm].duration as keyof typeof tokens.duration;
  const durationMs = tokens.duration[key];
  return {
    durationMs,
    easing: MOTION_EASING,
    transition: `opacity ${durationMs}ms ${MOTION_EASING}`,
  };
}
