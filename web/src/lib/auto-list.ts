/**
 * What a line is doing, when it starts like a list.
 *
 * Only two shapes are recognised, because these are the two people actually type into a note:
 * a dash for things with no order, a number for things with one. Anything else is ordinary
 * prose and is left completely alone.
 */
export type ListMarker =
  | { kind: "bullet"; indent: string; marker: string }
  | { kind: "number"; indent: string; value: number; separator: string };

/** `- `, `* `, `• ` — a bullet, with whatever indentation the line already carries. */
const BULLET = /^(\s*)([-*•])\s+/;
/** `1. ` or `1) ` — a numbered line. */
const NUMBER = /^(\s*)(\d{1,3})([.)])\s+/;

/** Reads the list marker a line opens with, or null when it is just a sentence. */
export function readMarker(line: string): ListMarker | null {
  const bullet = BULLET.exec(line);
  if (bullet) return { kind: "bullet", indent: bullet[1], marker: bullet[2] };

  const numbered = NUMBER.exec(line);
  if (numbered) {
    return {
      kind: "number",
      indent: numbered[1],
      value: Number.parseInt(numbered[2], 10),
      separator: numbered[3],
    };
  }
  return null;
}

/** Whether a line is a marker and nothing else — the signal that the list is finished. */
export function isEmptyItem(line: string): boolean {
  const marker = readMarker(line);
  if (marker === null) return false;
  return line.replace(BULLET, "").replace(NUMBER, "").trim() === "";
}

/** What the next line should open with, once this one has been continued. */
function nextPrefix(marker: ListMarker): string {
  if (marker.kind === "bullet") return `${marker.indent}${marker.marker} `;
  return `${marker.indent}${marker.value + 1}${marker.separator} `;
}

/** The text and caret a textarea should hold after Enter is handled. */
export type AutoListResult = { value: string; caret: number };

/**
 * Enter inside a list, worked out as pure text.
 *
 * Three outcomes, and the third is the one that makes this bearable to use:
 *
 * - On a list line with something written on it, the next line opens with the same kind of
 *   marker, numbers counting on.
 * - On a list line with nothing written on it, the marker is REMOVED instead. That is how a
 *   list ends — pressing Enter twice, exactly like every editor people already know. Without
 *   it a list could only be escaped by deleting characters by hand.
 * - Anywhere else, null: the textarea keeps its ordinary behaviour, and this never touches
 *   prose.
 *
 * Returns null rather than an unchanged value so the caller knows when NOT to preventDefault.
 */
export function continueList(value: string, caret: number): AutoListResult | null {
  // A selection spanning text is a replacement, not a continuation — leave it alone.
  const before = value.slice(0, caret);
  const after = value.slice(caret);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart);

  const marker = readMarker(line);
  if (marker === null) return null;

  if (isEmptyItem(line)) {
    // Drop the abandoned marker and leave a clean blank line.
    const next = `${value.slice(0, lineStart)}\n${after}`;
    return { value: next, caret: lineStart + 1 };
  }

  const prefix = nextPrefix(marker);
  const next = `${before}\n${prefix}${after}`;
  return { value: next, caret: caret + 1 + prefix.length };
}
