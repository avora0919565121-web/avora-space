import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// AVORA-94B · N.12 (ADR-062): one shape for back (`‹`), one way back (`useBack` / `goBack`).
const ROOT = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(ROOT).map((path) => ({ path: path.slice(ROOT.length + 1), text: readFileSync(path, "utf8") }));

describe("N.12 · one back button, one way back", () => {
  it("no ArrowLeft icon is rendered anywhere (only `‹`)", () => {
    const offenders = files
      .filter((file) => file.path !== "components/ui/carousel.tsx")
      .filter((file) => /<ArrowLeft\b/.test(file.text))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("no ReturnChip any more", () => {
    expect(files.filter((file) => /<ReturnChip\b|import[^\n]*\bReturnChip\b/.test(file.text)).map((file) => file.path)).toEqual([]);
  });

  it("back buttons never call navigate( directly in their onClick", () => {
    const offenders: string[] = [];
    for (const file of files) {
      // A button labelled as a way back whose own onClick navigates.
      const pattern = /aria-label=["{`][^"}`]*Quay lại[^>]*?onClick=\{\(\) => navigate\(/gs;
      const reverse = /onClick=\{\(\) => navigate\([^)]*\)\}[^>]*?aria-label=["{`][^"}`]*Quay lại/gs;
      if (pattern.test(file.text) || reverse.test(file.text)) offenders.push(file.path);
    }
    expect(offenders).toEqual([]);
  });

  it("the old per-screen back rules are gone", () => {
    expect(files.filter((file) => /\bchatBackTarget\b|\blogoAction\b/.test(file.text)).map((file) => file.path)).toEqual([]);
  });
});
