/**
 * Folds Vietnamese text for search: lower case, no tone or vowel marks, `đ` → `d`, spaces
 * collapsed. "Nguyễn Văn Đạt" and "nguyen van dat" fold to the same string, so typing without
 * accents still finds the person (AVORA-38 / Nhóm E). Pure and cheap — safe in a render filter.
 */
export function normalizeSearch(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** True when every word of the query appears in at least one of the fields (accent-insensitive). */
export function matchesSearch(query: string, fields: readonly (string | null | undefined)[]): boolean {
  const needle = normalizeSearch(query);
  if (needle.length === 0) return true;
  const haystack = fields.map((field) => normalizeSearch(field)).join(" \u0001 ");
  const compactHaystack = haystack.replace(/[\s-]/g, "");
  return needle.split(" ").every((word) => haystack.includes(word) || compactHaystack.includes(word.replace(/-/g, "")));
}
