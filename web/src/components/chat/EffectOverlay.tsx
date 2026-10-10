import { useEffect, useMemo } from "react";

import type { SendEffect } from "@/lib/chat";

const GLYPH: Record<SendEffect, string[]> = {
  fireworks: ["✨", "🎆", "🎇", "✨"],
  hearts: ["💕", "❤️", "💗", "💖"],
  balloons: ["🎈", "🎈", "🎈", "🎉"],
  buzz: [],
};

/**
 * K5 · 84 §4.2A — an effect played once on arrival. `full`: across the chat, ≤ 2 s; `light`: inside
 * the bubble's corner, ≤ 1 s. Buzz is a short shake + a tiny vibration. Never with reduced motion
 * (the caller maps that to `off`). Purely decorative: aria-hidden, no focus, no pointer events.
 */
export function EffectOverlay({
  effect,
  scope,
  onDone,
}: {
  effect: SendEffect;
  scope: "full" | "light";
  onDone: () => void;
}) {
  const duration = scope === "full" ? 1900 : 950;
  useEffect(() => {
    if (effect === "buzz" && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate([20, 40, 20]);
    const timer = window.setTimeout(onDone, duration);
    return () => window.clearTimeout(timer);
  }, [effect, duration, onDone]);

  const pieces = useMemo(() => {
    const glyphs = GLYPH[effect];
    if (glyphs.length === 0) return [];
    const count = scope === "full" ? 16 : 5;
    return Array.from({ length: count }, (_, index) => ({
      glyph: glyphs[index % glyphs.length],
      left: `${(index * 61) % 100}%`,
      delay: `${(index * 97) % 500}ms`,
      size: scope === "full" ? 22 + ((index * 7) % 14) : 14 + ((index * 5) % 6),
      drift: `${((index * 37) % 60) - 30}px`,
    }));
  }, [effect, scope]);

  return (
    <div
      aria-hidden="true"
      data-effect-overlay={scope}
      data-effect={effect}
      className={
        scope === "full"
          ? "pointer-events-none absolute inset-0 z-20 overflow-hidden"
          : "pointer-events-none absolute inset-0 z-10 overflow-visible"
      }
    >
      {pieces.map((piece, index) => (
        <span
          key={index}
          className="avora-effect-piece absolute bottom-0"
          style={
            {
              left: piece.left,
              fontSize: piece.size,
              animationDelay: piece.delay,
              animationDuration: `${duration - 400}ms`,
              "--drift": piece.drift,
              "--rise": scope === "full" ? "-70vh" : "-48px",
            } as React.CSSProperties
          }
        >
          {piece.glyph}
        </span>
      ))}
    </div>
  );
}
