import { currentRhythm, motionFor, prefersReducedMotion } from "@/lib/motion";
import { DEFAULT_CELEBRATION_STYLE, type CelebrationStyle } from "@/lib/look-prefs";

/**
 * The moment work closes — for the person who closed it, and nobody else.
 *
 * AVORA-56 · E (ADR-036) replaces the single wash with four effects the person picks in
 * Cài đặt › Tuỳ chọn chung › Hiệu ứng khi hoàn thành:
 *
 *   subtle     Nhẹ nhàng tinh tế    the old soft wash (opacity only)
 *   inspiring  Chuyển động cảm hứng the row swells to ≈1.06 and back, a check draws itself (≤ 0.5 s)
 *   vivid      Sắc màu nổi bật       one band of colour runs once around the screen edge (≤ 1.2 s)
 *   fireworks  Pháo hoa phấn khích   paper confetti (≤ 1.2 s)
 *
 * A milestone is stronger (vivid: two laps, fireworks: three bursts). When the device asks for
 * reduced motion, every choice becomes `subtle`, whatever was picked.
 *
 * Deliberately ephemeral: nothing is stored or sent, no sound, and the next reload holds no
 * trace. It is called only straight after a completion mutation has succeeded (or two people
 * connect) — never on load, never for an ordinary message. Every layer is appended to
 * `document.body` with `pointer-events: none`, so it never blocks a tap and a clipping sheet
 * cannot clip it.
 */

export type CelebrationKind = "task" | "milestone" | "connection";

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

/** Upper bounds from the brief, used by the effects and by the tests. */
export const CELEBRATION_LIMITS_MS: Readonly<Record<Exclude<CelebrationStyle, "subtle">, number>> = {
  inspiring: 500,
  vivid: 1200,
  fireworks: 1200,
};

/** How many laps / bursts a kind gets. */
export function celebrationRepeats(style: CelebrationStyle, kind: CelebrationKind): number {
  if (kind !== "milestone") return 1;
  if (style === "vivid") return 2;
  if (style === "fireworks") return MILESTONE_BURSTS;
  return 1;
}

/** The style that actually plays: reduced motion always wins. */
export function effectiveCelebrationStyle(style: CelebrationStyle, reduced: boolean): CelebrationStyle {
  return reduced ? "subtle" : style;
}

let chosenStyle: CelebrationStyle = DEFAULT_CELEBRATION_STYLE;

/** Kept in step with the profile by `LookSync`; read by every `celebrate()` call. */
export function setCelebrationStyle(style: CelebrationStyle): void {
  chosenStyle = style;
}

export function getCelebrationStyle(): CelebrationStyle {
  return chosenStyle;
}

/** Warm and faint, from the app's own palette: terracotta for work, amber for a milestone. */
const WASH: Record<CelebrationKind, string> = {
  task: "radial-gradient(ellipse at 50% 40%, hsl(13 73% 56% / 0.14), hsl(13 73% 56% / 0) 70%)",
  connection: "radial-gradient(ellipse at 50% 40%, hsl(13 73% 56% / 0.14), hsl(13 73% 56% / 0) 70%)",
  milestone: "radial-gradient(ellipse at 50% 40%, hsl(32 53% 52% / 0.22), hsl(32 53% 52% / 0) 72%)",
};

const PALETTE = ["#E2683C", "#E9A23B", "#3E8E7E", "#5B7FD6", "#D9577E", "#F3D36B"];

/** The wash's timings for a rhythm: fade in, hold, fade out — each one token long. */
export function completionTimeline(reduced: boolean): { fadeMs: number; holdMs: number; totalMs: number } {
  const { durationMs } = motionFor(currentRhythm(reduced));
  return { fadeMs: durationMs, holdMs: durationMs, totalMs: durationMs * 3 };
}

type CelebrateOptions = {
  /** Overrides the saved choice — `Xem thử` in Cài đặt. */
  style?: CelebrationStyle;
  /** The task row to swell for `inspiring` (matched by `data-task-id`). */
  taskId?: string | null;
  /** Or any element to swell. */
  anchor?: Element | null;
};

function overlay(css: string[]): HTMLDivElement {
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = ["position:fixed", "inset:0", "pointer-events:none", "z-index:2147483000", ...css].join(";");
  document.body.appendChild(layer);
  return layer;
}

function playWash(kind: CelebrationKind): void {
  const motion = motionFor(currentRhythm());
  const { fadeMs, holdMs } = completionTimeline(currentRhythm() === "tinh");
  const layer = overlay(["opacity:0", `background:${WASH[kind]}`, `transition:${motion.transition}`]);
  layer.dataset.completionWash = kind;
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

function findAnchor(options: CelebrateOptions): Element | null {
  if (options.anchor) return options.anchor;
  if (!options.taskId) return null;
  const nodes = document.querySelectorAll(`[data-task-id="${CSS.escape(options.taskId)}"]`);
  // The visible one: a list may hold a copy in a hidden column.
  for (const node of Array.from(nodes)) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return node;
  }
  return null;
}

