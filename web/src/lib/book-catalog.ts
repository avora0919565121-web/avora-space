import { supabase } from "@/integrations/supabase/client";
import { hubFail } from "@/lib/think-hub";

/**
 * AVORA-77 · D2 — the open library. Only lawful public-domain sources: Project Gutenberg's own
 * catalogue file (imported once, never scraped) and Vietnamese Wikisource pages checked one by one.
 */
export type BookSource = "gutenberg" | "wikisource" | "openlibrary" | "gdl";

export type BookCategory = "van_hoc" | "triet_hoc" | "kinh_thanh" | "lich_su" | "khoa_hoc" | "kinh_te" | "tho" | "thieu_nhi" | "khac";

/** The one source of the category words (D2). Mapping from Gutenberg's Bookshelves / Subjects lives in the import. */
export const BOOK_CATEGORIES: readonly { id: BookCategory; label: string }[] = [
  { id: "van_hoc", label: "Văn học" },
  { id: "triet_hoc", label: "Triết học" },
  { id: "kinh_thanh", label: "Kinh Thánh" },
  { id: "lich_su", label: "Lịch sử" },
  { id: "khoa_hoc", label: "Khoa học" },
  { id: "kinh_te", label: "Kinh tế" },
  { id: "tho", label: "Thơ" },
  // AVORA-100 · S.2 §4.4 D: one chip for both ages; the two ages are chips inside it.
  { id: "thieu_nhi", label: "Thiếu nhi · Thiếu niên" },
  { id: "khac", label: "Khác" },
];

export function categoryLabel(id: string): string {
  return BOOK_CATEGORIES.find((item) => item.id === id)?.label ?? "Khác";
}

/**
 * How Gutenberg's `Bookshelves` / `Subjects` become an Avora category — first match wins.
 * Kept here so the report and the import read the same table.
 */
export const GUTENBERG_CATEGORY_MAP: readonly { category: BookCategory; from: string }[] = [
  { category: "kinh_thanh", from: "Subject chứa “Bible”, hoặc tên sách là “The Holy Bible / La Bible”" },
  { category: "thieu_nhi", from: "Category: Children & Young Adult Reading · Subject “juvenile”, “children's”" },
  { category: "tho", from: "Category: Poetry" },
  { category: "triet_hoc", from: "Category: Philosophy & Ethics" },
  { category: "kinh_te", from: "Category: Economics · Business/Management" },
  { category: "khoa_hoc", from: "Category: Science - * · Mathematics · Engineering & Technology · Health & Medicine · Psychiatry/Psychology · Research Methods" },
  { category: "van_hoc", from: "Category: Novels · Short Stories · * Literature · Classics · Plays · Humour · Adventure · Romance · Crime · Science-Fiction · Historical Novels · Essays · Mythology · Subject “fiction”" },
  { category: "lich_su", from: "Category: History - * · Biographies · Archaeology & Anthropology · Subject “history”" },
  { category: "khac", from: "Không khớp mục nào ở trên" },
];

/** Vietnamese Wikisource pages checked one by one: the page exists and carries `PD-old` (D2). */
export const WIKISOURCE_TITLES: readonly { id: string; title: string; note: string }[] = [
  { id: "Truyện Kiều", title: "Truyện Kiều", note: "Nguyễn Du · PD-old" },
  { id: "Lục Vân Tiên (bản Quốc ngữ 2082 câu)", title: "Lục Vân Tiên", note: "Nguyễn Đình Chiểu · PD-old" },
  { id: "Chinh phụ ngâm", title: "Chinh phụ ngâm", note: "Đặng Trần Côn, Đoàn Thị Điểm dịch · PD-old" },
  { id: "Cung oán ngâm khúc (bản phổ biến)", title: "Cung oán ngâm khúc", note: "Nguyễn Gia Thiều · PD-old" },
  { id: "Gia huấn ca", title: "Gia huấn ca", note: "Tương truyền Nguyễn Trãi · PD-old" },
  { id: "Bình Ngô đại cáo", title: "Bình Ngô đại cáo", note: "Nguyễn Trãi · PD-old" },
  { id: "Nam quốc sơn hà", title: "Nam quốc sơn hà", note: "Tương truyền Lý Thường Kiệt · PD-old" },
  { id: "Kinh Thánh Cựu Ước và Tân Ước 1925", title: "Kinh Thánh (bản Truyền thống 1925)", note: "Phan Khôi và cộng sự dịch · 66 sách, mỗi sách PD-old · PVCC-Việt Nam" },
];

