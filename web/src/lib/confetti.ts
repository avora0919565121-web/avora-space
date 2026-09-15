/**
 * A short celebration when work closes — the person who finished it, and nobody else.
 *
 * Deliberately ephemeral: nothing is stored, nothing is sent, and the next reload holds no
 * trace of it. The moment belongs to the screen it happened on.
 */

export type CelebrationKind = "task" | "milestone";

const PARTICLE_COUNT: Record<CelebrationKind, number> = { task: 70, milestone: 150 };
const DURATION_MS: Record<CelebrationKind, number> = { task: 1600, milestone: 2400 };

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
export function celebrate(kind: CelebrationKind): void {
  if (typeof document === "undefined" || !motionAllowed()) return;

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:100;";
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
  const originX = window.innerWidth / 2;
  const originY = window.innerHeight * 0.38;
  const particles: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT[kind]; i += 1) {
    // An even ring of launch angles, jittered so the pop reads as a burst, not a circle.
    const angle = (i / PARTICLE_COUNT[kind]) * Math.PI * 2 + Math.random() * 0.35;
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

  const duration = DURATION_MS[kind];
  const startedAt = performance.now();

  const frame = (now: number): void => {
    const elapsed = now - startedAt;
    if (elapsed >= duration) {
      canvas.remove();
      return;
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
