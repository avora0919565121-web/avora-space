/**
 * AVORA-102 · B1.1 — Supabase answers at most 1 000 rows per request (`max_rows`). A list that
 * can grow past that must be read page by page, or everything after row 1 000 silently "vanishes"
 * (VMT's Danh bạ stopped at 1 000 of ~3 756 contacts).
 *
 * `build(from, to)` must return a fresh query with a stable, total order (end on a unique column,
 * e.g. `.order("name").order("id")`) and `.range(from, to)` applied — otherwise pages can overlap
 * or skip rows when two rows tie.
 */
export const PAGE_SIZE = 1000;

/** The shape every PostgREST builder resolves to. */
type PageResult<T> = { data: T[] | null; error: { code?: string; message: string } | null };

export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  // Hard stop far above any real account: a broken `range` must never loop forever.
  for (let page = 0; page < 500; page += 1) {
    const from = page * pageSize;
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
}

/** Splits a list into batches of at most `size` — for RPCs that refuse more than that at once. */
export function inBatches<T>(items: readonly T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
