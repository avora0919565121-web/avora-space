import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// AVORA-93 · 91.1: `screens.short` is a raw media query, so Tailwind 3 drops every `max-*`
// variant silently. Such classes compile to nothing; write mobile-first instead.
const ROOT = join(__dirname, "..");
const MAX_VARIANT = /\bmax-(sm|md|lg|xl|2xl):/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("91.1 · no Tailwind max-* variants", () => {
  it("src has no max-sm/md/lg/xl: classes", () => {
    const offenders = sourceFiles(ROOT).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, index) => (MAX_VARIANT.test(line) ? `${file.slice(ROOT.length + 1)}:${index + 1}` : null))
        .filter((hit): hit is string => hit !== null),
    );
    expect(offenders).toEqual([]);
  });
});
