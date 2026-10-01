/**
 * The two personal looks (AVORA-56 · E, AVORA-57 · F). Pure: no client import, so the effect
 * engine and the tests can read it without a Supabase connection.
 */
export type CelebrationStyle = "subtle" | "inspiring" | "vivid" | "fireworks";
export type ButtonStyle = "round" | "rounded" | "icon";

export const CELEBRATION_STYLES: readonly CelebrationStyle[] = ["subtle", "inspiring", "vivid", "fireworks"];
export const BUTTON_STYLES: readonly ButtonStyle[] = ["round", "rounded", "icon"];
export const DEFAULT_CELEBRATION_STYLE: CelebrationStyle = "inspiring";
export const DEFAULT_BUTTON_STYLE: ButtonStyle = "round";

export function isCelebrationStyle(value: unknown): value is CelebrationStyle {
  return typeof value === "string" && (CELEBRATION_STYLES as readonly string[]).includes(value);
}

export function isButtonStyle(value: unknown): value is ButtonStyle {
  return typeof value === "string" && (BUTTON_STYLES as readonly string[]).includes(value);
}
