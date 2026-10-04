import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { logError } from "@/lib/log";
import { normalizeSearch } from "@/lib/normalize-search";

/**
 * Ghi chép (AVORA-44 · B) — what a person writes to read again. Private to its owner, folders one
 * level deep, text kept as leveled blocks (never HTML) so numbering stays right after any edit.
 * No path brings a message in here (quyết định 2): no source column, no link back.
 */

// ------------------------------------------------------------------ blocks

/** 0 `I.` · 1 `1.` · 2 `A.` · 3 `a.` · 4 `+` · 5 `-`; null is a plain paragraph. */
export type BlockLevel = 0 | 1 | 2 | 3 | 4 | 5;
export const MAX_LEVEL: BlockLevel = 5;

export type NoteBlock = {
  id: string;
  level: BlockLevel | null;
  text: string;
  /** Attachments whose small icon sits in this block (the file itself lives in the strip). */
  attachmentRefs?: string[];
  collapsed?: boolean;
};

export function newBlockId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
}

export function emptyBlock(level: BlockLevel | null = null): NoteBlock {
  return { id: newBlockId(), level, text: "" };
}

function toRoman(value: number): string {
  const table: readonly [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let rest = value;
  let out = "";
  for (const [n, s] of table) while (rest >= n) { out += s; rest -= n; }
  return out;
}

function toLetters(value: number, upper: boolean): string {
  let rest = value;
  let out = "";
  while (rest > 0) {
    const r = (rest - 1) % 26;
    out = String.fromCharCode((upper ? 65 : 97) + r) + out;
    rest = Math.floor((rest - 1) / 26);
  }
  return out;
}

/**
 * The marker each block shows, worked out from its place — never stored, so inserting,
 * deleting or indenting a line renumbers everything after it. A deeper level restarts under
 * each new parent; a plain paragraph ends the list.
 */
export function blockLabels(blocks: readonly Pick<NoteBlock, "level">[]): (string | null)[] {
  const counters = [0, 0, 0, 0, 0, 0];
  return blocks.map((block) => {
    if (block.level === null) {
      counters.fill(0);
      return null;
    }
    const level = block.level;
    for (let deeper = level + 1; deeper <= MAX_LEVEL; deeper += 1) counters[deeper] = 0;
    counters[level] += 1;
    const n = counters[level];
    if (level === 0) return `${toRoman(n)}.`;
    if (level === 1) return `${n}.`;
    if (level === 2) return `${toLetters(n, true)}.`;
    if (level === 3) return `${toLetters(n, false)}.`;
    if (level === 4) return "+";
    return "-";
  });
}

/** A marker typed at the start of a line, and the level it asks for. */
export function readTypedMarker(text: string): { level: BlockLevel; rest: string } | null {
  const patterns: readonly [RegExp, BlockLevel][] = [
    [/^(?:[IVXLC]+)\.\s+/, 0],
    [/^\d{1,3}[.)]\s+/, 1],
    [/^[A-Z]\.\s+/, 2],
    [/^[a-z]\.\s+/, 3],
    [/^\+\s+/, 4],
    [/^[-*•]\s+/, 5],
  ];
  for (const [pattern, level] of patterns) {
    const match = pattern.exec(text);
    if (match) return { level, rest: text.slice(match[0].length) };
  }
  return null;
}

/** Typing into a block: a plain line that now starts with a marker becomes that level. */
export function applyTyping(block: NoteBlock, text: string): NoteBlock {
  if (block.level === null) {
    const marker = readTypedMarker(text);
    if (marker !== null) return { ...block, level: marker.level, text: marker.rest };
  }
  return { ...block, text };
}

/**
 * Enter at `caret` in block `index`. On a list line with words: a new line at the same level,
 * the words after the caret carried down. On an empty list line: it steps one level out (from
 * `I.` it becomes a plain line). Returns the new blocks and which block gets the caret.
 */
export function pressEnter(
  blocks: readonly NoteBlock[],
  index: number,
  caret: number,
): { blocks: NoteBlock[]; focusIndex: number; focusCaret: number } {
  const current = blocks[index];
  const next = [...blocks];
  if (current.level !== null && current.text.trim() === "") {
    next[index] = { ...current, level: current.level === 0 ? null : ((current.level - 1) as BlockLevel) };
    return { blocks: next, focusIndex: index, focusCaret: 0 };
  }
  const before = current.text.slice(0, caret);
  const after = current.text.slice(caret);
  next[index] = { ...current, text: before };
  next.splice(index + 1, 0, { id: newBlockId(), level: current.level, text: after });
  return { blocks: next, focusIndex: index + 1, focusCaret: 0 };
}