export type CatalogBook = {
  source: BookSource;
  sourceId: string;
  title: string;
  authors: string | null;
  language: "en" | "vi" | "fr";
  category: BookCategory;
  epubUrl: string | null;
  /** C7: the Vietnamese title — `xuat_ban` (a printed edition, certain) or `tam_dich` (Avora's). */
  titleVi: string | null;
  titleViKind: "xuat_ban" | "tam_dich" | null;
  /** AVORA-103 · C: the cover Avora keeps (`book-covers/…`), null = none yet / draw our own. */
  coverPath: string | null;
  /** AVORA-103 · A: `borrow` = still in copyright on Open Library — a link only, never read here. */
  access: "read" | "borrow";
  /** AVORA-100 · §4.4 C: who made an open-licence picture book, and under which licence. */
  credits: BookCredits | null;
};

/** The attribution an open licence asks for (author · illustrator · translator · publisher · licence + link). */
export type BookCredits = {
  license: string;
  link: string | null;
  publisher: string | null;
  authors: string[];
  illustrators: string[];
  translators: string[];
};

type CatalogRow = {
  source: string;
  source_id: string;
  title: string;
  authors: string | null;
  language: string;
  category: string;
  epub_url: string | null;
  title_vi?: string | null;
  title_vi_kind?: string | null;
  cover_path?: string | null;
  access?: string | null;
  credits?: unknown;
};

export function sourceOf(value: string): BookSource {
  return value === "wikisource" ? "wikisource" : value === "openlibrary" ? "openlibrary" : value === "gdl" ? "gdl" : "gutenberg";
}

function toBook(row: CatalogRow): CatalogBook {
  return {
    source: sourceOf(row.source),
    sourceId: row.source_id,
    title: row.title,
    authors: row.authors,
    language: row.language === "vi" ? "vi" : row.language === "fr" ? "fr" : "en",
    category: (BOOK_CATEGORIES.some((item) => item.id === row.category) ? row.category : "khac") as BookCategory,
    epubUrl: row.epub_url,
    titleVi: row.title_vi ?? null,
    titleViKind: row.title_vi_kind === "xuat_ban" || row.title_vi_kind === "tam_dich" ? row.title_vi_kind : null,
    coverPath: row.cover_path ?? null,
    access: row.access === "borrow" ? "borrow" : "read",
    credits: parseCredits(row.credits),
  };
}

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
}

export function parseCredits(raw: unknown): BookCredits | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.license !== "string") return null;
  return {
    license: r.license,
    link: typeof r.link === "string" ? r.link : null,
    publisher: typeof r.publisher === "string" && r.publisher.trim() !== "" ? r.publisher : null,
    authors: names(r.authors),
    illustrators: names(r.illustrators),
    translators: names(r.translators),
  };
}

/** The credit lines shown on a picture book's page and its first page. */
export function creditLines(credits: BookCredits): string[] {
  const lines: string[] = [];
  if (credits.authors.length > 0) lines.push(`Tác giả: ${credits.authors.join(", ")}`);
  if (credits.illustrators.length > 0) lines.push(`Hoạ sĩ: ${credits.illustrators.join(", ")}`);
  if (credits.translators.length > 0) lines.push(`Dịch: ${credits.translators.join(", ")}`);
  if (credits.publisher !== null) lines.push(`Nhà xuất bản: ${credits.publisher}`);
  lines.push("Nguồn: Global Digital Library");
  lines.push(`Giấy phép: ${credits.license === "CC-BY-SA-4.0" ? "CC BY-SA 4.0" : "CC BY 4.0"}`);
  return lines;
}

/**
 * AVORA-100 · S.2 §4.4 — Tủ sách tuổi thơ: a hand-picked shelf inside `Thiếu nhi · Thiếu niên`.
 * Every entry passed the AVORA-103 rule (authors and translators died ≤ 1955, or an open licence);
 * Vietnamese Wikisource pages were opened and checked one by one (see the migration's notes).
 * No scores, no badges, no streaks.
 */
