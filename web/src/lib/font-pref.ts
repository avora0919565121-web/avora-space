import { useSyncExternalStore } from "react";

/**
 * AVORA-101B · KHỐI 2E (ADR-079) — one font for the whole app. `body` reads `--font-sans`; nothing
 * else names a family (code / mono and the reader's serif excepted). The choice lives on this
 * device (no new column — KHỐI 2E does not touch the database) and is painted before the first
 * frame by the script in index.html.
 */
export type FontId = "inter-tight" | "may" | "be-vietnam";

export const FONT_IDS: readonly FontId[] = ["inter-tight", "may", "be-vietnam"];
export const DEFAULT_FONT: FontId = "inter-tight";
export const FONT_STORAGE_KEY = "avora.font";

export const FONT_LABEL: Readonly<Record<FontId, string>> = {
  "inter-tight": "Inter Tight",
  may: "Chữ của máy",
  "be-vietnam": "Be Vietnam Pro",
};

export const FONT_HINT: Readonly<Record<FontId, string>> = {
  "inter-tight": "Mặc định · gọn, rõ",
  may: "SF trên iPhone, Roboto trên Android",
  "be-vietnam": "Vẽ cho tiếng Việt, dấu thoáng",
};

/** The `--font-sans` stack of each choice. Every stack ends on the system sans, never on a serif. */
export const FONT_STACK: Readonly<Record<FontId, string>> = {
  "inter-tight": '"Inter Tight", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  may: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  "be-vietnam": '"Be Vietnam Pro", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
};

/** Faces loaded only when chosen (Inter Tight is already linked in index.html). */
const FONT_SHEET: Partial<Record<FontId, string>> = {
  "be-vietnam": "https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@300;400;500;600;700&display=swap",
};

export function isFontId(value: unknown): value is FontId {
  return typeof value === "string" && (FONT_IDS as readonly string[]).includes(value);
}

function readSaved(): FontId {
  try {
    const raw = window.localStorage.getItem(FONT_STORAGE_KEY);
    return isFontId(raw) ? raw : DEFAULT_FONT;
  } catch {
    return DEFAULT_FONT;
  }
}

let current: FontId | null = null;
const listeners = new Set<() => void>();

/** Puts the stack on <html> and fetches the face if it is not linked yet. */
export function applyFont(font: FontId): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--font-sans", FONT_STACK[font]);
  root.dataset.font = font;
  const sheet = FONT_SHEET[font];
  if (sheet !== undefined && document.querySelector(`link[data-font-sheet="${font}"]`) === null) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = sheet;
    link.dataset.fontSheet = font;
    document.head.appendChild(link);
  }
}

export function currentFont(): FontId {
  if (current === null) current = typeof window === "undefined" ? DEFAULT_FONT : readSaved();
  return current;
}

export function setFont(font: FontId): void {
  current = font;
  try {
    if (font === DEFAULT_FONT) window.localStorage.removeItem(FONT_STORAGE_KEY);
    else window.localStorage.setItem(FONT_STORAGE_KEY, font);
  } catch {
    // Private mode: the choice holds until the page closes.
  }
  applyFont(font);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFont(): FontId {
  return useSyncExternalStore(subscribe, currentFont, () => DEFAULT_FONT);
}
