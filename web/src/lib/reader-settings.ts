/**
 * AVORA-81 · PHẦN 2 · C3 (ADR-051) — how a book is set: 7 sizes, 4 faces, 4 papers, margins, line
 * height, justification, page turn or scroll, the paper-curl effect. One JSON `reader` in
 * `profiles.prefs`, applied to every book; a change shows at once (no `Lưu`).
 */
export const READER_SIZES: readonly number[] = [14, 16, 18, 20, 23, 26, 30];

export type ReaderFont = "literata" | "source-serif" | "inter-tight" | "atkinson";
export type ReaderTheme = "trang" | "kem" | "xanh" | "dem";
export type ReaderMargin = "hep" | "vua" | "rong";
export type ReaderLeading = "gon" | "vua" | "thoang";
export type ReaderTurn = "lat" | "cuon";

export type ReaderSettings = {
  /** Index into READER_SIZES (0–6). */
  size: number;
  font: ReaderFont;
  theme: ReaderTheme;
  margin: ReaderMargin;
  leading: ReaderLeading;
  justify: boolean;
  turn: ReaderTurn;
  curl: boolean;
};

export const READER_FONTS: readonly { id: ReaderFont; label: string; family: string; google: string | null }[] = [
  { id: "literata", label: "Literata", family: "'Literata', Georgia, serif", google: "Literata:ital,opsz,wght@0,7..72,400..700;1,7..72,400" },
  { id: "source-serif", label: "Source Serif 4", family: "'Source Serif 4', Georgia, serif", google: "Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400" },
  { id: "inter-tight", label: "Inter Tight", family: "'Inter Tight', system-ui, sans-serif", google: null },
  { id: "atkinson", label: "Atkinson Hyperlegible (dễ đọc)", family: "'Atkinson Hyperlegible', system-ui, sans-serif", google: "Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400" },
];

/** Every paper reaches ≥ 7:1 for body text (checked in avora-79.test.ts). */
export const READER_THEMES: readonly { id: ReaderTheme; label: string; paper: string; ink: string; muted: string }[] = [
  { id: "trang", label: "Trắng", paper: "#FFFFFF", ink: "#1A1A1A", muted: "#5E5E5E" },
  { id: "kem", label: "Kem", paper: "#F6EFDF", ink: "#2A2117", muted: "#6B5D4B" },
  { id: "xanh", label: "Xanh dịu", paper: "#E4EDE3", ink: "#1C2A1E", muted: "#4F5F50" },
  { id: "dem", label: "Đêm", paper: "#14161A", ink: "#E6E1D6", muted: "#9A958B" },
];

export const READER_MARGINS: Readonly<Record<ReaderMargin, { label: string; px: number }>> = {
  hep: { label: "Hẹp", px: 16 },
  vua: { label: "Vừa", px: 28 },
  rong: { label: "Rộng", px: 48 },
};

export const READER_LEADING: Readonly<Record<ReaderLeading, { label: string; value: number }>> = {
  gon: { label: "Gọn", value: 1.45 },
  vua: { label: "Vừa", value: 1.65 },
  thoang: { label: "Thoáng", value: 1.85 },
};

/** Phone: step 4 (20 px); computer: step 3 (18 px). */
export function defaultReaderSettings(isPhone: boolean): ReaderSettings {
  return { size: isPhone ? 3 : 2, font: "literata", theme: "kem", margin: "vua", leading: "vua", justify: true, turn: "lat", curl: false };
}

/** Reads `prefs.reader`, migrating 77's `s/m/l` (→ steps 2/3/4) from this device. */
export function readerSettingsFrom(prefs: unknown, isPhone: boolean, legacy: string | null = null): ReaderSettings {
  const base = defaultReaderSettings(isPhone);
  if (legacy === "s" || legacy === "m" || legacy === "l") base.size = legacy === "s" ? 1 : legacy === "m" ? 2 : 3;
  const raw = (prefs as { reader?: Partial<ReaderSettings> } | null)?.reader;
  if (raw === undefined || raw === null || typeof raw !== "object") return base;
  return {
    size: typeof raw.size === "number" && raw.size >= 0 && raw.size < READER_SIZES.length ? Math.round(raw.size) : base.size,
    font: READER_FONTS.some((f) => f.id === raw.font) ? (raw.font as ReaderFont) : base.font,
    theme: READER_THEMES.some((t) => t.id === raw.theme) ? (raw.theme as ReaderTheme) : base.theme,
    margin: raw.margin === "hep" || raw.margin === "vua" || raw.margin === "rong" ? raw.margin : base.margin,
    leading: raw.leading === "gon" || raw.leading === "vua" || raw.leading === "thoang" ? raw.leading : base.leading,
    justify: typeof raw.justify === "boolean" ? raw.justify : base.justify,
    turn: raw.turn === "lat" || raw.turn === "cuon" ? raw.turn : base.turn,
    curl: typeof raw.curl === "boolean" ? raw.curl : base.curl,
  };
}

