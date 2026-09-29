/**
 * A run of messages read as a piece of conversation: who said what, in order, words only.
 *
 * Used twice (Đợt gộp 2): the description prefilled when a task is made from several picked
 * messages (A5), and the card that shows a forwarded bundle (B1). Both group consecutive lines
 * from the same speaker into one block, so a conversation reads the way it was said.
 */

/** One line of a conversation. `files` counts attachments; `images` how many of them are pictures. */
export type TranscriptItem = {
  name: string;
  text: string;
  files: number;
  images?: number;
  at?: string;
};

export type TranscriptBlock = {
  name: string;
  /** Each message keeps its own line breaks; a files-only message reads as its file label. */
  lines: string[];
};

/** Said when a message carried only files: "[Ảnh]", "[3 ảnh]", "[2 tệp]". */
export function fileLabel(files: number, images: number = 0): string {
  if (files <= 0) return "";
  if (images >= files) return files === 1 ? "[Ảnh]" : `[${files} ảnh]`;
  return `[${files} tệp]`;
}

/** The words of one line, or its file label when it had none. */
export function lineText(item: TranscriptItem): string {
  const words = item.text.trim();
  if (words !== "") return words;
  return fileLabel(item.files, item.images ?? 0);
}

/** Consecutive lines from the same person become one block. */
export function groupBySpeaker(items: readonly TranscriptItem[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  for (const item of items) {
    const text = lineText(item);
    if (text === "") continue;
    const last = blocks[blocks.length - 1];
    if (last !== undefined && last.name === item.name) last.lines.push(text);
    else blocks.push({ name: item.name, lines: [text] });
  }
  return blocks;
}

/**
 * "Tên: nội dung" blocks, oldest first, capped at `maxLength` characters. A block that does not
 * fit is cut with "…" rather than dropped, so the reader knows the conversation went on.
 */
export function transcriptText(items: readonly TranscriptItem[], maxLength: number): string {
  const text = groupBySpeaker(items)
    .map((block) => `${block.name}: ${block.lines.join("\n")}`)
    .join("\n\n");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/** Distinct speakers in order of first appearance. */
export function speakersOf(items: readonly TranscriptItem[]): string[] {
  const seen: string[] = [];
  for (const item of items) if (!seen.includes(item.name)) seen.push(item.name);
  return seen;
}

/**
 * The one-line stand-in a bundle leaves in lists, notifications and search:
 * "Đoạn hội thoại · 5 tin · An, Bình, Châu +2". Mirrors the server's own summary.
 */
export function bundleSummary(count: number, names: readonly string[]): string {
  const shown = names.slice(0, 3).join(", ");
  const rest = names.length > 3 ? ` +${names.length - 3}` : "";
  return `Đoạn hội thoại · ${count} tin · ${shown}${rest}`;
}

/** The bundle a forwarded conversation carries, as stored on the message (`forward_bundle`). */
export type ForwardBundle = {
  count: number;
  firstAt: string | null;
  lastAt: string | null;
  items: TranscriptItem[];
};

/** Reads `forward_bundle` defensively: anything malformed reads as "not a bundle". */
export function parseForwardBundle(raw: unknown): ForwardBundle | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.items)) return null;
  const items: TranscriptItem[] = [];
  for (const entry of record.items) {
    if (entry === null || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    items.push({
      name: typeof item.name === "string" && item.name.trim() !== "" ? item.name : "Thành viên AVORA",
      text: typeof item.text === "string" ? item.text : "",
      files: typeof item.files === "number" ? item.files : 0,
      at: typeof item.at === "string" ? item.at : undefined,
    });
  }
  return {
    count: typeof record.count === "number" ? record.count : items.length,
    firstAt: typeof record.first_at === "string" ? record.first_at : null,
    lastAt: typeof record.last_at === "string" ? record.last_at : null,
    items,
  };
}

/** "28/09 · 14:02–14:10", or both ends in full when the days differ. */
export function bundleSpan(firstAt: string | null, lastAt: string | null): string {
  if (firstAt === null || lastAt === null) return "";
  const a = new Date(firstAt);
  const b = new Date(lastAt);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
  const pad = (value: number): string => `${value}`.padStart(2, "0");
  const day = (d: Date): string => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  const clock = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (day(a) === day(b) && a.getFullYear() === b.getFullYear()) return `${day(a)} · ${clock(a)}–${clock(b)}`;
  return `${day(a)} ${clock(a)} – ${day(b)} ${clock(b)}`;
}