export type ChildrenAge = "thieu_nhi" | "thieu_nien";
export const CHILDREN_AGES: readonly { id: ChildrenAge; label: string }[] = [
  { id: "thieu_nhi", label: "Thiếu nhi" },
  { id: "thieu_nien", label: "Thiếu niên" },
];

export const CHILDREN_SHELF: readonly { key: string; age: ChildrenAge }[] = [
  // Thiếu nhi — tiếng Việt trước.
  { key: "wikisource:Thơ ngụ ngôn La Fontaine (1951)", age: "thieu_nhi" },
  { key: "wikisource:Chuyện trẻ con", age: "thieu_nhi" },
  { key: "wikisource:Đeo nhạc cho mèo", age: "thieu_nhi" },
  { key: "wikisource:Biên dịch:Cô bé Lọ Lem", age: "thieu_nhi" },
  { key: "gutenberg:11", age: "thieu_nhi" },
  { key: "gutenberg:27200", age: "thieu_nhi" },
  { key: "gutenberg:2591", age: "thieu_nhi" },
  { key: "gutenberg:18732", age: "thieu_nhi" },
  { key: "gutenberg:16", age: "thieu_nhi" },
  { key: "gutenberg:16865", age: "thieu_nhi" },
  { key: "gutenberg:55", age: "thieu_nhi" },
  { key: "gutenberg:289", age: "thieu_nhi" },
  { key: "gutenberg:236", age: "thieu_nhi" },
  { key: "gutenberg:11757", age: "thieu_nhi" },
  // Thiếu niên.
  { key: "wikisource:Nam Hải dị nhân liệt truyện", age: "thieu_nien" },
  { key: "gutenberg:113", age: "thieu_nien" },
  { key: "gutenberg:514", age: "thieu_nien" },
  { key: "gutenberg:45", age: "thieu_nien" },
  { key: "gutenberg:120", age: "thieu_nien" },
  { key: "gutenberg:521", age: "thieu_nien" },
  { key: "gutenberg:74", age: "thieu_nien" },
  { key: "gutenberg:271", age: "thieu_nien" },
  { key: "gutenberg:1450", age: "thieu_nien" },
  { key: "gutenberg:146", age: "thieu_nien" },
  { key: "gutenberg:164", age: "thieu_nien" },
  { key: "gutenberg:103", age: "thieu_nien" },
  { key: "gutenberg:46", age: "thieu_nien" },
  { key: "gutenberg:11703", age: "thieu_nien" },
  { key: "gutenberg:829", age: "thieu_nien" },
];

/** Not on the shelf, on purpose: still in copyright in many countries. */
export const CHILDREN_SHELF_EXCLUDED: readonly string[] = ["Le Petit Prince / Hoàng tử bé"];

export type ChildrenShelf = { thieu_nhi: CatalogBook[]; thieu_nien: CatalogBook[]; tranh: CatalogBook[] };

/** The shelf in its own order (only books the catalogue still marks readable), plus the picture books. */
export async function fetchChildrenShelf(): Promise<ChildrenShelf> {
  const bySource = (source: BookSource): string[] => CHILDREN_SHELF.filter((e) => e.key.startsWith(`${source}:`)).map((e) => e.key.slice(source.length + 1));
  const columns = "source, source_id, title, authors, language, category, epub_url, title_vi, title_vi_kind, cover_path, access, credits, pd_status";
  const [g, w, t] = await Promise.all([
    supabase.from("book_catalog").select(columns as never).eq("source", "gutenberg").in("source_id", bySource("gutenberg")),
    supabase.from("book_catalog").select(columns as never).eq("source", "wikisource").in("source_id", bySource("wikisource")),
    supabase.from("book_catalog").select(columns as never).eq("source", "gdl").eq("pd_status" as never, "ok" as never).order("title").limit(60),
  ]);
  const error = g.error ?? w.error ?? t.error;
  if (error) throw hubFail(error.code, error.message);
  const rows = [...((g.data ?? []) as unknown as (CatalogRow & { pd_status: string })[]), ...((w.data ?? []) as unknown as (CatalogRow & { pd_status: string })[])];
  const found = new Map(rows.filter((r) => r.pd_status === "ok").map((r) => [`${r.source}:${r.source_id}`, toBook(r)]));
  const pick = (age: ChildrenAge): CatalogBook[] =>
    CHILDREN_SHELF.filter((e) => e.age === age).map((e) => found.get(e.key)).filter((b): b is CatalogBook => b !== undefined);
  return { thieu_nhi: pick("thieu_nhi"), thieu_nien: pick("thieu_nien"), tranh: ((t.data ?? []) as unknown as CatalogRow[]).map(toBook) };
}