/** Tab / → : one level deeper (a plain line becomes `I.`). Shift+Tab / ← : one level out. */
export function indentBlock(block: NoteBlock, direction: 1 | -1): NoteBlock {
  if (direction === 1) {
    if (block.level === null) return { ...block, level: 0 };
    return { ...block, level: Math.min(MAX_LEVEL, block.level + 1) as BlockLevel };
  }
  if (block.level === null) return block;
  if (block.level === 0) return { ...block, level: null };
  return { ...block, level: (block.level - 1) as BlockLevel };
}

/** Backspace at the very start: a list line loses its marker; a plain line joins the one above. */
export function pressBackspaceAtStart(
  blocks: readonly NoteBlock[],
  index: number,
): { blocks: NoteBlock[]; focusIndex: number; focusCaret: number } | null {
  const current = blocks[index];
  if (current.level !== null) {
    const next = [...blocks];
    next[index] = { ...current, level: null };
    return { blocks: next, focusIndex: index, focusCaret: 0 };
  }
  if (index === 0) return null;
  const previous = blocks[index - 1];
  const next = [...blocks];
  next[index - 1] = {
    ...previous,
    text: previous.text + current.text,
    attachmentRefs: [...(previous.attachmentRefs ?? []), ...(current.attachmentRefs ?? [])],
  };
  next.splice(index, 1);
  return { blocks: next, focusIndex: index - 1, focusCaret: previous.text.length };
}

/** Which blocks a collapsed marker hides: everything deeper until the next line at its level or above. */
export function visibleBlocks(blocks: readonly NoteBlock[]): boolean[] {
  const visible: boolean[] = [];
  let hideDeeperThan: number | null = null;
  for (const block of blocks) {
    const depth = block.level === null ? -1 : block.level;
    if (hideDeeperThan !== null) {
      if (block.level !== null && depth > hideDeeperThan) {
        visible.push(false);
        continue;
      }
      hideDeeperThan = null;
    }
    visible.push(true);
    if (block.collapsed === true && block.level !== null) hideDeeperThan = depth;
  }
  return visible;
}

/** Pasted text: one block per line, markers read so levels come back as they were written. */
export function blocksFromText(text: string): NoteBlock[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      const marker = readTypedMarker(trimmed);
      return marker === null
        ? { id: newBlockId(), level: null, text: line }
        : { id: newBlockId(), level: marker.level, text: marker.rest };
    });
}

export function plainText(blocks: readonly NoteBlock[]): string {
  const labels = blockLabels(blocks);
  return blocks.map((block, index) => (labels[index] === null ? block.text : `${labels[index]} ${block.text}`)).join("\n");
}

