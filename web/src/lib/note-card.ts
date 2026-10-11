/** AVORA-100 · S.3 (a) — the markers a forwarded ghi chép shows, level by level. */
/** The marker a level shows (I. · 1. · A. · a. · •), counted within its parent like the editor does. */
export function noteCardMarkers(blocks: readonly { level: number }[]): string[] {
  const counters: number[] = [];
  return blocks.map((block) => {
    counters.length = block.level + 1;
    counters[block.level] = (counters[block.level] ?? 0) + 1;
    const n = counters[block.level];
    const roman = (value: number): string => {
      const table: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
      let rest = value;
      let out = "";
      for (const [v, s] of table) while (rest >= v) { out += s; rest -= v; }
      return out;
    };
    if (block.level === 0) return `${roman(n)}.`;
    if (block.level === 1) return `${n}.`;
    if (block.level === 2) return `${String.fromCharCode(64 + Math.min(26, n))}.`;
    if (block.level === 3) return `${String.fromCharCode(96 + Math.min(26, n))}.`;
    return "•";
  });
}
