/**
 * CC-13: the one look of a chosen chip in AVORA — two kinds, both on the house tokens.
 *
 * - Chip (lọc / chọn một): soft accent wash, accent ink, accent edge — the look Thư phòng and the task
 *   card already used. Never solid black (`bg-foreground`) or solid orange for "selected".
 * - Segment (a few options on one track): the chosen one is a card lifted off the track.
 *
 * Shape, size and padding stay with each place; only the chosen / not-chosen colours come from here.
 */
export const CHIP_ON = "border-personal bg-personal-soft text-personal-soft-foreground";
export const CHIP_OFF = "border-border bg-card text-foreground hover:bg-accent/40";

/** For a chip or tab with no border of its own (finance tabs, Liên hệ groups). */
export const CHIP_ON_PLAIN = "bg-personal-soft text-personal-soft-foreground";

export const SEGMENT_TRACK = "inline-flex rounded-md border border-border bg-secondary/60 p-0.5";
export const SEGMENT_ON = "bg-card text-foreground shadow-sm";
export const SEGMENT_OFF = "text-muted-foreground hover:text-foreground";

export function chipTone(isOn: boolean): string {
  return isOn ? CHIP_ON : CHIP_OFF;
}