/** The public URL of a cover Avora keeps — the browser never asks Gutenberg / Open Library itself. */
export function coverUrl(path: string | null | undefined): string | null {
  if (path == null || !/^(gutenberg|openlibrary|gdl)\/[A-Za-z0-9]{1,20}\.webp$/.test(path)) return null;
  return `${import.meta.env.EXPO_PUBLIC_SUPABASE_URL as string}/storage/v1/object/public/book-covers/${path}`;
}

/** Where a cover came from, in small print on the book's page. */
export function coverCredit(source: BookSource, hasCover: boolean): string | null {
  if (!hasCover) return null;
  return source === "gutenberg" ? "Bìa: Project Gutenberg" : source === "openlibrary" ? "Bìa: Open Library" : source === "gdl" ? "Bìa: Global Digital Library (CC BY)" : null;
}

/** C7 · how a catalogue title reads: Vietnamese first, the original always kept under it. */
export function bookTitleLines(book: Pick<CatalogBook, "title" | "titleVi" | "titleViKind" | "language">): { main: string; original: string | null; tentative: boolean } {
  if (book.titleVi === null || book.titleVi.trim() === "" || book.language === "vi" || book.titleVi === book.title) return { main: book.title, original: null, tentative: false };
  return { main: book.titleVi, original: book.title, tentative: book.titleViKind === "tam_dich" };
}

/**
 * AVORA-89 · 1.2.5 — adult titles stay findable by name but never appear in a browse (no query)
 * nor on the children's shelf.
 */
export const ADULT_BOOK_IDS: ReadonlySet<string> = new Set<string>(["gutenberg:27827"]);

/** Hides adult titles when the reader is browsing rather than searching for them by name. */
export function withoutAdultInBrowse<T extends Pick<CatalogBook, "source" | "sourceId">>(books: readonly T[], query: string): T[] {
  if (query.trim() !== "") return [...books];
  return books.filter((book) => !ADULT_BOOK_IDS.has(`${book.source}:${book.sourceId}`));
}

export const bookCatalogKeys = {
  search: (query: string, category: string | null, source: string | null) => ["book-catalog", query, category, source] as const,
};

/** Accent-free search on the server (trigram index). Empty query + a category = a browse. */
export async function searchCatalog(query: string, category: BookCategory | null, source: BookSource | null = null): Promise<CatalogBook[]> {
  const { data, error } = await supabase.rpc("search_book_catalog", {
    p_query: query,
    p_category: category ?? undefined,
    p_source: source ?? undefined,
    p_limit: 30,
  });
  if (error) throw hubFail(error.code, error.message);
  return ((data ?? []) as CatalogRow[]).map(toBook);
}

/** The link a book on the shelf keeps: where it can be read in the original. */
export function catalogLink(book: Pick<CatalogBook, "source" | "sourceId">): string {
  if (book.source === "openlibrary") return `https://openlibrary.org/books/${book.sourceId}`;
  if (book.source === "gdl") return `https://content.digitallibrary.io/?p=${book.sourceId}`;
  return book.source === "gutenberg"
    ? `https://www.gutenberg.org/ebooks/${book.sourceId}`
    : `https://vi.wikisource.org/wiki/${encodeURIComponent(book.sourceId.replace(/ /g, "_"))}`;
}

/**
 * A borrow-only Open Library title keeps a plain link (like Kindle): `…/books/OL…M/borrow` never
 * reads back as a catalogue reference, so the shelf only offers `Mở trên Open Library ↗`.
 */
export function borrowLink(book: Pick<CatalogBook, "sourceId">): string {
  return `https://openlibrary.org/books/${book.sourceId}/borrow`;
}

