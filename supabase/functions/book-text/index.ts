// AVORA-77 · D3 — book-text: one public-domain book, cleaned, cut into chapters, cached.
// Only titles in `book_catalog` (Gutenberg ids, checked Wikisource pages). Never www.gutenberg.org
// (it blocks automated access): the official mirror gutenberg.pglaf.org. Wikisource through the
// MediaWiki API (`action=parse`). The cleaned original is kept in Storage `public-domain-books/`;
// a translation is never stored anywhere. 30 calls per person per hour.
import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const MIRROR = "https://gutenberg.pglaf.org";
const WIKI_API = "https://vi.wikisource.org/w/api.php";
const UA = "AvoraReader/1.0 (https://avorachat.com; public-domain reader)";
const BUCKET = "public-domain-books";
const HOURLY_LIMIT = 30;
const CACHE_VERSION = "v1";

/** The 1925 Vietnamese Bible: one Wikisource page per book, checked one by one (PD-old). */
const BIBLE_ID = "Kinh Thánh Cựu Ước và Tân Ước 1925";
const BIBLE_BOOKS: readonly string[] = [
  "Sáng thế Ký", "Xuất Ê-díp-tô Ký", "Lê-vi Ký", "Dân số Ký", "Phục truyền Luật lệ Ký", "Giô-suê", "Các Quan Xét", "Ru-tơ",
  "I Sa-mu-ên", "II Sa-mu-ên", "I Các Vua", "II Các Vua", "I Sử ký", "II Sử ký", "E-xơ-ra", "Nê-hê-mi", "Ê-xơ-tê", "Gióp",
  "Thi thiên", "Châm ngôn", "Truyền đạo", "Nhã ca", "Ê-sai", "Giê-rê-mi", "Ca thương", "Ê-xê-chi-ên", "Đa-ni-ên", "Ô-sê",
  "Giô-ên", "A-mốt", "Áp-đia", "Giô-na", "Mi-chê", "Na-hum", "Ha-ba-cúc", "Sô-phô-ni", "A-ghê", "Xa-cha-ri", "Ma-la-chi",
  "Ma-thi-ơ", "Mác", "Lu-ca", "Giăng", "Công vụ các Sứ đồ", "Rô-ma", "I Cô-rinh-tô", "II Cô-rinh-tô", "Ga-la-ti", "Ê-phê-sô",
  "Phi-líp", "Cô-lô-se", "I Tê-sa-lô-ni-ca", "II Tê-sa-lô-ni-ca", "I Ti-mô-thê", "II Ti-mô-thê", "Tít", "Phi-lê-môn",
  "Hê-bơ-rơ", "Gia-cơ", "I Phi-e-rơ", "II Phi-e-rơ", "I Giăng", "II Giăng", "III Giăng", "Giu-đe", "Khải huyền",
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

/** One piece of a chapter. Plain text only — the reader never injects HTML. */
type Block = { k: "h"; t: string; l: number } | { k: "p"; t: string } | { k: "pre"; t: string } | { k: "img"; src: string; alt: string };
type Chapter = { title: string; blocks: Block[] | null };
type Book = {
  source: "gutenberg" | "wikisource";
  sourceId: string;
  title: string;
  authors: string | null;
  language: string;
  sourceUrl: string;
  epubUrl: string | null;
  /** Kept word for word from the source (Gutenberg's licence, Wikisource's licence box). */
  license: string[];
  chapters: Chapter[];
  fetchedAt: string;
};

// ------------------------------------------------------------------ HTML → blocks (a small tokenizer: fast, no DOM)

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", mdash: "—", ndash: "–", hellip: "…", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", shy: "", thinsp: " ", ensp: " ", emsp: " ", middot: "·", copy: "©",
  eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û", icirc: "î", euml: "ë",
  iuml: "ï", uuml: "ü", ouml: "ö", auml: "ä", aelig: "æ", oelig: "œ", Eacute: "É", Agrave: "À", deg: "°", pound: "£", sect: "§",
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(n) || n === 0x200b) return "";
      try {
        return String.fromCodePoint(n);
      } catch {
        return "";
      }
    }
    return NAMED[code] ?? whole;
  });
}

