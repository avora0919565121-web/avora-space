import { supabase } from "@/integrations/supabase/client";
import type { BookSource } from "@/lib/book-catalog";
import { deviceLabelOf } from "@/lib/device";
import { hubFail } from "@/lib/think-hub";

/**
 * AVORA-77 · D3 / D4 — the text of a public-domain book and where each person is in it.
 *
 * The text comes from the `book-text` Edge Function and is kept on this device (IndexedDB) so a
 * book once opened reads without a network (ADR-025). Every IndexedDB call is wrapped: a browser
 * that refuses storage (private mode) simply reads online.
 */
export type BookBlock = { k: "h"; t: string; l: number } | { k: "p"; t: string } | { k: "pre"; t: string } | { k: "img"; src: string; alt: string };
export type BookChapter = { title: string; blocks: BookBlock[] | null };
export type BookText = {
  source: BookSource;
  sourceId: string;
  title: string;
  authors: string | null;
  language: string;
  sourceUrl: string;
  epubUrl: string | null;
  license: string[];
  chapters: BookChapter[];
  fetchedAt: string;
};

export type ReadingState = { recordId: string; locator: string; percent: number; deviceLabel: string | null; updatedAt: string; pinnedAt?: string | null };

// ------------------------------------------------------------------ IndexedDB (small, wrapped)

const DB_NAME = "avora-books";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("texts")) db.createObjectStore("texts");
        if (!db.objectStoreNames.contains("positions")) db.createObjectStore("positions");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const db = await openDb();
  if (db === null) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(store, "readonly").objectStore(store).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (db === null) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  if (db === null) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function textKey(source: BookSource, sourceId: string): string {
  return `${source}:${sourceId}`;
}

// ------------------------------------------------------------------ book text

export class BookTextError extends Error {
  constructor(public readonly code: "offline" | "rate_limited" | "not_in_catalog" | "source_failed" | "auth" | "unknown", message: string) {
    super(message);
  }
}

const MESSAGES: Record<BookTextError["code"], string> = {
  offline: "Cần mạng để mở lần đầu.",
  rate_limited: "Bạn đã mở nhiều sách trong một giờ. Thử lại sau ít phút.",
  not_in_catalog: "Cuốn này không có trong Thư viện mở.",
  source_failed: "Nguồn sách đang không trả lời. Thử lại sau.",
  auth: "Phiên đăng nhập đã hết, hãy đăng nhập lại.",
  unknown: "Chưa mở được sách.",
};

