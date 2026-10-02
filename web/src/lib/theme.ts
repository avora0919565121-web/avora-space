/**
 * AVORA-74 (ADR-046) — Sắc màu (light / dark / device) and Tông màu (the personal accent).
 *
 * Two layers of colour: `--primary` is Avora's own terracotta and never changes (logo, the `+`
 * of every area, unread badges, what Avora itself says). `--personal*` follow the tone a person
 * picked and only colour *their* traces (own bubbles, the selected tab, my-task stripe, focus).
 * Meaning colours (red = delete, green = done / Có, yellow = ★) are fixed and have no tone.
 * Nothing here reads age or birth date: the tone is chosen, never inferred.
 */

export type ColorScheme = "light" | "dark" | "device";
export type ToneId = "avora" | "bien" | "ngoc" | "tim" | "than" | "device";
export type FixedTone = Exclude<ToneId, "device">;

/** HSL as Tailwind's design variables take it: `"212 40% 42%"`. */
export type Hsl = { h: number; s: number; l: number };

/** The four values a tone has on one canvas. */
export type ToneValues = { personal: Hsl; personalFg: Hsl; soft: Hsl; softFg: Hsl };
export type ToneSet = { light: ToneValues; dark: ToneValues };

export const COLOR_SCHEMES: readonly ColorScheme[] = ["light", "dark", "device"];
export const TONE_IDS: readonly ToneId[] = ["avora", "bien", "ngoc", "tim", "than", "device"];
export const DEFAULT_SCHEME: ColorScheme = "device";
export const DEFAULT_TONE: ToneId = "avora";

export const SCHEME_LABEL: Readonly<Record<ColorScheme, string>> = { light: "Sáng", dark: "Tối", device: "Theo thiết bị" };
export const TONE_LABEL: Readonly<Record<ToneId, string>> = { avora: "Avora", bien: "Biển", ngoc: "Ngọc", tim: "Tím", than: "Than", device: "Theo thiết bị" };

const hsl = (h: number, s: number, l: number): Hsl => ({ h, s, l });

/** Canvases, as in index.css. */
export const CANVAS = {
  light: { background: hsl(42, 36, 95), card: hsl(0, 0, 100), foreground: hsl(36, 10, 10) },
  dark: { background: hsl(30, 9, 9), card: hsl(30, 8, 13), foreground: hsl(40, 30, 92) },
} as const;

const LIGHT_ON = hsl(15, 100, 97);
const DARK_ON = hsl(30, 10, 8);

/**
 * The five fixed tones. Avora's accent is the brand hue made deep enough to carry text (the brand
 * mark itself stays `13 73% 56%`); the others are muted so they sit next to the terracotta `+`
 * and the paper without shouting. Every pair is checked ≥ 4.5:1 in theme.test.ts.
 */
export const TONES: Readonly<Record<FixedTone, ToneSet>> = {
  avora: {
    light: { personal: hsl(13, 70, 44), personalFg: LIGHT_ON, soft: hsl(16, 63, 92), softFg: hsl(13, 62, 36) },
    dark: { personal: hsl(13, 70, 62), personalFg: DARK_ON, soft: hsl(13, 30, 20), softFg: hsl(16, 70, 78) },
  },
  bien: {
    light: { personal: hsl(212, 40, 42), personalFg: LIGHT_ON, soft: hsl(212, 40, 93), softFg: hsl(212, 40, 32) },
    dark: { personal: hsl(212, 45, 66), personalFg: DARK_ON, soft: hsl(212, 25, 20), softFg: hsl(212, 50, 80) },
  },
  ngoc: {
    light: { personal: hsl(184, 46, 30), personalFg: LIGHT_ON, soft: hsl(184, 38, 91), softFg: hsl(184, 46, 24) },
    dark: { personal: hsl(184, 40, 52), personalFg: DARK_ON, soft: hsl(184, 25, 18), softFg: hsl(184, 40, 74) },
  },
  tim: {
    light: { personal: hsl(320, 28, 44), personalFg: LIGHT_ON, soft: hsl(320, 30, 93), softFg: hsl(320, 28, 34) },
    dark: { personal: hsl(320, 32, 68), personalFg: DARK_ON, soft: hsl(320, 20, 20), softFg: hsl(320, 35, 82) },
  },
  than: {
    light: { personal: hsl(30, 7, 38), personalFg: LIGHT_ON, soft: hsl(30, 10, 91), softFg: hsl(30, 8, 28) },
    dark: { personal: hsl(30, 8, 68), personalFg: DARK_ON, soft: hsl(30, 6, 20), softFg: hsl(30, 10, 80) },
  },
};