const VOID = new Set(["br", "img", "hr", "meta", "link", "input", "wbr", "col", "area", "source", "base"]);
const DROP = new Set(["script", "style", "form", "noscript", "iframe", "button", "select", "textarea", "svg", "math", "head", "nav", "audio", "video", "object", "embed", "template"]);
const BLOCK = new Set(["p", "div", "blockquote", "li", "dd", "dt", "td", "th", "tr", "figcaption", "figure", "section", "article", "table", "ul", "ol", "dl", "body", "center", "address"]);

type Rules = {
  /** Class / id markers of things to leave out entirely. */
  skip: (tag: string, attrs: string) => boolean;
  /** Class / id markers of the licence, kept aside word for word. */
  license: (tag: string, attrs: string) => boolean;
  imageBase: string | null;
};

function attr(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (match === null) return null;
  return decode(match[2] ?? match[3] ?? match[4] ?? "");
}

function tidy(text: string): string {
  return text
    .replace(/[ \t\r\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\[\[[^\]]*\]\]/g, "")
    .trim();
}

function toBlocks(html: string, rules: Rules): { blocks: Block[]; license: string[] } {
  const blocks: Block[] = [];
  const license: string[] = [];
  let buffer = "";
  let heading: { level: number; text: string } | null = null;
  let pre = 0;
  // Skipped / licence regions: tag name + nesting depth of that tag.
  let skip: { tag: string; depth: number } | null = null;
  let lic: { tag: string; depth: number } | null = null;
  const lineSpans: string[] = [];

  const flush = (): void => {
    const text = pre > 0 ? buffer.replace(/^\n+|\s+$/g, "") : tidy(buffer);
    buffer = "";
    if (text === "") return;
    if (lic !== null) license.push(text);
    else blocks.push(pre > 0 ? { k: "pre", t: text } : { k: "p", t: text });
  };

  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)|</g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const [, closing, rawTag, attrs = "", text] = match;
    if (text !== undefined || (rawTag === undefined && match[0] === "<")) {
      if (skip !== null) continue;
      const piece = decode(text ?? "<");
      if (heading !== null) heading.text += piece;
      else buffer += pre > 0 ? piece : piece.replace(/\s+/g, " ");
      continue;
    }
    if (rawTag === undefined) continue;
    const tag = rawTag.toLowerCase();

    if (skip !== null) {
      if (tag === skip.tag && !VOID.has(tag) && !attrs.trim().endsWith("/")) skip.depth += closing ? -1 : 1;
      if (skip.depth === 0) skip = null;
      continue;
    }
    if (!closing && !VOID.has(tag) && (DROP.has(tag) || rules.skip(tag, attrs))) {
      if (attrs.trim().endsWith("/")) continue;
      skip = { tag, depth: 1 };
      continue;
    }
    if (lic !== null && tag === lic.tag && !VOID.has(tag)) {
      lic.depth += closing ? -1 : 1;
      if (lic.depth === 0) {
        flush();
        lic = null;
        continue;
      }
    } else if (lic === null && !closing && !VOID.has(tag) && rules.license(tag, attrs)) {
      flush();
      lic = { tag, depth: 1 };
      continue;
    }

    if (/^h[1-6]$/.test(tag)) {
      if (!closing) {
        flush();
        heading = { level: Number(tag[1]), text: "" };
      } else if (heading !== null) {
        // A heading that wraps an illustration caption ("…\n\nCHAPTER II."): the caption stays a line, the last part is the title.
        const parts = tidy(heading.text).split(/\n{2,}/).map((part) => part.trim()).filter((part) => part !== "");
        const t = parts.pop() ?? "";
        for (const caption of parts) {
          if (lic !== null) license.push(caption);
          else blocks.push({ k: "p", t: caption });
        }
        if (t !== "") {
          if (lic !== null) license.push(t);
          else blocks.push({ k: "h", t: t.replace(/\s*\n\s*/g, " "), l: heading.level });
        }
        heading = null;
      }
      continue;
    }
    if (tag === "br") {
      if (heading !== null) heading.text += " ";
      else buffer += "\n";
      continue;
    }
    if (tag === "img" && !closing) {
      const src = attr(attrs, "src");
      if (src !== null && rules.imageBase !== null && lic === null && heading === null) {
        flush();
        const absolute = /^https?:\/\//.test(src) ? src : src.startsWith("//") ? `https:${src}` : `${rules.imageBase}${src.replace(/^\.?\//, "")}`;
        // Only the book's own illustrations, from the same mirror; no tracking pixels, no other hosts.
        if (absolute.startsWith(rules.imageBase) || absolute.startsWith("https://upload.wikimedia.org/")) {
          blocks.push({ k: "img", src: absolute, alt: attr(attrs, "alt") ?? "" });
        }
      }
      continue;
    }
    if (tag === "pre") {
      flush();
      pre += closing ? -1 : 1;
      if (pre < 0) pre = 0;
      continue;
    }
    if (tag === "span") {
      // Gutenberg verse: <span class="i0">one line</span> is a line of its own.
      if (!closing) lineSpans.push(/\bclass\s*=\s*["'][^"']*\b(i\d+|line)\b/i.test(attrs) ? "line" : "");
      else if (lineSpans.pop() === "line") buffer += "\n";
      continue;
    }
    if (BLOCK.has(tag) || tag === "hr") {
      if (heading !== null) heading.text += "\n\n";
      else flush();
    }
  }
  flush();
  return { blocks, license };
}

