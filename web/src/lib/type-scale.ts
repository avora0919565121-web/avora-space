/**
 * The one type scale AVORA reads in: four steps, each a size the app already uses — no new sizes.
 *
 * 1. Block title        — what the block is.                          15px semibold, ink.
 * 2. Block description  — the one line saying what it holds; softer.  13px, warm grey.
 * 3. Main content       — the rows people actually read.              14.5px, ink.
 * 4. Metadata           — dates, labels, counters; the faintest.      12px, warm grey at 80%.
 *
 * Kept as class strings rather than a Tailwind theme entry so every screen names a step, not a
 * pixel value, and a later change of one step moves the whole app at once.
 */
export const TYPE = {
  blockTitle: "text-[15px] font-semibold leading-snug text-foreground",
  blockDescription: "text-[13px] leading-5 text-muted-foreground",
  body: "text-[14.5px] text-foreground",
  meta: "text-[12px] text-muted-foreground/80",
} as const;

export type TypeStep = keyof typeof TYPE;