export function isColorScheme(value: unknown): value is ColorScheme {
  return typeof value === "string" && (COLOR_SCHEMES as readonly string[]).includes(value);
}
export function isToneId(value: unknown): value is ToneId {
  return typeof value === "string" && (TONE_IDS as readonly string[]).includes(value);
}

// ------------------------------------------------------------------ contrast (WCAG 2.x)
export type Rgb = { r: number; g: number; b: number };

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number): number => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0), g: f(8), b: f(4) };
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round(h * 60), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function luminance(color: Hsl): number {
  const { r, g, b } = hslToRgb(color);
  const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Hsl, b: Hsl): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Every text-on-colour pair a tone produces on one canvas — what theme.test.ts holds at AA. */
export function tonePairs(values: ToneValues, canvas: "light" | "dark"): { name: string; ratio: number }[] {
  const c = CANVAS[canvas];
  return [
    { name: "chữ trên nhấn", ratio: contrast(values.personalFg, values.personal) },
    { name: "chữ trên nền nhạt", ratio: contrast(values.softFg, values.soft) },
    { name: "nhấn trên nền", ratio: contrast(values.personal, c.background) },
    { name: "nhấn trên thẻ", ratio: contrast(values.personal, c.card) },
    { name: "mực trên nền nhạt", ratio: contrast(c.foreground, values.soft) },
  ];
}

export const AA = 4.5;
const TARGET = 4.6;

// ------------------------------------------------------------------ Theo thiết bị
export type DeviceTone = { ok: true; set: ToneSet } | { ok: false; reason: "unsupported" | "clash" };

/**
 * The device's accent, softened for paper and terracotta. Too close to a meaning colour
 * (red / yellow / green) or to Avora's own orange → refused, the caller falls back to Avora.
 */
export function softenDeviceAccent(rgb: Rgb): DeviceTone {
  const raw = rgbToHsl(rgb);
  const isGrey = raw.s < 10;
  const h = raw.h;
  if (!isGrey && (h >= 340 || h < 70 || (h >= 85 && h < 165))) return { ok: false, reason: "clash" };
  const s = isGrey ? Math.max(raw.s, 4) : Math.min(Math.max(raw.s, 18), 45);

  const fit = (start: number, step: number, ok: (l: number) => boolean): number => {
    let l = start;
    while (l > 5 && l < 95 && !ok(l)) l += step;
    return l;
  };
  const lightP = fit(50, -1, (l) => [LIGHT_ON, CANVAS.light.background, CANVAS.light.card].every((x) => contrast(hsl(h, s, l), x) >= TARGET));
  const lightSoft = hsl(h, Math.min(s, 40), 93);
  const lightSoftFg = fit(45, -1, (l) => contrast(hsl(h, s, l), lightSoft) >= TARGET);
  const darkP = fit(50, 1, (l) => [DARK_ON, CANVAS.dark.background, CANVAS.dark.card].every((x) => contrast(hsl(h, s, l), x) >= TARGET));
  const darkSoft = hsl(h, Math.min(s, 25), 20);
  const darkSoftFg = fit(60, 1, (l) => contrast(hsl(h, s, l), darkSoft) >= TARGET);
  return {
    ok: true,
    set: {
      light: { personal: hsl(h, s, lightP), personalFg: LIGHT_ON, soft: lightSoft, softFg: hsl(h, s, lightSoftFg) },
      dark: { personal: hsl(h, s, darkP), personalFg: DARK_ON, soft: darkSoft, softFg: hsl(h, s, darkSoftFg) },
    },
  };
}

/** Reads the system accent (`AccentColor`); null where the browser does not expose it. */
export function readDeviceAccent(): Rgb | null {
  if (typeof document === "undefined" || typeof CSS === "undefined" || !CSS.supports("color", "AccentColor")) return null;
  const probe = document.createElement("span");
  probe.style.color = "AccentColor";
  probe.style.display = "none";
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value);
  if (match === null) return null;
  return { r: Number(match[1]) / 255, g: Number(match[2]) / 255, b: Number(match[3]) / 255 };
}

