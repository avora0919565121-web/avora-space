import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { sessionGraphs } from "./src/test/reliability/session-graphs";

/**
 * 112-A · 6 (flaky root cause): Vite pre-bundles dependencies once and REUSES that cache on the next
 * run without rescanning. A run of a few files leaves a cache that lacks the dependencies only other
 * files use; the next full run then discovers one mid-way (AVORA-115: `@radix-ui/react-slider`),
 * re-optimises, reloads, and a test ends up holding two copies of React. Every package the app or
 * the tests import is listed here, read from the source itself, so the set never depends on which
 * files happened to run before and a new dependency cannot bring the flake back.
 */
function importedPackages(root: string): string[] {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "__screenshots__" && name !== "fixtures") walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      const text = readFileSync(full, "utf8");
      for (const match of text.matchAll(/(?:^|\n)\s*import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s+["']([^"']+)["']/g)) {
        const spec = match[1] ?? match[2] ?? match[3];
        if (spec === undefined || spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("/") || spec.startsWith("node:")) continue;
        if (spec === "vitest" || spec.startsWith("vitest/") || spec.startsWith("@vitest/")) continue;
        found.add(spec);
      }
    }
  };
  walk(root);
  return [...found].sort();
}

export default defineConfig({
  plugins: [react(), sessionGraphs()],
  test: {
    globals: true,
    include: ["src/**/*.browser.{test,spec}.{ts,tsx}"],
    setupFiles: ["./src/test/browser-setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
  // 112-A: measurements are written to ../docs/reliability (recordMeasure), so the test server may reach it.
  server: { fs: { allow: [path.resolve(__dirname), path.resolve(__dirname, "../docs/reliability")] } },
  optimizeDeps: {
    include: importedPackages(path.resolve(__dirname, "./src")),
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  // The same env contract the app is built with. Without it, any component that reaches the
  // Supabase client cannot even be imported here, which would leave whole screens untestable.
  envPrefix: ["VITE_", "EXPO_PUBLIC_"],
});
