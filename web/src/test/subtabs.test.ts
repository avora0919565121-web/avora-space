import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : walk(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe("AVORA-101A · one SubTabs strip", () => {
  const files = walk(SRC);
  it("the old strips are gone (no SectionTabs, no TaskHubNav)", () => {
    const hits = files.filter((file) => /SectionTabs|TaskHubNav/.test(readFileSync(file, "utf8")));
    expect(hits).toEqual([]);
  });
  it("is 40 px, 13 px words, paper background, underline in the person's tone, never orange", () => {
    const source = readFileSync(join(SRC, "components/nav/SubTabs.tsx"), "utf8");
    expect(source).toContain("h-10");
    expect(source).toContain("text-[13px]");
    expect(source).toContain("bg-background");
    expect(source).toContain("bg-personal");
    expect(source).not.toMatch(/Sắp có/);
  });
  it("Kết nối, Nhiệm vụ, Két sắt and Cài đặt all use it", () => {
    for (const page of ["pages/Messages.tsx", "pages/Tasks.tsx", "components/nav/SectionNav.tsx"]) {
      expect(readFileSync(join(SRC, page), "utf8")).toContain("<SubTabs");
    }
  });
});
