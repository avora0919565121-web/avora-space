import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// AVORA-93 · 92.11 (ADR-060): Avora pays for no translation. No paid translation API or LLM endpoint
// may appear in the app or in edge functions; every translation runs on the reader's own device.
const ROOTS = [join(__dirname, ".."), join(__dirname, "..", "..", "..", "supabase", "functions")];
const PAID = [
  "translate.googleapis",
  "translation.googleapis",
  "api.deepl",
  "api-free.deepl",
  "api.cognitive.microsofttranslator",
  "translate.amazonaws",
  "api.openai",
  "api.anthropic",
  "generativelanguage.googleapis",
];

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" || name === "node_modules" ? [] : files(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

describe("92.11 · no paid translation", () => {
  it("src and supabase/functions name no paid translation endpoint", () => {
    const hits = ROOTS.flatMap(files).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return PAID.filter((domain) => text.includes(domain)).map((domain) => `${file}: ${domain}`);
    });
    expect(hits).toEqual([]);
  });
});
