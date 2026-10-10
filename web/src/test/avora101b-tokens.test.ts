import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DEFAULT_FONT, FONT_IDS, FONT_STACK, isFontId } from "@/lib/font-pref";

/*
 * AVORA-101B · KHỐI 2E (ADR-079) — one spacing scale, two radii, one font.
 */
const ROOT = join(__dirname, "..");
const WEB = join(ROOT, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function hits(pattern: RegExp, allow: readonly string[] = []): string[] {
  return sourceFiles(ROOT).flatMap((file) => {
    const name = file.slice(ROOT.length + 1);
    if (allow.some((part) => name.includes(part))) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .map((line, index) => (pattern.test(line) ? `${name}:${index + 1}` : null))
      .filter((hit): hit is string => hit !== null);
  });
}

describe("2E · token", () => {
  it("index.css khai thang khoảng cách 4 bậc, hai bán kính, lề tab và một font gốc", () => {
    const css = readFileSync(join(ROOT, "index.css"), "utf8");
    expect(css).toContain("--space-1: 4px;");
    expect(css).toContain("--space-2: 8px;");
    expect(css).toContain("--space-3: 12px;");
    expect(css).toContain("--space-4: 16px;");
    expect(css).toContain("--radius-card: 16px;");
    expect(css).toMatch(/--radius-control: min\(var\(--btn-radius/);
    expect(css).toContain("--tab-inset: 20px;");
    // Exactly one family for the app (the sticker face is the only other @font-face).
    const families = css.match(/font-family:[^;]+;/g) ?? [];
    expect(families).toEqual(['font-family: "Baloo 2";', "font-family: var(--font-sans);"]);
  });

  it("không còn rounded-xl / 2xl / 3xl lẻ — chỉ rounded-card / rounded-control", () => {
    expect(hits(/(^|[^\w-])rounded(-[a-z]{1,2})?-(xl|2xl|3xl)\b/)).toEqual([]);
  });

  it("không component nào tự đặt phông (trừ trình đọc sách, xem trước phông, sticker)", () => {
    expect(hits(/font-family|fontFamily|font-\[/, ["pages/BookReader.tsx", "components/FontPrefCard.tsx", "lib/stickers.ts"])).toEqual([]);
  });

  it("chọn phông chỉ ở Cài đặt › Tuỳ chọn chung; mọi lựa chọn là chữ không chân", () => {
    expect(hits(/FontPrefCard/, ["components/FontPrefCard.tsx"])).toEqual(["pages/SettingsPreferences.tsx:5", expect.stringMatching(/^pages\/SettingsPreferences\.tsx:\d+$/)]);
    expect(FONT_IDS).toHaveLength(3);
    expect(DEFAULT_FONT).toBe("inter-tight");
    for (const id of FONT_IDS) expect(FONT_STACK[id]).toMatch(/sans-serif$/);
    expect(isFontId("serif")).toBe(false);
    const html = readFileSync(join(WEB, "index.html"), "utf8");
    expect(html).toContain('localStorage.getItem("avora.font")');
  });
});