/** Reads stored blocks defensively: anything unreadable becomes a plain line, never a crash. */
export function readBlocks(raw: unknown): NoteBlock[] {
  if (!Array.isArray(raw)) return [emptyBlock()];
  const blocks = raw.flatMap((item): NoteBlock[] => {
    if (item === null || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const level = typeof record.level === "number" && record.level >= 0 && record.level <= 5 ? (Math.floor(record.level) as BlockLevel) : null;
    return [{
      id: typeof record.id === "string" && record.id !== "" ? record.id : newBlockId(),
      level,
      text: typeof record.text === "string" ? record.text : "",
      attachmentRefs: Array.isArray(record.attachmentRefs) ? record.attachmentRefs.filter((ref): ref is string => typeof ref === "string") : undefined,
      collapsed: record.collapsed === true ? true : undefined,
    }];
  });
  return blocks.length === 0 ? [emptyBlock()] : blocks;
}

// ------------------------------------------------------------------ tags

/** Tags are compared without case: "bài giảng" = "Bài giảng". The first spelling is kept. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.replace(/^#+/, "").trim().replace(/\s+/g, " ");
    if (tag === "") continue;
    const key = tag.toLocaleLowerCase("vi");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.slice(0, 30);
}

/** Search compares tags without accents too: `#bai giang` finds `Bài giảng`. */
export function tagMatches(tag: string, query: string): boolean {
  return normalizeSearch(tag).includes(normalizeSearch(query.replace(/^#+/, "")));
}

// ------------------------------------------------------------------ shapes

export type NoteFolder = {
  id: string;
  /** AVORA-52 · A: the folder above, or null at the top. At most three levels (server-checked). */
  parentId: string | null;
  name: string;
  isSystem: boolean;
  systemKey: string | null;
  position: number;
  createdAt: string;
  /** AVORA-61 · B: the folder's cover colour, or null for folders made before colours. */
  color: FolderColor | null;
};

/** AVORA-61 · B: eight quiet covers in AVORA's orange–black–white family, like file-folder covers. */
export const FOLDER_COLORS = [
  { id: "cam", label: "Cam", hex: "#E8742C" },
  { id: "dat", label: "Đất nung", hex: "#B5583A" },
  { id: "mat_ong", label: "Mật ong", hex: "#D49A2A" },
  { id: "reu", label: "Rêu", hex: "#6F8A4E" },
  { id: "suong", label: "Sương", hex: "#5E8C96" },
  { id: "man", label: "Mận", hex: "#8E5A72" },
  { id: "than", label: "Than", hex: "#3F3A36" },
  { id: "tro", label: "Tro", hex: "#9A928A" },
] as const;

export type FolderColor = (typeof FOLDER_COLORS)[number]["id"];

export function isFolderColor(value: unknown): value is FolderColor {
  return typeof value === "string" && FOLDER_COLORS.some((color) => color.id === value);
}

/** The hex of a folder's cover; a folder with none reads as Cam, AVORA's own colour. */
export function folderColorHex(color: FolderColor | null): string {
  return FOLDER_COLORS.find((entry) => entry.id === color)?.hex ?? FOLDER_COLORS[0].hex;
}

/** A new folder takes the colour after the one used by the most recent folder that has one. */
export function nextFolderColor(folders: readonly NoteFolder[]): FolderColor {
  const colored = folders.filter((folder) => !folder.isSystem && folder.color !== null);
  if (colored.length === 0) return FOLDER_COLORS[0].id;
  const latest = [...colored].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  const index = FOLDER_COLORS.findIndex((entry) => entry.id === latest.color);
  return FOLDER_COLORS[(index + 1) % FOLDER_COLORS.length].id;
}

export type Note = {
  id: string;
  folderId: string | null;
  title: string;
  blocks: NoteBlock[];
  tags: string[];
  pinnedAt: string | null;
  bookRecordId: string | null;
  bookTitle: string | null;
  /** AVORA-93 · 3.3: `chapter:block` in the book where this note was taken, when known. */
  bookLocator?: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NoteAttachment = {
  id: string;
  noteId: string;
  kind: "image" | "file" | "voice";
  storagePath: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  durationSeconds: number | null;
  anchorBlockId: string | null;
  createdAt: string;
};

/** A note without its own title reads by its first line. */
export function noteDisplayTitle(note: Pick<Note, "title" | "blocks">): string {
  const title = note.title.trim();
  if (title !== "") return title;
  const first = note.blocks.find((block) => block.text.trim() !== "");
  return first === undefined ? "Ghi chép chưa có tên" : first.text.trim().slice(0, 120);
}

export function noteFirstLine(note: Pick<Note, "title" | "blocks">): string {
  const title = note.title.trim();
  const lines = note.blocks.map((block) => block.text.trim()).filter((line) => line !== "");
  const body = title === "" ? lines.slice(1) : lines;
  return body[0] ?? "";
}

export function isNoteEmpty(note: Pick<Note, "title" | "blocks" | "tags">): boolean {
  return note.title.trim() === "" && note.blocks.every((block) => block.text.trim() === "") && note.tags.length === 0;
}

// ------------------------------------------------------------------ lists

export type NoteFilter = { voice: boolean; files: boolean; pinned: boolean };

/** Search inside Ghi chép: accent-free words over title, text, tags, book; `#x` looks at tags. */
export function matchesNote(note: Note, query: string, attachments: readonly NoteAttachment[] = []): boolean {
  const trimmed = query.trim();
  if (trimmed === "") return true;
  if (trimmed.startsWith("#")) return note.tags.some((tag) => tagMatches(tag, trimmed));
  const hay = normalizeSearch(
    [note.title, plainText(note.blocks), note.tags.join(" "), note.bookTitle ?? "", attachments.map((a) => a.fileName).join(" ")].join(" "),
  );
  return normalizeSearch(trimmed).split(" ").every((word) => hay.includes(word));
}

export type NoteBucket = { key: string; label: string; notes: Note[] };

const MONTHS = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];

/** Đã ghim · Hôm nay · Hôm qua · 7 ngày qua · 30 ngày qua · Tháng 8 · … · 2025 */
export function bucketNotes(notes: readonly Note[], now: Date = new Date()): NoteBucket[] {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const order: string[] = [];
  const buckets = new Map<string, NoteBucket>();
  const put = (key: string, label: string, note: Note): void => {
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = { key, label, notes: [] };
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.notes.push(note);
  };
  const sorted = [...notes].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  for (const note of sorted.filter((item) => item.pinnedAt !== null)) put("pinned", "Đã ghim", note);
  for (const note of sorted.filter((item) => item.pinnedAt === null)) {
    const at = new Date(note.updatedAt);
    const t = at.getTime();
    if (t >= startOfDay) put("today", "Hôm nay", note);
    else if (t >= startOfDay - day) put("yesterday", "Hôm qua", note);
    else if (t >= startOfDay - 7 * day) put("7d", "7 ngày qua", note);
    else if (t >= startOfDay - 30 * day) put("30d", "30 ngày qua", note);
    else if (at.getFullYear() === now.getFullYear()) put(`m${at.getMonth()}`, MONTHS[at.getMonth()], note);
    else put(`y${at.getFullYear()}`, String(at.getFullYear()), note);
  }
  return order.map((key) => buckets.get(key) as NoteBucket);
}

export type FolderSummary = { folder: NoteFolder; count: number; lastEditedAt: string | null };

/** Folders in the person's own order; the reading folder last among them (A · B layout). */
export function arrangeFolders(folders: readonly NoteFolder[], notes: readonly Note[]): FolderSummary[] {
  const live = notes.filter((note) => note.deletedAt === null);
  const summaries = folders.map((folder): FolderSummary => {
    const inside = live.filter((note) => note.folderId === folder.id);
    return {
      folder,
      count: inside.length,
      lastEditedAt: inside.reduce<string | null>((latest, note) => (latest === null || note.updatedAt > latest ? note.updatedAt : latest), null),
    };
  });
  return summaries.sort((a, b) => {
    if (a.folder.isSystem !== b.folder.isSystem) return a.folder.isSystem ? 1 : -1;
    if (a.folder.position !== b.folder.position) return a.folder.position - b.folder.position;
    return (b.lastEditedAt ?? "").localeCompare(a.lastEditedAt ?? "");
  });
}

// ------------------------------------------------------------------ the tree (AVORA-52 · A)

/** Same limit as Bảng con / Nhóm con; the server enforces it too. */
export const MAX_FOLDER_DEPTH = 3;

/** 1 for a top folder, 2 for its child, 3 below that. */
export function folderDepth(folders: readonly NoteFolder[], id: string): number {
  const byId = new Map(folders.map((folder) => [folder.id, folder] as const));
  let depth = 0;
  let cursor: string | null = id;
  const seen = new Set<string>();
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    depth += 1;
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return depth;
}

/** How many levels hang from this folder, itself included (1 = no children). */
export function folderHeight(folders: readonly NoteFolder[], id: string): number {
  const children = folders.filter((folder) => folder.parentId === id);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((child) => folderHeight(folders, child.id)));
}

/** The folder and everything under it. */
export function folderSubtreeIds(folders: readonly NoteFolder[], id: string): Set<string> {
  const ids = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Where a folder may be moved: never into itself or below, never past three levels, never a system folder. */
export function moveTargets(folders: readonly NoteFolder[], id: string): NoteFolder[] {
  const inside = folderSubtreeIds(folders, id);
  const height = folderHeight(folders, id);
  return folders.filter(
    (folder) => !folder.isSystem && !inside.has(folder.id) && folderDepth(folders, folder.id) + height <= MAX_FOLDER_DEPTH,
  );
}

/** Whether a sub-folder can be made here. */
export function canAddSubFolder(folders: readonly NoteFolder[], folder: NoteFolder): boolean {
  return !folder.isSystem && folderDepth(folders, folder.id) < MAX_FOLDER_DEPTH;
}

/** The path of names from the top, for a search hit or a move target. */
export function folderPath(folders: readonly NoteFolder[], id: string): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder] as const));
  const names: string[] = [];
  let cursor: string | null = id;
  const seen = new Set<string>();
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const folder = byId.get(cursor);
    if (folder === undefined) break;
    names.unshift(folder.name);
    cursor = folder.parentId;
  }
  return names;
}

