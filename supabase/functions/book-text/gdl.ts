// AVORA-100 · S.2 §4.4 C — open-licence picture books from the Global Digital Library.
// The official EPUB of one book (`/wp-json/epub-generator/v1/book/{epub_id}`) is read once: its
// pictures are copied into Avora's public bucket `picture-books/{id}/…` (the reader never asks GDL),
// its pages become a picture followed by its words, and the attribution the licence asks for
// (author · illustrator · translator · publisher · source · licence + link) opens the book.
import { strFromU8, unzipSync } from "npm:fflate@0.8.2";

export type GdlBlock = { k: "h"; t: string; l: number } | { k: "p"; t: string } | { k: "img"; src: string; alt: string };

export type GdlCredits = {
  epub_id: string;
  license: string;
  link?: string;
  publisher?: string | null;
  authors?: string[];
  illustrators?: string[];
  translators?: string[];
};

const LICENSE_URL: Record<string, string> = {
  "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
  "CC-BY-SA-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
};

const ROLE_VI: Record<string, string> = { Author: "Tác giả", Illustrator: "Hoạ sĩ", Translator: "Dịch" };

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'");
}

/** The words the licence asks for, one line each (also the book's `license` lines). */
export function creditLines(title: string, credits: GdlCredits, contributors: readonly [string, string][]): string[] {
  // The catalogue's names first (roles already read in Vietnamese / English / Chichewa), the EPUB's as a fallback.
  const byRole = (role: string, known: readonly string[] | undefined): string[] => {
    if (known !== undefined && known.length > 0) return [...known];
    return contributors.filter(([, r]) => r === role).map(([name]) => name);
  };
  const lines: string[] = [`“${title}”`];
  for (const [role, fallback] of [["Author", credits.authors], ["Illustrator", credits.illustrators], ["Translator", credits.translators]] as const) {
    const names = byRole(role, fallback);
    if (names.length > 0) lines.push(`${ROLE_VI[role]}: ${names.join(", ")}`);
  }
  if (credits.publisher) lines.push(`Nhà xuất bản: ${credits.publisher}`);
  lines.push(`Nguồn: Global Digital Library${credits.link ? ` · ${credits.link}` : ""}`);
  const name = credits.license === "CC-BY-SA-4.0" ? "CC BY-SA 4.0" : "CC BY 4.0";
  lines.push(`Giấy phép: ${name} · ${LICENSE_URL[credits.license] ?? ""}`.trim());
  return lines;
}

/**
 * Unpacks the EPUB, stores its pictures, and returns the pages as blocks plus the contributors
 * named in its package file. `store` writes one picture and returns its public URL.
 */
export function readGdlEpub(
  bytes: Uint8Array,
): { pages: { images: { name: string; data: Uint8Array; alt: string }[]; text: string[] }[]; contributors: [string, string][] } {
  const files = unzipSync(repairEnd(bytes));
  const opfName = Object.keys(files).find((name) => name.endsWith(".opf"));
  if (opfName === undefined) throw new Error("gdl_no_opf");
  const opf = strFromU8(files[opfName]);
  const dir = opfName.includes("/") ? opfName.slice(0, opfName.lastIndexOf("/") + 1) : "";
  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"/g)) manifest.set(m[1], m[2]);
  const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map((m) => manifest.get(m[1])).filter((href): href is string => href !== undefined);
  const contributors: [string, string][] = [];
  for (const m of opf.matchAll(/<dc:contributor id="([^"]+)">([^<]*)<\/dc:contributor>\s*<meta refines="#\1" property="role"[^>]*>([^<]*)<\/meta>/g)) {
    contributors.push([decode(m[2]).replace(/\s+/g, " ").trim(), m[3].trim()]);
  }
  const pages = spine.map((href) => {
    const raw = files[dir + href];
    const html = raw === undefined ? "" : strFromU8(raw);
    const body = html.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
    const images: { name: string; data: Uint8Array; alt: string }[] = [];
    for (const m of body.matchAll(/<img\b([^>]*)>/gi)) {
      const src = /\bsrc="([^"]+)"/i.exec(m[1])?.[1];
      if (src === undefined) continue;
      const data = files[dir + src.replace(/^\.\//, "")];
      if (data === undefined) continue;
      images.push({ name: src.split("/").pop() ?? src, data, alt: decode(/\balt="([^"]*)"/i.exec(m[1])?.[1] ?? "") });
    }
    const text: string[] = [];
    for (const m of body.matchAll(/<(p|h[1-6]|div)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const t = decode(m[2].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""));
      for (const para of t.split(/\n\s*\n/)) {
        const clean = para.replace(/[ \t]+/g, " ").replace(/\n /g, "\n").trim();
        if (clean !== "" && clean !== ".") text.push(clean);
      }
    }
    return { images, text };
  });
  return { pages, contributors };
}

/**
 * GDL's generator sometimes ends the file 1–3 bytes early, inside the zip's 22-byte end record
 * (the high byte of the directory offset and the comment length, all zeros for a file this size).
 * Restore those zero bytes; a complete file is returned unchanged.
 */
export function repairEnd(bytes: Uint8Array): Uint8Array {
  for (let i = bytes.length - 4; i >= Math.max(0, bytes.length - 64); i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      const have = bytes.length - i;
      if (have >= 22) return bytes;
      const fixed = new Uint8Array(i + 22);
      fixed.set(bytes);
      return fixed;
    }
  }
  return bytes;
}

export function mimeOf(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg";
}