function playInspiring(kind: CelebrationKind, options: CelebrateOptions): void {
  const total = CELEBRATION_LIMITS_MS.inspiring;
  const anchor = findAnchor(options);
  const rect = anchor?.getBoundingClientRect() ?? null;

  if (anchor instanceof HTMLElement && typeof anchor.animate === "function") {
    anchor.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.06)", offset: 0.4 }, { transform: "scale(1)" }],
      { duration: total - 80, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }

  // The check sits beside the row (right edge) so it never covers the words.
  const size = rect !== null ? Math.min(30, Math.max(22, rect.height * 0.6)) : 56;
  const left = rect !== null ? Math.max(8, rect.right - size - 12) : window.innerWidth / 2 - size / 2;
  const top = rect !== null ? rect.top + rect.height / 2 - size / 2 : window.innerHeight * 0.42 - size / 2;
  const colour = kind === "milestone" ? "#E9A23B" : "#E2683C";

  const holder = document.createElement("div");
  holder.setAttribute("aria-hidden", "true");
  holder.dataset.completionCheck = kind;
  holder.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${size}px;height:${size}px;pointer-events:none;z-index:2147483000`;
  holder.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}"><circle cx="16" cy="16" r="14" fill="${colour}" opacity="0.14"/><path d="M9 16.5l4.6 4.6L23 11.6" fill="none" stroke="${colour}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="24" stroke-dashoffset="24"/></svg>`;
  document.body.appendChild(holder);
  const path = holder.querySelector("path");
  path?.animate([{ strokeDashoffset: 24 }, { strokeDashoffset: 0 }], { duration: 260, delay: 60, fill: "forwards", easing: "ease-out" });
  holder.animate([{ opacity: 1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: total, fill: "forwards" });
  window.setTimeout(() => holder.remove(), total + 40);
}

function playVivid(kind: CelebrationKind): void {
  const laps = celebrationRepeats("vivid", kind);
  // One lap at the limit; a milestone's two laps run a little quicker each.
  const lapMs = laps === 1 ? CELEBRATION_LIMITS_MS.vivid : 900;
  const total = lapMs * laps;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const perimeter = 2 * (w + h);
  const band = Math.round(perimeter * 0.22);
  const id = `avora-vivid-${Date.now()}`;

  const layer = overlay([]);
  layer.dataset.completionBand = kind;
  layer.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="position:absolute;inset:0"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${PALETTE[0]}"/><stop offset="0.35" stop-color="${PALETTE[1]}"/><stop offset="0.7" stop-color="${PALETTE[2]}"/><stop offset="1" stop-color="${PALETTE[3]}"/></linearGradient></defs><rect x="2.5" y="2.5" width="${w - 5}" height="${h - 5}" rx="14" fill="none" stroke="url(#${id})" stroke-width="5" stroke-linecap="round" stroke-dasharray="${band} ${perimeter - band}" stroke-dashoffset="0"/></svg>`;
  const rect = layer.querySelector("rect");
  rect?.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: -perimeter * laps }], { duration: total, easing: "linear", fill: "forwards" });
  layer.animate([{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: total, fill: "forwards" });
  window.setTimeout(() => layer.remove(), total + 40);
}

type Piece = { x: number; y: number; vx: number; vy: number; size: number; spin: number; angle: number; colour: string; born: number };

function playFireworks(kind: CelebrationKind): void {
  const bursts = celebrationRepeats("fireworks", kind);
  const gap = 260;
  const life = CELEBRATION_LIMITS_MS.fireworks;
  const total = life + gap * (bursts - 1);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.completionConfetti = kind;
  canvas.width = window.innerWidth * ratio;
  canvas.height = window.innerHeight * ratio;
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000";
  document.body.appendChild(canvas);
  const context = canvas.getContext("2d");
  if (context === null) {
    canvas.remove();
    return;
  }
  context.scale(ratio, ratio);

  const pieces: Piece[] = [];
  const start = performance.now();
  const spawn = (index: number): void => {
    const originX = window.innerWidth * (bursts === 1 ? 0.5 : 0.25 + 0.25 * index);
    const originY = window.innerHeight * 0.38;
    const born = start + index * gap;
    for (let i = 0; i < 70; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 6;
      pieces.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        size: 5 + Math.random() * 5,
        spin: (Math.random() - 0.5) * 0.4,
        angle: Math.random() * Math.PI,
        colour: PALETTE[i % PALETTE.length],
        born,
      });
    }
  };
  for (let i = 0; i < bursts; i += 1) spawn(i);

  const frame = (now: number): void => {
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const piece of pieces) {
      const age = now - piece.born;
      if (age < 0 || age > life) continue;
      piece.vy += 0.22;
      piece.vx *= 0.985;
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.angle += piece.spin;
      context.save();
      context.globalAlpha = Math.max(0, 1 - Math.max(0, age - life * 0.6) / (life * 0.4));
      context.translate(piece.x, piece.y);
      context.rotate(piece.angle);
      context.fillStyle = piece.colour;
      context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      context.restore();
    }
    if (now - start < total) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/**
 * Plays the chosen effect once. Fire-and-forget: callers celebrate after their mutation has
 * succeeded and never wait on it.
 */
export function celebrate(kind: CelebrationKind, options: CelebrateOptions = {}): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const style = effectiveCelebrationStyle(options.style ?? chosenStyle, prefersReducedMotion());
  try {
    if (style === "inspiring") playInspiring(kind, options);
    else if (style === "vivid") playVivid(kind);
    else if (style === "fireworks") playFireworks(kind);
    else playWash(kind);
  } catch {
    // A missing browser API must never turn a finished task into an error.
    playWash(kind);
  }
}
