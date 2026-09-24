/**
 * The faint colour Avora Space sits in.
 *
 * A STATE, not an animation: worked out once when the screen opens and never recomputed while
 * it is on screen — no timer, no polling, no fade from one tone to the next.
 *
 * AVORA has no weather source yet, so the time of day stands in for it: warm and bright in the
 * morning, neutral at midday, amber towards evening, cool and dim at night. When a weather
 * provider is chosen it becomes one more input to `ambientTone`, and the screen does not change.
 */
export type DayPart = "sang" | "trua" | "chieu" | "toi" | "dem";

export type AmbientTone = {
  part: DayPart;
  /** -1 cool … +1 warm. */
  warmth: number;
  /** 0 dim … 1 bright. */
  brightness: number;
  /** A CSS background layered over the paper. Very low alpha by design. */
  wash: string;
};

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 11) return "sang";
  if (hour >= 11 && hour < 14) return "trua";
  if (hour >= 14 && hour < 18) return "chieu";
  if (hour >= 18 && hour < 22) return "toi";
  return "dem";
}

const TONES: Readonly<Record<DayPart, { warmth: number; brightness: number; hsl: string }>> = {
  sang: { warmth: 0.5, brightness: 1, hsl: "38 90% 70%" },
  trua: { warmth: 0.1, brightness: 0.9, hsl: "45 60% 80%" },
  chieu: { warmth: 0.8, brightness: 0.7, hsl: "22 85% 65%" },
  toi: { warmth: 0.3, brightness: 0.4, hsl: "280 30% 60%" },
  dem: { warmth: -0.6, brightness: 0.2, hsl: "220 45% 55%" },
};

/** Alpha of the wash. Low enough that text contrast is never affected. */
export const AMBIENT_ALPHA = 0.1;

export function ambientTone(now: Date = new Date()): AmbientTone {
  const part = dayPart(now.getHours());
  const tone = TONES[part];
  return {
    part,
    warmth: tone.warmth,
    brightness: tone.brightness,
    wash: `linear-gradient(180deg, hsl(${tone.hsl} / ${AMBIENT_ALPHA}) 0%, hsl(${tone.hsl} / 0) 60%)`,
  };
}