/** Reads a shelf link back into a catalogue reference — only links Avora itself wrote. */
export function catalogRefOf(link: string | null | undefined): { source: BookSource; sourceId: string } | null {
  if (link == null) return null;
  const gutenberg = link.match(/^https:\/\/www\.gutenberg\.org\/ebooks\/(\d{1,7})$/);
  if (gutenberg !== null) return { source: "gutenberg", sourceId: gutenberg[1] };
  const openLibrary = link.match(/^https:\/\/openlibrary\.org\/books\/(OL\d{1,10}M)$/);
  if (openLibrary !== null) return { source: "openlibrary", sourceId: openLibrary[1] };
  const gdl = link.match(/^https:\/\/content\.digitallibrary\.io\/\?p=(\d{1,9})$/);
  if (gdl !== null) return { source: "gdl", sourceId: gdl[1] };
  const wiki = link.match(/^https:\/\/vi\.wikisource\.org\/wiki\/(.+)$/);
  if (wiki !== null) {
    try {
      return { source: "wikisource", sourceId: decodeURIComponent(wiki[1]).replace(/_/g, " ") };
    } catch {
      return null;
    }
  }
  return null;
}

/** A borrow-only Open Library link written by Avora → its catalogue key (for `Trên kệ`). */
export function borrowKeyOf(link: string | null | undefined): string | null {
  const match = link?.match(/^https:\/\/openlibrary\.org\/books\/(OL\d{1,10}M)\/borrow$/) ?? null;
  return match === null ? null : `openlibrary:${match[1]}`;
}

/** The EPUB of a Gutenberg book, from the official mirror. Wikisource has none here. */
export function epubOf(ref: { source: BookSource; sourceId: string } | null): string | null {
  if (ref === null || ref.source !== "gutenberg") return null;
  return `https://gutenberg.pglaf.org/cache/epub/${ref.sourceId}/pg${ref.sourceId}-images-3.epub`;
}

export function sourceLabel(source: BookSource): string {
  return source === "gutenberg" ? "Gutenberg" : source === "openlibrary" ? "Open Library" : source === "gdl" ? "Sách tranh GDL" : "Wikisource";
}

/** The source line on a book's page (AVORA-103 · B). */
export function sourceLine(source: BookSource): string {
  if (source === "openlibrary") return "Open Library / Internet Archive · Phạm vi công cộng";
  if (source === "gdl") return "Global Digital Library · giấy phép mở (CC BY)";
  return source === "gutenberg" ? "Project Gutenberg" : "Wikisource tiếng Việt";
}

export type ShelfCatalogInfo = {
  key: string;
  title: string;
  titleVi: string | null;
  language: string;
  coverPath: string | null;
  coverChecked: boolean;
  pdStatus: "ok" | "recent" | "unknown";
  access: "read" | "borrow";
};

/** Covers + rights of the books on a shelf, one call (AVORA-103). */
export async function fetchShelfCatalog(keys: readonly string[]): Promise<Map<string, ShelfCatalogInfo>> {
  const out = new Map<string, ShelfCatalogInfo>();
  if (keys.length === 0) return out;
  const { data, error } = await supabase.rpc("book_catalog_covers" as never, { p_refs: [...keys].slice(0, 200) } as never);
  if (error) throw hubFail(error.code, error.message);
  type Row = { source: string; source_id: string; title: string; title_vi: string | null; language: string; cover_path: string | null; cover_checked: boolean; pd_status: string; access: string };
  for (const row of (data ?? []) as Row[]) {
    const key = `${row.source}:${row.source_id}`;
    out.set(key, {
      key,
      title: row.title,
      titleVi: row.title_vi,
      language: row.language,
      coverPath: row.cover_path,
      coverChecked: row.cover_checked,
      pdStatus: row.pd_status === "ok" ? "ok" : row.pd_status === "recent" ? "recent" : "unknown",
      access: row.access === "borrow" ? "borrow" : "read",
    });
  }
  return out;
}

/** Asks Avora to fetch one cover it does not have yet (once per book, for everyone). */
export async function requestCover(source: BookSource, sourceId: string): Promise<string | null> {
  if (source === "wikisource") return null;
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (token === undefined) return null;
  try {
    const response = await fetch(`${import.meta.env.EXPO_PUBLIC_SUPABASE_URL as string}/functions/v1/book-cover`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string, "Content-Type": "application/json" },
      body: JSON.stringify({ source, source_id: sourceId }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { cover_path?: string | null };
    return body.cover_path ?? null;
  } catch {
    return null;
  }
}

export const LANGUAGE_NAMES: Readonly<Record<string, string>> = { en: "tiếng Anh", fr: "tiếng Pháp", vi: "tiếng Việt" };