/** Live notes in a folder and every folder below it. */
export function countInSubtree(folders: readonly NoteFolder[], notes: readonly Note[], id: string): number {
  const ids = folderSubtreeIds(folders, id);
  return notes.filter((note) => note.deletedAt === null && note.folderId !== null && ids.has(note.folderId)).length;
}

const OPEN_FOLDERS_KEY = "avora.notes.openFolders";

export function readOpenFolders(): Set<string> {
  try {
    const raw = window.localStorage.getItem(OPEN_FOLDERS_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

export function rememberOpenFolders(ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify([...ids]));
  } catch {
    // Remembering is a courtesy.
  }
}

// ------------------------------------------------------------------ remembered on this device

const PLACE_KEY = "avora.notes.place";
const DRAFT_PREFIX = "avora.notes.draft.";
const LAST_FOLDER_KEY = "avora.notes.lastFolder";

export type NotesPlace = {
  /** A folder id, or "recent" · "unsorted" · "trash"; null = the folder list (phone). */
  folderId: string | null;
  noteId: string | null;
  blockId?: string | null;
  caret?: number;
  scrollTop?: number;
};

export function readNotesPlace(): NotesPlace | null {
  try {
    const raw = window.localStorage.getItem(PLACE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as NotesPlace;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function rememberNotesPlace(place: NotesPlace): void {
  try {
    const previous = readNotesPlace();
    // Same note: keep the caret and scroll the editor already wrote.
    const kept = previous !== null && previous.noteId === place.noteId ? previous : {};
    window.localStorage.setItem(PLACE_KEY, JSON.stringify({ ...kept, ...place }));
  } catch {
    // Coming back to the folder list is the fallback.
  }
}

/** Where the caret and scroll were inside the open note (AVORA-44 · việc 2); only for that note. */
export function rememberNotePosition(position: { noteId: string; blockId?: string | null; caret?: number; scrollTop?: number }): void {
  try {
    const previous = readNotesPlace();
    if (previous === null || previous.noteId !== position.noteId) return;
    window.localStorage.setItem(PLACE_KEY, JSON.stringify({ ...previous, ...position }));
  } catch {
    // Not important enough to report.
  }
}

const FULLSCREEN_KEY = "avora.notes.fullscreen";

/** `⤢ Viết toàn màn` is remembered on this device (44b · B). */
export function readNotesFullscreen(): boolean {
  try {
    return window.localStorage.getItem(FULLSCREEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberNotesFullscreen(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(FULLSCREEN_KEY, "1");
    else window.localStorage.removeItem(FULLSCREEN_KEY);
  } catch {
    // Not important enough to report.
  }
}

/** The three-column Ghi chép needs folders 220 + list 300 + editor 560 (44b · B). */
export const NOTES_THREE_COLUMNS_MIN = 220 + 300 + 560;

export type NotesLayout = "phone" | "two" | "three";

/** Phone steps through screens; a narrow computer folds the folders into the list's header. */
export function notesLayout(isWide: boolean, width: number): NotesLayout {
  if (!isWide) return "phone";
  return width >= NOTES_THREE_COLUMNS_MIN ? "three" : "two";
}

/** Pasted text appended to a note as new blocks (việc 3 · "Thêm vào ghi chép cũ"). */
export function appendPasted(blocks: readonly NoteBlock[], text: string): NoteBlock[] {
  const pasted = blocksFromText(text);
  const kept = blocks.length === 1 && blocks[0].text.trim() === "" && (blocks[0].attachmentRefs ?? []).length === 0 ? [] : [...blocks];
  return [...kept, ...pasted];
}

export function readLastFolder(): string | null {
  try {
    return window.localStorage.getItem(LAST_FOLDER_KEY);
  } catch {
    return null;
  }
}

export function rememberLastFolder(folderId: string | null): void {
  try {
    if (folderId === null) window.localStorage.removeItem(LAST_FOLDER_KEY);
    else window.localStorage.setItem(LAST_FOLDER_KEY, folderId);
  } catch {
    // Not important enough to report.
  }
}

export type NoteDraft = Pick<Note, "id" | "folderId" | "title" | "blocks" | "tags" | "bookRecordId"> & { savedLocallyAt: string };

/** The unsaved version of a note, kept on this device until the server has it. */
export function readDraft(noteId: string): NoteDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_PREFIX + noteId);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as NoteDraft;
    return { ...parsed, blocks: readBlocks(parsed.blocks), tags: normalizeTags(parsed.tags ?? []) };
  } catch {
    return null;
  }
}

export function writeDraft(draft: NoteDraft): boolean {
  try {
    window.localStorage.setItem(DRAFT_PREFIX + draft.id, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(noteId: string): void {
  try {
    window.localStorage.removeItem(DRAFT_PREFIX + noteId);
  } catch {
    // A stale draft is ignored once the server copy is newer.
  }
}

/** Every note id with a draft still waiting, for the "back online" flush. */
export function pendingDraftIds(): string[] {
  try {
    const ids: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(DRAFT_PREFIX) === true) ids.push(key.slice(DRAFT_PREFIX.length));
    }
    return ids;
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ server

export const NOTE_FILES_BUCKET = "note-files";

export const noteKeys = {
  all: ["notes"] as const,
  folders: ["notes", "folders"] as const,
  list: ["notes", "list"] as const,
  attachments: ["notes", "attachments"] as const,
};

function fail(code: string | undefined, message: string): Error {
  logError("notes", { code, message });
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_note_folder_system")) return new Error("Thư mục Ghi chép đọc sách không đổi tên hay xoá được.");
  if (normalized.includes("avora_note_folder_missing")) return new Error("Thư mục này không còn nữa.");
  if (normalized.includes("avora_note_book_missing")) return new Error("Cuốn sách này không còn trong Kệ sách.");
  if (normalized.includes("avora_note_not_yours")) return new Error("Ghi chép này không còn nữa.");
  if (normalized.includes("avora_note_folder_depth")) return new Error("Thư mục con tối đa 3 tầng.");
  if (normalized.includes("avora_note_folder_cycle")) return new Error("Không chuyển được thư mục vào bên trong chính nó.");
  if (normalized.includes("avora_note_folder_parent")) return new Error("Thư mục đích không còn nữa.");
  if (normalized.includes("note_folders_name_len")) return new Error("Tên thư mục cần từ 1 đến 80 ký tự.");
  if (normalized.includes("notes_blocks_size")) return new Error("Ghi chép quá dài — hãy tách thành hai ghi chép.");
  if (normalized.includes("notes_tags_count")) return new Error("Mỗi ghi chép có tối đa 30 thẻ.");
  if (normalized.includes("failed to fetch") || normalized.includes("network")) return new Error("Chưa lưu — sẽ lưu khi có mạng.");
  if (normalized.includes("payload too large") || normalized.includes("exceeded")) return new Error("Tệp quá lớn (tối đa 25 MB).");
  if (code === "42501" || normalized.includes("row-level")) return new Error("Bạn không có quyền với ghi chép này.");
  return new Error("Có lỗi xảy ra với Ghi chép. Vui lòng thử lại.");
}

export function isOfflineError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return error instanceof Error && error.message.startsWith("Chưa lưu");
}

type FolderRow = { id: string; parent_id: string | null; name: string; is_system: boolean; system_key: string | null; position: number; created_at: string; color?: string | null };
type NoteRow = {
  id: string; folder_id: string | null; title: string; blocks: unknown; tags: string[] | null; pinned_at: string | null;
  book_record_id: string | null; book_title: string | null; book_locator?: string | null; deleted_at: string | null; created_at: string; updated_at: string;
};
type AttachmentRow = {
  id: string; note_id: string; kind: string; storage_path: string; file_name: string; mime_type: string;
  byte_size: number; duration_seconds: number | null; anchor_block_id: string | null; created_at: string;
};

function toFolder(row: FolderRow): NoteFolder {
  return {
    id: row.id, parentId: row.parent_id ?? null, name: row.name, isSystem: row.is_system, systemKey: row.system_key,
    position: row.position, createdAt: row.created_at, color: isFolderColor(row.color) ? row.color : null,
  };
}

export function toNote(row: NoteRow): Note {
  return {
    id: row.id, folderId: row.folder_id, title: row.title, blocks: readBlocks(row.blocks), tags: row.tags ?? [],
    pinnedAt: row.pinned_at, bookRecordId: row.book_record_id, bookTitle: row.book_title, bookLocator: row.book_locator ?? null, deletedAt: row.deleted_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function toAttachment(row: AttachmentRow): NoteAttachment {
  return {
    id: row.id, noteId: row.note_id, kind: row.kind as NoteAttachment["kind"], storagePath: row.storage_path, fileName: row.file_name,
    mimeType: row.mime_type, byteSize: Number(row.byte_size), durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    anchorBlockId: row.anchor_block_id, createdAt: row.created_at,
  };
}

const FOLDER_COLUMNS = "id, parent_id, name, is_system, system_key, position, created_at, color";
const NOTE_COLUMNS = "id, folder_id, title, blocks, tags, pinned_at, book_record_id, book_title, book_locator, deleted_at, created_at, updated_at";

export async function fetchFolders(): Promise<NoteFolder[]> {
  const { error: ensureError } = await supabase.rpc("ensure_reading_folder");
  if (ensureError) throw fail(ensureError.code, ensureError.message);
  const { data, error } = await supabase.from("note_folders").select(FOLDER_COLUMNS).order("position");
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toFolder(row as FolderRow));
}

export async function fetchNotes(): Promise<Note[]> {
  const { data, error } = await supabase.from("notes").select(NOTE_COLUMNS).order("updated_at", { ascending: false }).limit(2000);
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toNote(row as NoteRow));
}

export async function fetchNoteAttachments(): Promise<NoteAttachment[]> {
  const { data, error } = await supabase
    .from("note_attachments")
    .select("id, note_id, kind, storage_path, file_name, mime_type, byte_size, duration_seconds, anchor_block_id, created_at")
    .order("created_at", { ascending: false });
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toAttachment(row as AttachmentRow));
}

export async function createFolder(
  name: string,
  position: number,
  parentId: string | null = null,
  color: FolderColor | null = null,
): Promise<NoteFolder> {
  const { data, error } = await supabase
    .from("note_folders")
    .insert({ name: name.trim(), position, parent_id: parentId, color })
    .select(FOLDER_COLUMNS)
    .single();
  if (error) throw fail(error.code, error.message);
  return toFolder(data as FolderRow);
}

export async function recolorFolder(id: string, color: FolderColor): Promise<void> {
  const { error } = await supabase.from("note_folders").update({ color }).eq("id", id);
  if (error) throw fail(error.code, error.message);
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const { error } = await supabase.from("note_folders").update({ name: name.trim() }).eq("id", id);
  if (error) throw fail(error.code, error.message);
}

/** Moves a folder under another (or to the top). The server refuses cycles and a fourth level. */
export async function moveFolder(id: string, parentId: string | null): Promise<void> {
  const { error } = await supabase.from("note_folders").update({ parent_id: parentId }).eq("id", id);
  if (error) throw fail(error.code, error.message);
}

export async function reorderFolders(ids: readonly string[]): Promise<void> {
  for (const [index, id] of ids.entries()) {
    const { error } = await supabase.from("note_folders").update({ position: index }).eq("id", id);
    if (error) throw fail(error.code, error.message);
  }
}

export async function deleteFolder(id: string, trashNotes: boolean): Promise<number> {
  const { data, error } = await supabase.rpc("delete_note_folder", { p_folder_id: id, p_trash_notes: trashNotes });
  if (error) throw fail(error.code, error.message);
  return data ?? 0;
}

/** Saves the whole note (created on first save — the id is made on this device). */
export async function saveNote(note: Pick<Note, "id" | "folderId" | "title" | "blocks" | "tags" | "bookRecordId"> & { bookLocator?: string | null }): Promise<Note> {
  const { data, error } = await supabase
    .from("notes")
    .upsert({
      id: note.id,
      folder_id: note.folderId,
      title: note.title.slice(0, 200),
      blocks: note.blocks as unknown as Json,
      tags: normalizeTags(note.tags),
      book_record_id: note.bookRecordId,
      ...(note.bookLocator != null ? { book_locator: note.bookLocator } : {}),
    })
    .select(NOTE_COLUMNS)
    .single();
  if (error) throw fail(error.code, error.message);
  return toNote(data as NoteRow);
}

export async function patchNote(id: string, patch: { folderId?: string | null; pinned?: boolean; deleted?: boolean }): Promise<void> {
  const row: { folder_id?: string | null; pinned_at?: string | null; deleted_at?: string | null } = {};
  if (patch.folderId !== undefined) row.folder_id = patch.folderId;
  if (patch.pinned !== undefined) row.pinned_at = patch.pinned ? new Date().toISOString() : null;
  if (patch.deleted !== undefined) row.deleted_at = patch.deleted ? new Date().toISOString() : null;
  const { error } = await supabase.from("notes").update(row).eq("id", id);
  if (error) throw fail(error.code, error.message);
}

/** A file under the owner's own folder in `note-files`; the row then ties it to the note. */
export async function uploadNoteAttachment(input: {
  userId: string;
  noteId: string;
  file: Blob;
  fileName: string;
  kind: NoteAttachment["kind"];
  durationSeconds?: number | null;
  anchorBlockId: string | null;
}): Promise<NoteAttachment> {
  if (input.file.size > 26214400) throw new Error("Tệp quá lớn (tối đa 25 MB).");
  const safe = input.fileName.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120) || "tep";
  const path = `${input.userId}/${input.noteId}/${newBlockId()}-${safe}`;
  const { error: uploadError } = await supabase.storage.from(NOTE_FILES_BUCKET).upload(path, input.file, {
    contentType: input.file.type || "application/octet-stream",
    upsert: false,
  });
  if (uploadError) throw fail(undefined, uploadError.message);
  const { data, error } = await supabase
    .from("note_attachments")
    .insert({
      note_id: input.noteId,
      kind: input.kind,
      storage_path: path,
      file_name: input.fileName.slice(0, 255) || "Tệp",
      mime_type: input.file.type || "application/octet-stream",
      byte_size: input.file.size,
      duration_seconds: input.durationSeconds ?? null,
      anchor_block_id: input.anchorBlockId,
    })
    .select("id, note_id, kind, storage_path, file_name, mime_type, byte_size, duration_seconds, anchor_block_id, created_at")
    .single();
  if (error) {
    await supabase.storage.from(NOTE_FILES_BUCKET).remove([path]);
    throw fail(error.code, error.message);
  }
  return toAttachment(data as AttachmentRow);
}

export async function deleteNoteAttachment(attachment: NoteAttachment): Promise<void> {
  const { error } = await supabase.from("note_attachments").delete().eq("id", attachment.id);
  if (error) throw fail(error.code, error.message);
  await supabase.storage.from(NOTE_FILES_BUCKET).remove([attachment.storagePath]);
}

export async function signedNoteUrls(paths: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data, error } = await supabase.storage.from(NOTE_FILES_BUCKET).createSignedUrls([...paths], 600);
  if (error) throw fail(undefined, error.message);
  for (const row of data ?? []) if (row.path !== null && row.signedUrl) out.set(row.path, row.signedUrl);
  return out;
}

export function attachmentKindFor(mime: string): NoteAttachment["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "voice";
  return "file";
}

/**
 * Ghi chép đọc sách written or edited in a week (C7 · "Đã đọc", AVORA-44 · việc 4): notes tied to
 * a book, or kept in the system reading folder. Ready for the Nhìn lại tuần card to count.
 */
export function weekReadingNoteCount(
  notes: readonly Pick<Note, "folderId" | "bookRecordId" | "bookTitle" | "updatedAt" | "deletedAt">[],
  readingFolderId: string | null,
  from: Date,
  to: Date,
): number {
  const start = from.getTime();
  const end = to.getTime();
  return notes.filter((note) => {
    if (note.deletedAt !== null) return false;
    const isReading = note.bookRecordId !== null || note.bookTitle !== null || (readingFolderId !== null && note.folderId === readingFolderId);
    const at = new Date(note.updatedAt).getTime();
    return isReading && at >= start && at < end;
  }).length;
}