/** Loads a Google font only when it is chosen (C3). */
export function ensureReaderFont(font: ReaderFont): void {
  const def = READER_FONTS.find((f) => f.id === font);
  if (def?.google == null || typeof document === "undefined") return;
  const id = `reader-font-${font}`;
  if (document.getElementById(id) !== null) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${def.google}&display=swap`;
  document.head.appendChild(link);
}

/** The paper-curl effect never plays when the system asks for less motion (ADR-021). */
export function curlAllowed(settings: Pick<ReaderSettings, "curl">, reducedMotion: boolean): boolean {
  return settings.curl && !reducedMotion;
}

/** Minutes left in the chapter from this device's own reading speed; null until enough pages were timed. */
export function minutesLeft(pageMs: readonly number[], pagesLeft: number): number | null {
  const usable = pageMs.filter((ms) => ms > 4000 && ms < 300_000);
  if (usable.length < 3) return null;
  const sorted = [...usable].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return Math.max(1, Math.round((median * pagesLeft) / 60_000));
}

/** Which third of the screen a tap fell in (C1): left = back, middle = tools, right = forward. */
export function tapZone(x: number, width: number): "back" | "tools" | "forward" {
  if (x < width / 3) return "back";
  if (x > (width * 2) / 3) return "forward";
  return "tools";
}

// ------------------------------------------------------------------ C4 · on-device translation

type TranslatorLike = { translate: (text: string) => Promise<string> };
type TranslatorApi = {
  availability: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<"unavailable" | "downloadable" | "downloading" | "available">;
  create: (options: { sourceLanguage: string; targetLanguage: string; monitor?: (m: EventTarget) => void }) => Promise<TranslatorLike>;
};

/** Chrome ≥ 138's on-device Translator, or null (phones, Safari, Firefox). Nothing ever leaves the device. */
export function translatorApi(): TranslatorApi | null {
  const api = (globalThis as { Translator?: TranslatorApi }).Translator;
  return api !== undefined && typeof api.create === "function" ? api : null;
}

/** One-step help for browsers without the on-device API (C4 ②). */
export function translateHelp(userAgent: string, standalone: boolean): string {
  if (standalone) return "Mở trong trình duyệt để dịch";
  if (/iPhone|iPad|iPod/.test(userAgent)) return "Safari: chạm aA ở thanh địa chỉ › Dịch sang tiếng Việt.";
  if (/Android/.test(userAgent) && /Chrome/.test(userAgent)) return "Chrome: chạm ⋮ › Dịch… › Tiếng Việt.";
  if (/Firefox/.test(userAgent)) return "Firefox: chạm biểu tượng dịch trên thanh địa chỉ.";
  return "Chuột phải trên trang › Dịch sang tiếng Việt.";
}

const TRANSLATION_DB = "avora-book-translations";
const MAX_CHAPTERS = 20;

function openTranslations(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(TRANSLATION_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("chapters");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Translated chapters live only on this device, the 20 most recent (oldest dropped). Never sent anywhere. */
export async function keptTranslation(key: string): Promise<string[] | null> {
  const db = await openTranslations();
  if (db === null) return null;
  return await new Promise((resolve) => {
    const request = db.transaction("chapters", "readonly").objectStore("chapters").get(key);
    request.onsuccess = () => resolve((request.result as { blocks: string[] } | undefined)?.blocks ?? null);
    request.onerror = () => resolve(null);
  });
}

export async function keepTranslation(key: string, blocks: string[]): Promise<void> {
  const db = await openTranslations();
  if (db === null) return;
  const store = (mode: IDBTransactionMode) => db.transaction("chapters", mode).objectStore("chapters");
  await new Promise<void>((resolve) => {
    const request = store("readwrite").put({ blocks, at: Date.now() }, key);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
  const all: { key: IDBValidKey; at: number }[] = await new Promise((resolve) => {
    const out: { key: IDBValidKey; at: number }[] = [];
    const cursor = store("readonly").openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c === null) return resolve(out);
      out.push({ key: c.key, at: (c.value as { at: number }).at });
      c.continue();
    };
    cursor.onerror = () => resolve(out);
  });
  if (all.length <= MAX_CHAPTERS) return;
  const old = all.sort((a, b) => a.at - b.at).slice(0, all.length - MAX_CHAPTERS);
  const tx = store("readwrite");
  for (const item of old) tx.delete(item.key);
}

// ------------------------------------------------------------------ C7 · a title Avora has no Vietnamese for

const titleMemory = new Map<string, string>();

/**
 * Translates a book title on this device (Chrome's Translator only). Kept in memory for the session;
 * never written to the server or the database. Null where the device cannot translate.
 */
export async function translateTitleOnDevice(title: string, language: string): Promise<string | null> {
  if (language === "vi") return null;
  const key = `${language}:${title}`;
  const known = titleMemory.get(key);
  if (known !== undefined) return known;
  const api = translatorApi();
  if (api === null) return null;
  try {
    if ((await api.availability({ sourceLanguage: language, targetLanguage: "vi" })) !== "available") return null;
    const translator = await api.create({ sourceLanguage: language, targetLanguage: "vi" });
    const out = (await translator.translate(title)).trim();
    if (out === "" || out === title) return null;
    titleMemory.set(key, out);
    return out;
  } catch {
    return null;
  }
}