export function deviceTone(): DeviceTone {
  const rgb = readDeviceAccent();
  return rgb === null ? { ok: false, reason: "unsupported" } : softenDeviceAccent(rgb);
}

// ------------------------------------------------------------------ applying it
export type Look = { scheme: ColorScheme; tone: ToneId };
export type ResolvedLook = { isDark: boolean; tone: FixedTone | "device"; set: ToneSet; deviceFallback: DeviceTone | null };

export const LOOK_CACHE_KEY = "avora.look";
const THEME_COLOR = { light: "#F6F3EC", dark: "#191715" } as const;
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function prefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

export function resolveLook(look: Look, readDevice: () => DeviceTone = deviceTone): ResolvedLook {
  const isDark = look.scheme === "dark" || (look.scheme === "device" && prefersDark());
  if (look.tone !== "device") return { isDark, tone: look.tone, set: TONES[look.tone], deviceFallback: null };
  const device = readDevice();
  return device.ok ? { isDark, tone: "device", set: device.set, deviceFallback: device } : { isDark, tone: "avora", set: TONES.avora, deviceFallback: device };
}

const css = (c: Hsl): string => `${c.h} ${c.s}% ${c.l}%`;

/** The CSS variables of one canvas, as the pre-paint script in index.html sets them. */
export function toneVars(values: ToneValues): Record<string, string> {
  return {
    "--personal": css(values.personal),
    "--personal-foreground": css(values.personalFg),
    "--personal-soft": css(values.soft),
    "--personal-soft-foreground": css(values.softFg),
    "--ring": css(values.personal),
  };
}

/** Puts a look on <html>: `.dark`, the personal variables and the browser's bar colour. */
export function paintLook(resolved: ResolvedLook): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved.isDark);
  root.style.colorScheme = resolved.isDark ? "dark" : "light";
  root.dataset.tone = resolved.tone;
  const vars = toneVars(resolved.isDark ? resolved.set.dark : resolved.set.light);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved.isDark ? THEME_COLOR.dark : THEME_COLOR.light);
}

/** Remembers the saved look on this device, so index.html paints it before React starts (74.6). */
export function cacheLook(look: Look, resolved: ResolvedLook): void {
  try {
    window.localStorage.setItem(LOOK_CACHE_KEY, JSON.stringify({ scheme: look.scheme, tone: look.tone, light: toneVars(resolved.set.light), dark: toneVars(resolved.set.dark) }));
  } catch {
    // No storage: the next start simply paints the default first.
  }
}

/** The look last saved on this device. */
export function cachedLook(): Look {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LOOK_CACHE_KEY) ?? "null") as { scheme?: unknown; tone?: unknown } | null;
    return { scheme: isColorScheme(raw?.scheme) ? raw.scheme : DEFAULT_SCHEME, tone: isToneId(raw?.tone) ? raw.tone : DEFAULT_TONE };
  } catch {
    return { scheme: DEFAULT_SCHEME, tone: DEFAULT_TONE };
  }
}

// ------------------------------------------------------------------ saved vs. previewed
export type LookSnapshot = { saved: Look; preview: ToneId | null; resolved: ResolvedLook };
type Listener = () => void;
const listeners = new Set<Listener>();
let saved: Look = { scheme: DEFAULT_SCHEME, tone: DEFAULT_TONE };
let preview: ToneId | null = null;
let snapshot: LookSnapshot = { saved, preview, resolved: { isDark: false, tone: "avora", set: TONES.avora, deviceFallback: null } };

function repaint(): void {
  const resolved = resolveLook({ scheme: saved.scheme, tone: preview ?? saved.tone });
  paintLook(resolved);
  // A preview is never cached: closing the app mid-preview opens on the saved tone.
  cacheLook(saved, preview === null ? resolved : resolveLook(saved));
  snapshot = { saved, preview, resolved };
  for (const listener of listeners) listener();
}

export function setSavedLook(look: Look): void {
  saved = look;
  repaint();
}
/** Tông màu step 2: the whole app changes in place, on this device only, until `Giữ` or `Quay lại`. */
export function setPreviewTone(tone: ToneId | null): void {
  preview = tone;
  repaint();
}
/** The device changed (light ↔ dark, or its accent): paint again with the same choice. */
export function refreshLook(): void {
  repaint();
}
export function currentLook(): LookSnapshot {
  return snapshot;
}
export function subscribeLook(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const DARK_MEDIA_QUERY = DARK_QUERY;
