import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import baseline from "./fixtures/scroll-x-baseline.json";

/*
 * KHỐI 2F (AVORA-105 · D.4) — chốt chặn: a vertical scroller (`overflow-y-auto` / `overflow-y-scroll`)
 * must also say what happens sideways (`overflow-x-*`, or the `scroll-y` / `scroll-y-free` utility).
 * Old places are listed in the baseline so they do not block; a file may only go down, never up.
 */
const SRC = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : files(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

/** Class strings (quoted literals) with a vertical scroller and nothing for x. */
export function unguardedScrollers(source: string): number {
  const strings = source.match(/"[^"\n]*"|`[^`]*`/g) ?? [];
  return strings.filter((text) => /\boverflow-y-(auto|scroll)\b/.test(text) && !/\boverflow-x-|\bscroll-y(-free)?\b|\boverflow-hidden\b/.test(text)).length;
}

describe("KHỐI 2F · chốt chặn cuộn ngang", () => {
  const counts: Record<string, number> = {};
  for (const path of files(SRC)) {
    const n = unguardedScrollers(readFileSync(path, "utf8"));
    if (n > 0) counts[relative(SRC, path)] = n;
  }

  it("không tệp nào thêm vùng cuộn dọc thiếu overflow-x / scroll-y so với danh sách nền", () => {
    const grown = Object.entries(counts).filter(([file, n]) => n > ((baseline as Record<string, number>)[file] ?? 0));
    expect(grown).toEqual([]);
  });

  it("danh sách nền chỉ giảm (cập nhật tệp nền khi sửa bớt)", () => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const base = Object.values(baseline as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(base);
  });

  it("nhận ra đúng mẫu", () => {
    expect(unguardedScrollers('<div className="min-h-0 flex-1 overflow-y-auto" />')).toBe(1);
    expect(unguardedScrollers('<div className="min-h-0 flex-1 scroll-y" />')).toBe(0);
    expect(unguardedScrollers('<div className="overflow-y-auto overflow-x-hidden" />')).toBe(0);
  });
});