/** Cuts the blocks at the commonest top heading level (h1–h3 seen at least twice). */
function intoChapters(blocks: Block[], fallbackTitle: string): Chapter[] {
  const counts = new Map<number, number>();
  for (const block of blocks) if (block.k === "h" && block.l <= 3) counts.set(block.l, (counts.get(block.l) ?? 0) + 1);
  // A title page often has its own h1 or two; chapters are the shallowest level that repeats.
  const level = [1, 2, 3].find((l) => (counts.get(l) ?? 0) >= 3) ?? [1, 2, 3].find((l) => (counts.get(l) ?? 0) >= 2) ?? null;
  if (level === null) return [{ title: fallbackTitle, blocks }];
  const chapters: Chapter[] = [];
  let current: Chapter = { title: "Mở đầu", blocks: [] };
  for (const block of blocks) {
    if (block.k === "h" && block.l <= level) {
      if ((current.blocks ?? []).length > 0) chapters.push(current);
      current = { title: block.t.slice(0, 160), blocks: [] };
      if (block.l < level) current.blocks?.push(block);
      continue;
    }
    current.blocks?.push(block);
  }
  if ((current.blocks ?? []).length > 0) chapters.push(current);
  // A front matter of a few lines is a title page, not a chapter of its own.
  if (chapters.length > 1 && chapters[0].title === "Mở đầu" && (chapters[0].blocks ?? []).length < 3) {
    chapters[1].blocks = [...(chapters[0].blocks ?? []), ...(chapters[1].blocks ?? [])];
    chapters.shift();
  }
  return chapters;
}

// ------------------------------------------------------------------ sources

