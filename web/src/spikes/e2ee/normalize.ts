/**
 * AVORA-E0 · M5 — Vietnamese folding for on-device search (spike only, not product code):
 * NFD, marks removed, `đ` → `d`, lower case. "co phai" must find "có phải".
 */
export function foldVi(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

/** Words (letters / digits) and emoji as separate tokens, folded. */
export function tokenize(text: string): string[] {
  const folded = foldVi(text);
  const words = folded.match(/[\p{L}\p{N}]+/gu) ?? [];
  const emoji = text.match(/\p{Extended_Pictographic}/gu) ?? [];
  return [...words, ...emoji];
}

/** Prefix match on every query token, AND across tokens (option 1: a hand-written inverted index). */
export class InvertedIndex {
  private readonly postings = new Map<string, number[]>();
  private sortedTerms: string[] | null = null;

  add(id: number, text: string): void {
    for (const token of new Set(tokenize(text))) {
      const list = this.postings.get(token);
      if (list === undefined) this.postings.set(token, [id]);
      else list.push(id);
    }
    this.sortedTerms = null;
  }

  get termCount(): number {
    return this.postings.size;
  }

  private terms(): string[] {
    if (this.sortedTerms === null) this.sortedTerms = [...this.postings.keys()].sort();
    return this.sortedTerms;
  }

  /** Ids whose text has, for every query token, a word starting with it. */
  search(query: string): number[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    let result: Set<number> | null = null;
    const terms = this.terms();
    for (const token of tokens) {
      const hits = new Set<number>();
      let lo = 0;
      let hi = terms.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (terms[mid] < token) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < terms.length && terms[i].startsWith(token); i += 1) {
        for (const id of this.postings.get(terms[i]) ?? []) hits.add(id);
      }
      result = result === null ? hits : new Set([...result].filter((id) => hits.has(id)));
      if (result.size === 0) break;
    }
    return [...(result ?? [])];
  }

  toJSON(): [string, number[]][] {
    return [...this.postings.entries()];
  }
}

/** Option 3: a straight scan over folded text (the baseline). */
export function linearSearch(folded: readonly string[], query: string): number[] {
  const words = foldVi(query).split(/\s+/).filter((w) => w !== "");
  const out: number[] = [];
  for (let i = 0; i < folded.length; i += 1) if (words.every((w) => folded[i].includes(w))) out.push(i);
  return out;
}
