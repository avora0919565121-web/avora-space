import { supabase } from "@/integrations/supabase/client";
import { hubFail } from "@/lib/think-hub";

/**
 * AVORA-77 · D2 — the open library. Only lawful public-domain sources: Project Gutenberg's own
 * catalogue file (imported once, never scraped) and Vietnamese Wikisource pages checked one by one.
 */
export type BookSource = "gutenberg" | "wikisource" | "openlibrary";

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
  { id: "thieu_nhi", label: "Thiếu nhi" },
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
};

export function sourceOf(value: string): BookSource {
  return value === "wikisource" ? "wikisource" : value === "openlibrary" ? "openlibrary" : "gutenberg";
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
  };
}

/** The public URL of a cover Avora keeps — the browser never asks Gutenberg / Open Library itself. */
export function coverUrl(path: string | null | undefined): string | null {
  if (path == null || !/^(gutenberg|openlibrary)\/[A-Za-z0-9]{1,20}\.webp$/.test(path)) return null;
  return `${import.meta.env.EXPO_PUBLIC_SUPABASE_URL as string}/storage/v1/object/public/book-covers/${path}`;
}

/** Where a cover came from, in small print on the book's page. */
export function coverCredit(source: BookSource, hasCover: boolean): string | null {
  if (!hasCover) return null;
  return source === "gutenberg" ? "Bìa: Project Gutenberg" : source === "openlibrary" ? "Bìa: Open Library" : null;
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
  return source === "gutenberg" ? "Gutenberg" : source === "openlibrary" ? "Open Library" : "Wikisource";
}

/** The source line on a book's page (AVORA-103 · B). */
export function sourceLine(source: BookSource): string {
  if (source === "openlibrary") return "Open Library / Internet Archive · Phạm vi công cộng";
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
