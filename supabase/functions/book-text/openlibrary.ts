// AVORA-103 · B — Open Library / Internet Archive: the plain OCR text (`{ia}_djvu.txt`) of a public
// edition, cleaned into the same blocks as Gutenberg. Only scans clean enough to read are kept:
// more than 2% stray characters → "Bản này chữ quét chưa sạch".

export type PlainBlock = { k: "h"; t: string; l: number } | { k: "p"; t: string };

/** Letters of any script, digits, spaces and ordinary punctuation are fine; the rest is OCR noise. */
const FINE = /[\p{L}\p{M}\p{N}\s.,;:!?'"’‘“”()\[\]\-–—…«»\/&%*§°£$#@+=]/u;

/** Share of characters that are OCR noise (0…1), over the text after page furniture is gone. */
export function ocrNoise(text: string): number {
  let total = 0;
  let bad = 0;
  for (const ch of text) {
    if (ch === "\n" || ch === " ") continue;
    total += 1;
    if (!FINE.test(ch)) bad += 1;
  }
  return total === 0 ? 1 : bad / total;
}

const CHAPTER = /^(?:(?:CHAPTER|Chapter|CHAP\.|BOOK|Book|PART|Part|VOLUME|Volume|CANTO|Canto|STAVE|LETTER|Letter|CHAPITRE|Chapitre|LIVRE|Livre|PARTIE|Partie|TOME|Tome)\s+(?:[IVXLCDM]{1,8}[.L]?|\d{1,3}\.?|[A-Z][a-z]+)\b.{0,70}|(?:[IVXLCDM]{1,7})\.?)$/;

/** Lines that are page furniture: numbers, running heads, scanner marks. */
function isFurniture(line: string): boolean {
  if (/^[\divxlcdm\s.\-*'"]{1,8}$/i.test(line)) return true;
  // A line of mostly symbols (stamps, smudges) or a lone short word fragment.
  const letters = (line.match(/\p{L}/gu) ?? []).length;
  return line.length <= 3 || letters / line.length < 0.5;
}

/**
 * Plain OCR text → blocks: paragraphs from blank-line breaks, hyphenated line ends joined,
 * running heads and page numbers dropped, `CHAPTER IV.` lines as headings.
 */
export function plainTextToBlocks(raw: string): PlainBlock[] {
  const paragraphs = raw.replace(/\r/g, "").replace(/\f/g, "\n\n").split(/\n\s*\n/);
  const blocks: PlainBlock[] = [];
  // Running heads repeat page after page: count short lines and drop those seen many times.
  const seen = new Map<string, number>();
  for (const para of paragraphs) {
    const line = para.trim().replace(/\s+/g, " ");
    if (line.length > 0 && line.length < 60) seen.set(line.toUpperCase(), (seen.get(line.toUpperCase()) ?? 0) + 1);
  }
  for (const para of paragraphs) {
    const lines = para.split("\n").map((line) => line.replace(/\s{2,}/g, " ").trim()).filter((line) => line !== "");
    if (lines.length === 0) continue;
    const joined = lines.join(" ");
    if (lines.length === 1 && CHAPTER.test(joined) && !/^[IVXLCDM]{1,7}\.?$/.test(joined)) {
      blocks.push({ k: "h", t: joined.replace(/XL$/, "XI").replace(/\s+/g, " "), l: 2 });
      continue;
    }
    if (joined.length < 60 && (seen.get(joined.toUpperCase()) ?? 0) >= 4) continue;
    if (isFurniture(joined)) continue;
    let text = "";
    for (const line of lines) {
      if (text.endsWith("-") && /^\p{Ll}/u.test(line)) text = `${text.slice(0, -1)}${line}`;
      else text = text === "" ? line : `${text} ${line}`;
    }
    blocks.push({ k: "p", t: text.replace(/\s+([,.;:!?])/g, "$1") });
  }
  return blocks;
}

/** Everything before the first chapter heading that looks like scanner front matter is left out. */
export function dropFrontNoise(blocks: PlainBlock[]): PlainBlock[] {
  const first = blocks.findIndex((block) => block.k === "h");
  if (first <= 0) return blocks;
  const front = blocks.slice(0, first).filter((block) => block.k === "p" && block.t.length >= 80);
  return [...front, ...blocks.slice(first)];
}
