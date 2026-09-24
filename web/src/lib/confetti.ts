import { currentRhythm, motionFor } from "@/lib/motion";

/**
 * The moment work closes — for the person who closed it, and nobody else.
 *
 * It used to be confetti. It is now a single, soft wash of colour over the screen that fades in
 * and back out exactly once, using only the motion tokens: opacity changes, nothing moves,
 * scales, bounces or repeats. At the Tĩnh rhythm (the device asked for calmer motion) the wash
 * uses the short duration; at Cân bằng the gentle one. Opacity only at both.
 *
 * Deliberately ephemeral: nothing is stored, nothing is sent, and the next reload holds no trace
 * of it. It is called only straight after a completion mutation has succeeded — never on load,
 * and never for work that was finished before the screen opened.
 *
 * The layer is appended to `document.body`, never to the panel the button was in, so a sheet or
 * dialog that clips its contents cannot clip the moment.
 */

export type CelebrationKind = "task" | "milestone";

/**
 * Kept for the stored celebrations model, which still records how much weight a completion
 * had. The wash itself plays once regardless: repeating it would be a pulse.
 */
export const MILESTONE_BURSTS = 3;
export const MAX_CELEBRATION_BURSTS = 5;

/** Clamps a requested weight into the stored range. */
export function burstCount(requested: number): number {
  if (!Number.isFinite(requested)) return 1;
  return Math.min(Math.max(Math.round(requested), 1), MAX_CELEBRATION_BURSTS);
}

/** Warm and faint, from the app's own palette: terracotta for work, amber for a milestone. */
const WASH: Record<CelebrationKind, string> = {
  task: "radial-gradient(ellipse at 50% 40%, hsl(13 73% 56% / 0.14), hsl(13 73% 56% / 0) 70%)",
  milestone: "radial-gradient(ellipse at 50% 40%, hsl(32 53% 52% / 0.22), hsl(32 53% 52% / 0) 72%)",
};

/** The wash's timings for a rhythm: fade in, hold, fade out — each one token long. */
export function completionTimeline(reduced: boolean): { fadeMs: number; holdMs: number; totalMs: number } {
  const { durationMs } = motionFor(currentRhythm(reduced));
  return { fadeMs: durationMs, holdMs: durationMs, totalMs: durationMs * 3 };
}

/**
 * Plays the wash once. Fire-and-forget: callers celebrate after their mutation has succeeded
 * and never wait on it. The second argument is accepted for compatibility and ignored.
 */
export function celebrate(kind: CelebrationKind, _bursts: number = 1): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  const motion = motionFor(currentRhythm());
  const { fadeMs, holdMs } = completionTimeline(currentRhythm() === "tinh");

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.dataset.completionWash = kind;
  layer.style.cssText = [
    "position:fixed",
    "inset:0",
    "pointer-events:none",
    "z-index:2147483000",
    "opacity:0",
    `background:${WASH[kind]}`,
    `transition:${motion.transition}`,
  ].join(";");
  document.body.appendChild(layer);

  // Two frames so the starting opacity is committed before it changes.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      layer.style.opacity = "1";
    });
  });
  window.setTimeout(() => {
    layer.style.opacity = "0";
    window.setTimeout(() => layer.remove(), fadeMs + 50);
  }, fadeMs + holdMs);
}