async function fetchText(target: string, init?: RequestInit): Promise<string> {
  const response = await fetch(target, { ...init, headers: { "User-Agent": UA, ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error(`source_${response.status}`);
  return await response.text();
}

async function gutenbergBook(id: string, row: CatalogRow): Promise<Book> {
  const base = `${MIRROR}/cache/epub/${id}/`;
  const html = await fetchText(`${base}pg${id}-images.html`);
  const { blocks, license } = toBlocks(html, {
    skip: (tag, attrs) => /\bclass\s*=\s*["'][^"']*\b(pagenum|toc|tnote)\b/i.test(attrs) && tag !== "body",
    license: (_tag, attrs) => /\bid\s*=\s*["']pg-(header|footer)["']/i.test(attrs),
    imageBase: base,
  });
  return {
    source: "gutenberg",
    sourceId: id,
    title: row.title,
    authors: row.authors,
    language: row.language,
    sourceUrl: `https://www.gutenberg.org/ebooks/${id}`,
    epubUrl: row.epub_url,
    license,
    chapters: intoChapters(blocks, row.title),
    fetchedAt: new Date().toISOString(),
  };
}

const WIKI_RULES: Rules = {
  skip: (_tag, attrs) =>
    !/licenseContainer/.test(attrs) &&
    /\bclass\s*=\s*["'][^"']*\b(ws-noexport|noprint|mw-editsection|reference|references|headertemplate|header-mainblock|toc|mw-references-wrap|navbox|licensetpl)\b/i.test(attrs),
  license: (_tag, attrs) => /\bclass\s*=\s*["'][^"']*\blicenseContainer\b/i.test(attrs),
  imageBase: null,
};

async function wikiParse(params: Record<string, string>): Promise<{ html: string; title: string }> {
  const body = new URLSearchParams({ action: "parse", format: "json", formatversion: "2", prop: "text", disablelimitreport: "1", disableeditsection: "1", maxlag: "5", ...params });
  const raw = await fetchText(WIKI_API, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  const data = JSON.parse(raw) as { parse?: { text?: string; title?: string }; error?: { code?: string } };
  if (data.parse?.text === undefined) throw new Error(`wiki_${data.error?.code ?? "parse"}`);
  return { html: data.parse.text, title: data.parse.title ?? "" };
}

/** Subpages a page links to (`Title/I`, `Title/1`…), in the order they appear. */
function subpagesOf(html: string, root: string): string[] {
  const seen: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\btitle="([^"]+)"/g)) {
    const title = decode(match[1]);
    if (title.startsWith(`${root}/`) && !title.slice(root.length + 1).includes("/") && !seen.includes(title)) seen.push(title);
  }
  return seen;
}

async function wikisourcePart(sourceId: string, part: number, subpages: readonly string[] | null): Promise<Block[]> {
  if (sourceId === BIBLE_ID) {
    const book = BIBLE_BOOKS[part];
    if (book === undefined) throw new Error("bad_part");
    const page = await wikiParse({ page: book });
    const chapters = subpagesOf(page.html, book);
    const text = chapters.map((title) => `\n\n== Đoạn ${title.slice(book.length + 1)} ==\n{{:${title}}}`).join("");
    const expanded = await wikiParse({ title: book, contentmodel: "wikitext", text });
    return toBlocks(expanded.html, WIKI_RULES).blocks;
  }
  const title = subpages?.[part];
  if (title === undefined) throw new Error("bad_part");
  return toBlocks((await wikiParse({ page: title })).html, WIKI_RULES).blocks;
}

async function wikisourceBook(sourceId: string, row: CatalogRow): Promise<{ book: Book; subpages: string[] | null }> {
  const root = await wikiParse({ page: sourceId });
  const { blocks, license } = toBlocks(root.html, WIKI_RULES);
  const base: Omit<Book, "chapters"> = {
    source: "wikisource",
    sourceId,
    title: row.title,
    authors: row.authors,
    language: row.language,
    sourceUrl: `https://vi.wikisource.org/wiki/${encodeURIComponent(sourceId.replace(/ /g, "_"))}`,
    epubUrl: null,
    license,
    fetchedAt: new Date().toISOString(),
  };
  if (sourceId === BIBLE_ID) {
    const first = await wikisourcePart(sourceId, 0, null);
    return { book: { ...base, chapters: BIBLE_BOOKS.map((title, index) => ({ title, blocks: index === 0 ? first : null })) }, subpages: null };
  }
  const subpages = subpagesOf(root.html, sourceId);
  if (subpages.length >= 2) {
    const first = await wikisourcePart(sourceId, 0, subpages);
    return {
      book: { ...base, chapters: subpages.map((title, index) => ({ title: title.slice(sourceId.length + 1), blocks: index === 0 ? first : null })) },
      subpages,
    };
  }
  return { book: { ...base, chapters: intoChapters(blocks, row.title) }, subpages: null };
}

// ------------------------------------------------------------------ cache

async function cacheKey(source: string, sourceId: string): Promise<string> {
  if (source === "gutenberg") return `${CACHE_VERSION}/gutenberg/${sourceId}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sourceId));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  return `${CACHE_VERSION}/wikisource/${hex}`;
}

type CatalogRow = { source: string; source_id: string; title: string; authors: string | null; language: string; epub_url: string | null };
type Db = ReturnType<typeof createClient>;

async function readCache<T>(db: Db, path: string): Promise<T | null> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || data === null) return null;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return null;
  }
}

async function writeCache(db: Db, path: string, value: unknown): Promise<void> {
  const body = new Blob([JSON.stringify(value)], { type: "application/json" });
  const { error } = await db.storage.from(BUCKET).upload(path, body, { upsert: true, contentType: "application/json" });
  if (error) console.error("book-text cache write failed", path, error.message);
}

// ------------------------------------------------------------------ handler

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method" });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (jwt === "") return json(401, { error: "auth" });
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data: userData, error: userError } = await asUser.auth.getUser(jwt);
  if (userError || userData.user === null) return json(401, { error: "auth" });
  const userId = userData.user.id;

  let body: { source?: unknown; source_id?: unknown; part?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "body" });
  }
  const source = body.source;
  const sourceId = typeof body.source_id === "string" ? body.source_id.trim() : "";
  const part = body.part === undefined || body.part === null ? null : Number(body.part);
  if ((source !== "gutenberg" && source !== "wikisource") || sourceId === "" || sourceId.length > 300) return json(400, { error: "body" });
  if (source === "gutenberg" && !/^\d{1,7}$/.test(sourceId)) return json(400, { error: "body" });
  if (part !== null && (!Number.isInteger(part) || part < 0 || part > 500)) return json(400, { error: "body" });

  // Read as the person: the catalogue's RLS (and the 67 session rule) decides what exists for them.
  const { data: row, error: rowError } = await asUser
    .from("book_catalog")
    .select("source, source_id, title, authors, language, epub_url")
    .eq("source", source)
    .eq("source_id", sourceId)
    .maybeSingle();
  if (rowError) return json(403, { error: "session" });
  if (row === null) return json(404, { error: "not_in_catalog" });

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await db.from("book_text_hits").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("at", since);
  if ((count ?? 0) >= HOURLY_LIMIT) return json(429, { error: "rate_limited" });
  await db.from("book_text_hits").insert({ user_id: userId });
  // Housekeeping: hits older than a day are no longer needed.
  void db.from("book_text_hits").delete().lt("at", new Date(Date.now() - 86_400_000).toISOString());

  const key = await cacheKey(source, sourceId);
  try {
    if (part !== null) {
      if (source !== "wikisource") return json(400, { error: "body" });
      const partPath = `${key}/part-${part}.json`;
      const cached = await readCache<Block[]>(db, partPath);
      if (cached !== null) return json(200, { part, blocks: cached });
      const meta = await readCache<{ subpages: string[] | null }>(db, `${key}/subpages.json`);
      const blocks = await wikisourcePart(sourceId, part, meta?.subpages ?? null);
      await writeCache(db, partPath, blocks);
      return json(200, { part, blocks });
    }

    const cached = await readCache<Book>(db, `${key}/index.json`);
    if (cached !== null) return json(200, cached);

    if (source === "gutenberg") {
      const book = await gutenbergBook(sourceId, row as CatalogRow);
      await writeCache(db, `${key}/index.json`, book);
      return json(200, book);
    }
    const { book, subpages } = await wikisourceBook(sourceId, row as CatalogRow);
    await writeCache(db, `${key}/subpages.json`, { subpages });
    await writeCache(db, `${key}/index.json`, book);
    if (book.chapters[0]?.blocks !== null && book.chapters.length > 1) await writeCache(db, `${key}/part-0.json`, book.chapters[0].blocks);
    return json(200, book);
  } catch (caught) {
    console.error("book-text source failed", source, sourceId, caught instanceof Error ? caught.message : String(caught));
    return json(502, { error: "source_failed" });
  }
});