async function callBookText(body: Record<string, unknown>): Promise<unknown> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (token === undefined) throw new BookTextError("auth", MESSAGES.auth);
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.EXPO_PUBLIC_SUPABASE_URL as string}/functions/v1/book-text`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new BookTextError("offline", MESSAGES.offline);
  }
  if (response.ok) return await response.json();
  const code = response.status === 429 ? "rate_limited" : response.status === 404 ? "not_in_catalog" : response.status === 502 ? "source_failed" : response.status === 401 ? "auth" : "unknown";
  throw new BookTextError(code, MESSAGES[code]);
}

/** The whole book (chapters of a long Wikisource work may arrive one at a time — `loadPart`). */
export async function loadBookText(source: BookSource, sourceId: string): Promise<BookText> {
  const key = textKey(source, sourceId);
  const kept = await idbGet<BookText>("texts", key);
  if (kept !== null) return kept;
  const book = (await callBookText({ source, source_id: sourceId })) as BookText;
  await idbPut("texts", key, book);
  return book;
}

/** One chapter not yet fetched (a book of the Bible, a part of Lục Vân Tiên). Kept on the device too. */
export async function loadPart(book: BookText, part: number): Promise<BookText> {
  if (book.chapters[part]?.blocks != null) return book;
  const answer = (await callBookText({ source: book.source, source_id: book.sourceId, part })) as { blocks: BookBlock[] };
  const next: BookText = { ...book, chapters: book.chapters.map((chapter, index) => (index === part ? { ...chapter, blocks: answer.blocks } : chapter)) };
  await idbPut("texts", textKey(book.source, book.sourceId), next);
  return next;
}

// ------------------------------------------------------------------ positions

/** `c4:p12` → chapter 4, paragraph 12. */
export function parseLocator(locator: string | null | undefined): { chapter: number; block: number } {
  const match = (locator ?? "").match(/^c(\d+):p(\d+)$/);
  return match === null ? { chapter: 0, block: 0 } : { chapter: Number(match[1]), block: Number(match[2]) };
}

export function makeLocator(chapter: number, block: number): string {
  return `c${chapter}:p${block}`;
}

/** What the shelf's `Đang ở` column says: `Chương 4 · 38%` — readable, and `readingProgress()` finds the %. */
export function positionLabel(chapter: number, percent: number): string {
  return `Chương ${chapter + 1} · ${Math.round(percent)}%`;
}

/** How far into the book: chapters before + the share of this one. */
export function percentOf(chapterCount: number, chapter: number, withinChapter: number): number {
  if (chapterCount <= 0) return 0;
  const value = ((chapter + Math.min(1, Math.max(0, withinChapter))) / chapterCount) * 100;
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

export function thisDeviceLabel(): string {
  try {
    return deviceLabelOf(navigator.userAgent, navigator.maxTouchPoints ?? 0).label;
  } catch {
    return "Máy này";
  }
}

export const readingKeys = { state: (recordId: string) => ["book-reading-state", recordId] as const };

export async function fetchReadingState(recordId: string): Promise<ReadingState | null> {
  const { data, error } = await supabase
    .from("book_reading_state")
    .select("record_id, locator, percent, device_label, updated_at")
    .eq("record_id", recordId)
    .maybeSingle();
  if (error) throw hubFail(error.code, error.message);
  if (data === null) return null;
  return { recordId: data.record_id, locator: data.locator, percent: Number(data.percent), deviceLabel: data.device_label, updatedAt: data.updated_at };
}

/** Every place I have in every book — for `Đọc tiếp` (the book opened most recently). */
export async function fetchAllReadingStates(): Promise<ReadingState[]> {
  const { data, error } = await supabase.from("book_reading_state").select("record_id, locator, percent, device_label, updated_at, pinned_at").order("updated_at", { ascending: false }).limit(200);
  if (error) throw hubFail(error.code, error.message);
  return (data ?? []).map((row) => ({ recordId: row.record_id, locator: row.locator, percent: Number(row.percent), deviceLabel: row.device_label, updatedAt: row.updated_at, pinnedAt: row.pinned_at }));
}

type PendingPosition = { locator: string; percent: number; deviceLabel: string; at: string };

/** The place on this device, written first; the server copy follows when there is a network. */
export async function localPosition(recordId: string): Promise<PendingPosition | null> {
  return await idbGet<PendingPosition>("positions", recordId);
}

/**
 * Saves a place. Kept on the device at once; sent to the server now, or later by
 * `flushPositions()` when the network is back. The server keeps the newest (its `p_at` check).
 */
export async function savePosition(recordId: string, locator: string, percent: number): Promise<"sent" | "kept"> {
  const pending: PendingPosition = { locator, percent, deviceLabel: thisDeviceLabel(), at: new Date().toISOString() };
  await idbPut("positions", recordId, { ...pending, unsent: true });
  try {
    const { error } = await supabase.rpc("save_reading_state", {
      p_record_id: recordId,
      p_locator: locator,
      p_percent: percent,
      p_device_label: pending.deviceLabel,
      p_at: pending.at,
    });
    if (error) throw error;
    await idbPut("positions", recordId, pending);
    return "sent";
  } catch {
    return "kept";
  }
}

/** Sends every place recorded offline. Called when the reader opens and when the network returns. */
export async function flushPositions(): Promise<number> {
  const db = await openDb();
  if (db === null) return 0;
  const entries: [string, PendingPosition & { unsent?: boolean }][] = await new Promise((resolve) => {
    try {
      const out: [string, PendingPosition & { unsent?: boolean }][] = [];
      const request = db.transaction("positions", "readonly").objectStore("positions").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor === null) return resolve(out);
        out.push([String(cursor.key), cursor.value as PendingPosition & { unsent?: boolean }]);
        cursor.continue();
      };
      request.onerror = () => resolve(out);
    } catch {
      resolve([]);
    }
  });
  let sent = 0;
  for (const [recordId, value] of entries) {
    if (value.unsent !== true) continue;
    const { error } = await supabase.rpc("save_reading_state", {
      p_record_id: recordId,
      p_locator: value.locator,
      p_percent: value.percent,
      p_device_label: value.deviceLabel,
      p_at: value.at,
    });
    if (error === null) {
      sent += 1;
      await idbPut("positions", recordId, { locator: value.locator, percent: value.percent, deviceLabel: value.deviceLabel, at: value.at });
    } else if (error.message.includes("avora_book_not_yours")) {
      await idbDelete("positions", recordId);
    }
  }
  return sent;
}

/**
 * D4: another device read further. Offer it — never jump by itself. Only when that place is
 * newer than mine and ahead by at least one percent.
 */
export function furtherElsewhere(server: ReadingState | null, mine: { percent: number; at: string | null }, myLabel: string): ReadingState | null {
  if (server === null) return null;
  if (server.deviceLabel !== null && server.deviceLabel === myLabel) return null;
  if (mine.at !== null && server.updatedAt <= mine.at) return null;
  return server.percent >= mine.percent + 1 ? server : null;
}

/** D3 · reading size, three steps, kept on this device. */
export const TEXT_SIZES: readonly { id: "s" | "m" | "l"; px: number; label: string }[] = [
  { id: "s", px: 15, label: "Nhỏ" },
  { id: "m", px: 17, label: "Vừa" },
  { id: "l", px: 20, label: "Lớn" },
];
const SIZE_KEY = "avora.reader.size";

export function readTextSize(): "s" | "m" | "l" {
  try {
    const value = window.localStorage.getItem(SIZE_KEY);
    return value === "s" || value === "l" ? value : "m";
  } catch {
    return "m";
  }
}

export function rememberTextSize(size: "s" | "m" | "l"): void {
  try {
    window.localStorage.setItem(SIZE_KEY, size);
  } catch {
    // The middle size next time.
  }
}

/** Longest excerpt carried into a note (D3). */
export const EXCERPT_LIMIT = 2000;

export function clipExcerpt(text: string): string {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  return clean.length <= EXCERPT_LIMIT ? clean : `${clean.slice(0, EXCERPT_LIMIT - 1)}…`;
}

// ------------------------------------------------------------------ AVORA-81 · C6 · pin + on this device

export class PinFullError extends Error {
  constructor() {
    super("Đã ghim 3 cuốn");
  }
}

/** Pins a book to read first (at most 3 — the server answers `avora_pin_full`). */
export async function setBookPin(recordId: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_book_pin", { p_record_id: recordId, p_pinned: pinned });
  if (error) {
    if (error.message.includes("avora_pin_full")) throw new PinFullError();
    throw hubFail(error.code, error.message);
  }
}

/** Whole on this device: the text is kept and every chapter has its blocks. */
export async function isOnDevice(source: BookSource, sourceId: string): Promise<boolean> {
  const kept = await idbGet<BookText>("texts", textKey(source, sourceId));
  return kept !== null && kept.chapters.every((chapter) => chapter.blocks !== null);
}

/** `Tải về`: every chapter, cleaned, into IndexedDB (only the device; nothing on the server). */
export async function downloadBook(source: BookSource, sourceId: string, onProgress?: (done: number, total: number) => void): Promise<BookText> {
  let book = await loadBookText(source, sourceId);
  const total = book.chapters.length;
  for (let index = 0; index < total; index += 1) {
    if (book.chapters[index]?.blocks == null) book = await loadPart(book, index);
    onProgress?.(index + 1, total);
  }
  return book;
}

export async function removeFromDevice(source: BookSource, sourceId: string): Promise<void> {
  await idbDelete("texts", textKey(source, sourceId));
}

/** `n cuốn trên máy · x MB`. */
export async function booksOnDevice(): Promise<{ key: string; title: string; bytes: number; complete: boolean }[]> {
  const db = await openDb();
  if (db === null) return [];
  return await new Promise((resolve) => {
    const out: { key: string; title: string; bytes: number; complete: boolean }[] = [];
    try {
      const request = db.transaction("texts", "readonly").objectStore("texts").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor === null) return resolve(out);
        const value = cursor.value as BookText;
        out.push({ key: String(cursor.key), title: value.title, bytes: new Blob([JSON.stringify(value)]).size, complete: value.chapters.every((chapter) => chapter.blocks !== null) });
        cursor.continue();
      };
      request.onerror = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
}
