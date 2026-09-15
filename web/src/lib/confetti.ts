/**
 * A short celebration when work closes — the person who finished it, and nobody else.
 *
 * Deliberately ephemeral: nothing is stored, nothing is sent, and the next reload holds no
 * trace of it. The moment belongs to the screen it happened on.
 *
 * The canvas is appended to `document.body`, never to the panel the button was in. A sheet,
 * a dialog and a chat panel all clip their own contents, so confetti rendered inside one
 * would be a few squares trapped in a box — the celebration has to belong to the whole
 * screen regardless of where in Avora the work was closed from.
 */

export type CelebrationKind = "task" | "milestone";

const PARTICLE_COUNT: Record<CelebrationKind, number> = { task: 70, milestone: 110 };
const DURATION_MS: Record<CelebrationKind, number> = { task: 1600, milestone: 2000 };

/**
 * How many waves a milestone fires by default, and the ceiling on any request.
 *
 * A milestone is not "a task, but more confetti" — it is several pops in a row, which reads
 * as applause rather than as a single event. The cap exists because past five the screen is
 * just busy: more waves stop adding meaning and start delaying the person's next action.
 */
export const MILESTONE_BURSTS = 3;
export const MAX_CELEBRATION_BURSTS = 5;

/** The beat between waves — close enough to feel like one celebration, not three. */
const WAVE_GAP_MS = 320;

/** Clamps a requested wave count into what the animation will actually play. */
export function burstCount(requested: number): number {
  if (!Number.isFinite(requested)) return 1;
  return Math.min(Math.max(Math.round(requested), 1), MAX_CELEBRATION_BURSTS);
}

/** Warm throughout, matching the app's paper-and-ink palette. */
const COLORS: Record<CelebrationKind, readonly string[]> = {
  task: ["#e8a13a", "#d96f4e", "#7ba05b", "#5b7fa0", "#c65b7c"],
  milestone: ["#f2c94c", "#e8b13a", "#e8a13a", "#fff1c9", "#d96f4e", "#c65b7c", "#b98a2f"],
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  colour: string;
};

/** Runs only when the person has not asked the system to calm motion down. */
function motionAllowed(): boolean {
  return typeof matchMedia === "undefined" || !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Fires the burst. Fire-and-forget by design: callers celebrate after their mutation has
 * actually succeeded, and never wait on the animation.
 */
export function celebrate(kind: CelebrationKind, bursts: number = 1): void {
  if (typeof document === "undefined" || !motionAllowed()) return;

  const waves = burstCount(bursts);

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  // z-index above every overlay in the app (dialogs and sheets sit at 50), and parented to
  // the document body so no open panel can clip it.
  canvas.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000;";
  document.body.appendChild(canvas);

  const context = canvas.getContext("2d");
  if (context === null) {
    canvas.remove();
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  context.scale(dpr, dpr);

  const colours = COLORS[kind];
  const particles: Particle[] = [];

  /**
   * One wave. Later waves are thrown off-centre and alternate sides, so a three-pop
   * celebration reads as fireworks across the screen rather than the same pop three times.
   */
  const spawn = (wave: number): void => {
    const drift = wave === 0 ? 0 : (wave % 2 === 1 ? -1 : 1) * (0.1 + wave * 0.05);
    const originX = window.innerWidth * (0.5 + drift);
    const originY = window.innerHeight * (0.38 + (wave % 2 === 1 ? 0.06 : -0.04));
    const count = PARTICLE_COUNT[kind];

    for (let i = 0; i < count; i += 1) {
      // An even ring of launch angles, jittered so the pop reads as a burst, not a circle.
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.35;
      const speed = (kind === "milestone" ? 7 : 5.5) * (0.5 + Math.random() * 0.9);
      particles.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.5,
        size: 4 + Math.random() * 5,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        colour: colours[i % colours.length] ?? colours[0] ?? "#e8a13a",
      });
    }
  };

  spawn(0);
  let spawned = 1;

  // The last wave still gets its full flight time, so nothing is cut off mid-air.
  const duration = DURATION_MS[kind] + (waves - 1) * WAVE_GAP_MS;
  const startedAt = performance.now();

  const frame = (now: number): void => {
    const elapsed = now - startedAt;
    if (elapsed >= duration) {
      canvas.remove();
      return;
    }

    while (spawned < waves && elapsed >= spawned * WAVE_GAP_MS) {
      spawn(spawned);
      spawned += 1;
    }

    // The last quarter fades the whole burst out instead of dropping confetti mid-air.
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    context.globalAlpha = elapsed > duration * 0.72 ? Math.max(0, 1 - (elapsed / duration - 0.72) / 0.28) : 1;

    for (const particle of particles) {
      particle.vy += 0.18; // gravity
      particle.vx *= 0.985; // drag
      particle.vy *= 0.99;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.rotation += particle.spin;

      context.save();
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.fillStyle = particle.colour;
      context.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
      context.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
