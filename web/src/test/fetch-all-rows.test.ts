import { describe, expect, test } from "vitest";

import { PAGE_SIZE, fetchAllRows, inBatches } from "@/lib/fetch-all-rows";

/** A fake table that, like PostgREST, never answers more than 1 000 rows at once. */
function fakeTable(count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  const build = (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to + 1, from + 1000);
    return Promise.resolve({ data: rows.slice(from, end), error: null });
  };
  return { build, calls };
}

describe("AVORA-102 · B1.1 fetchAllRows", () => {
  test("2 500 rows come back whole, in three pages", async () => {
    const table = fakeTable(2500);
    const rows = await fetchAllRows<{ id: number }>(table.build);
    expect(rows.length).toBe(2500);
    expect(rows[2499].id).toBe(2499);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500);
    expect(table.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  test("exactly 1 000 rows asks once more and stops on the empty page", async () => {
    const table = fakeTable(PAGE_SIZE);
    expect((await fetchAllRows<{ id: number }>(table.build)).length).toBe(1000);
    expect(table.calls.length).toBe(2);
  });

  test("an error is thrown, not swallowed as an empty list", async () => {
    await expect(fetchAllRows(() => Promise.resolve({ data: null, error: { code: "42501", message: "denied" } }))).rejects.toThrow("denied");
  });

  test("inBatches splits 1 800 into 500 + 500 + 500 + 300", () => {
    expect(inBatches(Array.from({ length: 1800 }, (_, i) => i), 500).map((b) => b.length)).toEqual([500, 500, 500, 300]);
  });
});

