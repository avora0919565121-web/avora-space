import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AA,
  CANVAS,
  COLOR_SCHEMES,
  contrast,
  hslToRgb,
  resolveLook,
  softenDeviceAccent,
  TONE_IDS,
  TONES,
  tonePairs,
  type DeviceTone,
  type Hsl,
} from "@/lib/theme";

const root = path.resolve(__dirname, "..");
const hsl = (h: number, s: number, l: number): Hsl => ({ h, s, l });

/** Reads an HSL triple of one variable out of a CSS block. */
function cssVar(block: string, name: string): Hsl {
  const m = new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)%\\s+(\\d+)%`).exec(block);
  if (m === null) throw new Error(`missing --${name}`);
  return hsl(Number(m[1]), Number(m[2]), Number(m[3]));
}
const CSS = readFileSync(path.join(root, "index.css"), "utf8");
const LIGHT_BLOCK = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf(".dark {"));
const DARK_BLOCK = CSS.slice(CSS.indexOf(".dark {"), CSS.indexOf("[data-button-style"));

describe("AVORA-74 · 74.4 / 74.7 — every tone × every scheme reaches WCAG AA", () => {
  const device: DeviceTone = softenDeviceAccent(hslToRgb(hsl(220, 90, 55)));
  for (const scheme of COLOR_SCHEMES) {
    for (const tone of TONE_IDS) {
      it(`${scheme} × ${tone}`, () => {
        // `device` scheme resolves to light or dark: both canvases are checked.
        const canvases = scheme === "light" ? (["light"] as const) : scheme === "dark" ? (["dark"] as const) : (["light", "dark"] as const);
        const resolved = resolveLook({ scheme: "light", tone }, () => device);
        for (const canvas of canvases) {
          for (const pair of tonePairs(resolved.set[canvas], canvas)) expect(pair.ratio, `${canvas} ${pair.name}`).toBeGreaterThanOrEqual(AA);
        }
      });
    }
  }

  it("the index.css defaults equal tone Avora (no flash between CSS and the script)", () => {
    expect(cssVar(LIGHT_BLOCK, "personal")).toEqual(TONES.avora.light.personal);
    expect(cssVar(DARK_BLOCK, "personal")).toEqual(TONES.avora.dark.personal);
    expect(cssVar(LIGHT_BLOCK, "personal-soft")).toEqual(TONES.avora.light.soft);
  });

  it("dark canvas: ink, muted ink and meaning colours stay readable", () => {
    const card = cssVar(DARK_BLOCK, "card");
    const bg = cssVar(DARK_BLOCK, "background");
    expect(bg).toEqual(CANVAS.dark.background);
    for (const name of ["foreground", "muted-foreground", "destructive", "online", "star", "money-in", "money-out"]) {
      expect(contrast(cssVar(DARK_BLOCK, name), card), name).toBeGreaterThanOrEqual(AA);
    }
    // Text on a red Xoá button and on the terracotta brand.
    expect(contrast(cssVar(DARK_BLOCK, "destructive-foreground"), cssVar(DARK_BLOCK, "destructive"))).toBeGreaterThanOrEqual(AA);
    expect(contrast(cssVar(DARK_BLOCK, "primary-foreground"), cssVar(DARK_BLOCK, "primary"))).toBeGreaterThanOrEqual(AA);
    // Dark is warm charcoal, not pure black.
    expect(bg.l).toBeGreaterThan(5);
    expect(bg.s).toBeGreaterThan(0);
  });

  it("light canvas: the red Xoá button text reads", () => {
    expect(contrast(cssVar(LIGHT_BLOCK, "destructive-foreground"), cssVar(LIGHT_BLOCK, "destructive"))).toBeGreaterThanOrEqual(AA);
  });
});

describe("AVORA-74 · B — the tones never borrow meaning, and the brand never moves", () => {
  it("no tone is red, green or yellow; none is Avora's orange except Avora", () => {
    for (const [id, set] of Object.entries(TONES)) {
      const h = set.light.personal.h;
      const isMeaning = set.light.personal.s >= 10 && (h >= 340 || h < 12 || (h >= 40 && h < 70) || (h >= 85 && h < 165));
      expect(isMeaning, id).toBe(false);
      if (id !== "avora" && set.light.personal.s >= 10) expect(h >= 12 && h < 40, id).toBe(false);
    }
  });

  it("the brand terracotta is the same in light and dark", () => {
    expect(cssVar(DARK_BLOCK, "primary")).toEqual(cssVar(LIGHT_BLOCK, "primary"));
    expect(cssVar(LIGHT_BLOCK, "primary")).toEqual(hsl(13, 73, 56));
  });

  it("Theo thiết bị: a red / yellow / green / orange accent is refused (→ Avora)", () => {
    for (const h of [0, 8, 25, 50, 120, 150, 350]) {
      expect(softenDeviceAccent(hslToRgb(hsl(h, 80, 50))).ok, `hue ${h}`).toBe(false);
    }
    const look = resolveLook({ scheme: "light", tone: "device" }, () => ({ ok: false, reason: "clash" }));
    expect(look.tone).toBe("avora");
    expect(look.set).toBe(TONES.avora);
  });

  it("74.5 — a browser that cannot tell the device colour gives Avora", () => {
    const look = resolveLook({ scheme: "dark", tone: "device" }, () => ({ ok: false, reason: "unsupported" }));
    expect(look.tone).toBe("avora");
    expect(look.deviceFallback).toEqual({ ok: false, reason: "unsupported" });
  });

  it("Theo thiết bị: any accepted hue, however loud, is softened until AA holds", () => {
    for (let h = 0; h < 360; h += 5) {
      for (const [s, l] of [[100, 50], [90, 80], [70, 20], [5, 50]]) {
        const out = softenDeviceAccent(hslToRgb(hsl(h, s, l)));
        if (!out.ok) continue;
        expect(out.set.light.personal.s).toBeLessThanOrEqual(45);
        for (const canvas of ["light", "dark"] as const) {
          for (const pair of tonePairs(out.set[canvas], canvas)) expect(pair.ratio, `h${h} s${s} l${l} ${canvas} ${pair.name}`).toBeGreaterThanOrEqual(AA);
        }
      }
    }
  });
});

describe("AVORA-74 · Luật 4 — no age", () => {
  it("theme code never reads birth date or age", () => {
    const files = ["lib/theme.ts", "components/AppearanceCard.tsx", "components/LookSync.tsx"].map((f) => readFileSync(path.join(root, f), "utf8"));
    for (const text of files) expect(/birth|ngay_sinh|ngày sinh|tuổi|\bage\b|dob/i.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))).toBe(false);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" || name === "integrations" ? [] : walk(full);
    return /\.tsx$/.test(name) ? [full] : [];
  });
}

describe("AVORA-74 · 74.9 — no hard-coded white / black", () => {
  /** Overlays over photos or a camera feed, and the QR code (must be black on white to scan). */
  const ALLOWED: readonly [string, RegExp][] = [
    ["components/contacts/ConnectQrDialog.tsx", /bg-white p-3|border-white\/80/],
    ["components/PersonCard.tsx", /bg-black\/85|bg-white\/10 text-white/],
    ["pages/Bookshelf.tsx", /text-white/],
    ["components/ui/sheet.tsx", /bg-black\/80/],
    ["components/ui/alert-dialog.tsx", /bg-black\/80/],
    ["components/ui/drawer.tsx", /bg-black\/80/],
    ["components/ui/floating-panel.tsx", /bg-black\/20/],
    ["components/tasks/CalendarPeekSheet.tsx", /bg-black\/15/],
    ["components/projects/TablePeekSheet.tsx", /bg-black\/40/],
    ["components/chat/DayLineList.tsx", /md:bg-black\/30/],
  ];
  it("only photo / camera / QR overlays keep them", () => {
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const rel = path.relative(root, file);
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (!/(?<![\w-])(bg-white|text-black|border-white|bg-black|text-white)(?![\w-])/.test(line)) return;
        if (ALLOWED.some(([f, re]) => f === rel && re.test(line))) return;
        offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("AVORA-74 · 74.3b — the two zones", () => {
  const read = (f: string): string => readFileSync(path.join(root, f), "utf8");
  it("Avora zone keeps the brand: the `+`, unread badges, the wordmark", () => {
    expect(read("components/PlusMenuButton.tsx")).toContain("icon-btn icon-btn-primary no-callout");
    expect(read("components/PlusMenuButton.tsx")).not.toContain("personal");
    expect(read("components/nav/ToolBelt.tsx")).toMatch(/border-card bg-primary px-1/);
    expect(read("components/AppSidebar.tsx")).toMatch(/rounded-full bg-primary px-1/);
    expect(read("pages/Auth.tsx")).not.toContain("personal");
  });
  it("your zone follows the tone: own bubble, selected tab, my-task stripe, Gửi, dialog buttons", () => {
    expect(read("pages/Messages.tsx")).toContain('"rounded-br-[4px] bg-personal text-personal-foreground"');
    expect(read("components/SectionTabs.tsx")).toContain("bg-personal transition-opacity");
    expect(read("components/tasks/TaskOwner.tsx")).toContain("border-l-personal");
    expect(read("components/chat/MessageComposer.tsx")).toContain("icon-btn-personal");
    expect(read("components/ConfirmHost.tsx")).toContain("bg-personal text-personal-foreground");
  });
});
