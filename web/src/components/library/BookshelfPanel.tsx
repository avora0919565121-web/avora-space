import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, Download, ExternalLink, Library, Loader2, NotebookText, Plus, Search, Star, Table2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { askText } from "@/components/ConfirmHost";
import { DateField } from "@/components/calendar/DateField";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { findJournal } from "@/hooks/use-paste-task";
import { useAuth } from "@/lib/auth";
import {
  BOOK_CATEGORIES,
  catalogLink,
  catalogRefOf,
  epubOf,
  LANGUAGE_NAMES,
  searchCatalog,
  sourceLabel,
  type BookCategory,
  type BookSource,
  bookTitleLines,
  withoutAdultInBrowse,
  type CatalogBook,
} from "@/lib/book-catalog";
import { ensureJournalConversation } from "@/lib/chat";
import { coverColor } from "@/lib/library";
import { normalizeSearch } from "@/lib/normalize-search";
import { noteDisplayTitle } from "@/lib/notes";
import { booksOnDevice, fetchAllReadingStates, removeFromDevice, type ReadingState } from "@/lib/reading-state";
import { translateTitleOnDevice } from "@/lib/reader-settings";
import { hereFrom, withReturn } from "@/lib/return-to";
import { recordsOf, scopeOfTable, todayIso, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";
import { useConversations } from "@/lib/use-conversations";
import { useNotes } from "@/lib/use-notes";
import { useThinkHub, useThinkHubActions } from "@/lib/use-think-hub";
import { useShelfActions, useStars } from "@/lib/use-think-hub-shelf";
import { cn } from "@/lib/utils";

/** Shelves in reading order (C6): what is being read first, what was finished last. */
export const TIERS: readonly { key: string; label: string }[] = [
  { key: "dang_doc", label: "Đang đọc" },
  { key: "muon_doc", label: "Muốn đọc" },
  { key: "doc_lai", label: "Đọc lại" },
  { key: "da_doc", label: "Đã đọc" },
];

/** Where a book I already own is read (D1). */
const OWN_SOURCES: readonly string[] = ["Kindle", "Sách giấy", "PDF", "Khác"];

/** "40%", "40 %" or "trang 40/100" → 0.4; anything else has no bar. */
export function readingProgress(position: string | null | undefined): number | null {
  if (position == null) return null;
  const percent = position.match(/(\d{1,3})\s*%/);
  if (percent !== null) return Math.min(100, Number(percent[1])) / 100;
  const pages = position.match(/(\d+)\s*\/\s*(\d+)/);
  if (pages !== null && Number(pages[2]) > 0) return Math.min(1, Number(pages[1]) / Number(pages[2]));
  return null;
}

function columnKey(table: ThinkTable | null, label: string): string | null {
  return table?.columns.find((column) => column.label === label)?.key ?? null;
}

function addDays(days: number): string {
  const date = new Date(`${todayIso()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** `Bạn giữ lại điều gì?` is asked once per book, the first time it reaches Đã đọc (D5). */
const ASKED_KEY = "avora.book-lesson-asked.v1";
function wasLessonAsked(recordId: string): boolean {
  try {
    return (window.localStorage.getItem(ASKED_KEY) ?? "").split(",").includes(recordId);
  } catch {
    return false;
  }
}
function markLessonAsked(recordId: string): void {
  try {
    const list = (window.localStorage.getItem(ASKED_KEY) ?? "").split(",").filter((id) => id !== "");
    window.localStorage.setItem(ASKED_KEY, [...list.slice(-500), recordId].join(","));
  } catch {
    // Asking twice is the worst that can happen.
  }
}

export function useBookshelf() {
  const { tables, records, isPending } = useThinkHub();
  const shelf: ThinkTable | null = useMemo(() => tables.find((table) => table.kind === "bookshelf") ?? null, [tables]);
  const keys = useMemo(
    () => ({
      author: columnKey(shelf, "Tác giả"),
      source: columnKey(shelf, "Nguồn"),
      link: columnKey(shelf, "Link"),
      position: columnKey(shelf, "Đang ở"),
      lesson: columnKey(shelf, "Bài học chính"),
    }),
    [shelf],
  );
  const books: ThinkRecord[] = useMemo(() => (shelf === null ? [] : recordsOf(records, shelf.id)), [records, shelf]);
  const field = (book: ThinkRecord, key: string | null): string => (key === null ? "" : String(book.extensionFields[key] ?? ""));
  return { shelf, keys, books, field, isPending };
}

/**
 * Kệ 04 · Kệ sách (AVORA-77 · D1): Đọc tiếp, the four tiers as spines on a shelf line, and the open
 * library (Wikisource in Vietnamese, Project Gutenberg). Books from the open library read inside
 * Avora; books I already own keep only their link.
 */
export function BookshelfPanel({ addRequest }: { addRequest: number }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const actions = useThinkHubActions();
  const { bookshelf, star } = useShelfActions();
  const stars = useStars();
  const { shelf, keys, books, field, isPending } = useBookshelf();
  const askedRef = useRef<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [isShelfSearchOpen, setIsShelfSearchOpen] = useState<boolean>(false);
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const { data: conversations } = useConversations();
  const notesData = useNotes();
  const states = useQuery<ReadingState[], Error>({ queryKey: ["book-reading-state", "all"], queryFn: fetchAllReadingStates, enabled: Boolean(user?.id), staleTime: 30_000 });

  useEffect(() => {
    const wanted = searchParams.get("sach");
    if (wanted !== null) setOpenId(wanted);
  }, [searchParams]);
  useEffect(() => {
    if (addRequest > 0) setIsAdding(true);
  }, [addRequest]);
  useEffect(() => {
    if (isPending || shelf !== null || askedRef.current) return;
    askedRef.current = true;
    bookshelf.mutate();
  }, [isPending, shelf, bookshelf]);

  const here = hereFrom(location, "Kế hoạch");
  const openNotes = async (params: string): Promise<void> => {
    try {
      const journalId = findJournal(conversations)?.conversationId ?? (await ensureJournalConversation());
      navigate(withReturn(`/tin-nhan/${journalId}?xem=ghi-chep&${params}`, here));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Chưa mở được Ghi chép.");
    }
  };
  const read = (book: ThinkRecord): void => navigate(withReturn(`/ke-hoach/ke-sach/doc/${book.id}`, here));

  const filtered = useMemo(() => {
    const needle = normalizeSearch(query);
    if (needle === "") return books;
    return books.filter((book) => normalizeSearch(`${book.title} ${field(book, keys.author)}`).includes(needle));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- field reads keys
  }, [books, query, keys.author]);
  const opened = books.find((book) => book.id === openId) ?? null;
  const notesOf = (bookId: string) => notesData.liveNotes.filter((note) => note.bookRecordId === bookId);
  const bookNotes = opened === null ? [] : notesOf(opened.id);

  /** Đọc tiếp: the book on Đang đọc opened most recently (any device), else the latest touched. */
  const continueBook: ThinkRecord | null = useMemo(() => {
    const reading = books.filter((book) => book.status === "dang_doc");
    if (reading.length === 0) return null;
    const at = new Map((states.data ?? []).map((state) => [state.recordId, state.updatedAt] as const));
    return [...reading].sort((a, b) => (at.get(b.id) ?? b.updatedAt).localeCompare(at.get(a.id) ?? a.updatedAt))[0];
  }, [books, states.data]);

  const pinnedAt = useMemo(
    () => new Map((states.data ?? []).filter((state) => state.pinnedAt != null).map((state) => [state.recordId, state.pinnedAt as string] as const)),
    [states.data],
  );
  const onDevice = useQuery({ queryKey: ["books-on-device"], queryFn: booksOnDevice, staleTime: 10_000 });
  const deviceKeys = useMemo(() => new Set((onDevice.data ?? []).filter((item) => item.complete).map((item) => item.key)), [onDevice.data]);
  const catalogKeyOf = (book: ThinkRecord): string => {
    const ref = catalogRefOf(field(book, keys.link));
    return ref === null ? "" : `${ref.source}:${ref.sourceId}`;
  };

  const onShelf = useMemo(() => {
    const set = new Set<string>();
    for (const book of books) {
      const ref = catalogRefOf(field(book, keys.link));
      if (ref !== null) set.add(`${ref.source}:${ref.sourceId}`);
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- field reads keys
  }, [books, keys.link]);

  const patchField = (book: ThinkRecord, key: string | null, value: string): void => {
    if (key === null) return;
    actions.updateRecord(book.id, { extensionFields: { ...book.extensionFields, [key]: value.trim() === "" ? null : value.trim() } }).catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Không lưu được."),
    );
  };

  /** D5: reaching Đã đọc asks once, into the `Bài học chính` that is already there. */
  const setTier = async (book: ThinkRecord, tier: string): Promise<void> => {
    try {
      await actions.updateRecord(book.id, { status: tier });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được.");
      return;
    }
    if (tier !== "da_doc" || keys.lesson === null || field(book, keys.lesson) !== "" || wasLessonAsked(book.id)) return;
    markLessonAsked(book.id);
    const lesson = await askText({ title: "Bạn giữ lại điều gì?", body: book.title, confirmLabel: "Lưu", cancelLabel: "Để sau", maxLength: 500, placeholder: "Một điều bạn sẽ đem ra dùng" });
    if (lesson === null) return;
    patchField({ ...book, status: tier }, keys.lesson, lesson);
    toast.success("Đã lưu vào Bài học chính.");
  };

  const addFromCatalog = async (item: CatalogBook): Promise<void> => {
    if (shelf === null) return;
    const extensionFields: Record<string, string> = {};
    if (keys.author !== null && item.authors !== null) extensionFields[keys.author] = item.authors.slice(0, 200);
    if (keys.source !== null) extensionFields[keys.source] = sourceLabel(item.source);
    if (keys.link !== null) extensionFields[keys.link] = catalogLink(item);
    // C7: the book goes on the shelf under its Vietnamese title when there is one; the original stays in Link.
    await actions.createRecord({ tableId: shelf.id, scope: scopeOfTable(shelf), title: bookTitleLines(item).main.slice(0, 200), status: "muon_doc", extensionFields });
    toast.success("Đã thêm vào tầng Muốn đọc.");
  };

  if (isPending || shelf === null) {
    return (
      <div className="flex min-h-[160px] items-center justify-center" data-shelf-panel="ke-sach">
        {bookshelf.isError ? (
          <div className="text-center">
            <p role="alert" className="text-[15px] text-muted-foreground">Không tải được Kệ sách.</p>
            <button type="button" onClick={() => bookshelf.mutate()} className="press mt-4 min-h-11 rounded-md border border-border bg-card px-5 text-[14px] font-medium hover:bg-secondary">
              Thử lại
            </button>
          </div>
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        )}
      </div>
    );
  }

  const continueRef = continueBook === null ? null : catalogRefOf(field(continueBook, keys.link));
  const continueProgress = continueBook === null ? null : readingProgress(field(continueBook, keys.position));

  return (
    <div data-shelf-panel="ke-sach">
      {continueBook !== null ? (
        <section aria-label="Đọc tiếp" data-continue-reading="" className="mb-6 flex gap-4 rounded-2xl border border-border bg-card p-4">
          <span className="relative flex aspect-[2/3] w-[78px] shrink-0 flex-col justify-end overflow-hidden rounded-md p-2 shadow-sm ring-1 ring-black/10" style={{ backgroundColor: coverColor(continueBook.title) }}>
            <span className="line-clamp-3 text-[11px] font-semibold leading-tight text-white">{continueBook.title}</span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Đọc tiếp</p>
            <p className="mt-0.5 truncate text-[16px] font-semibold text-foreground">{continueBook.title}</p>
            <p className="truncate text-[13px] text-muted-foreground">{[field(continueBook, keys.author), field(continueBook, keys.position)].filter((part) => part !== "").join(" · ")}</p>
            {continueProgress !== null ? (
              <span className="mt-2 block h-1.5 max-w-[280px] overflow-hidden rounded-full bg-secondary">
                <span className="block h-full rounded-full bg-personal transition-[width] duration-700" style={{ width: `${Math.round(continueProgress * 100)}%` }} />
              </span>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {continueRef !== null ? (
                <button type="button" onClick={() => read(continueBook)} className="press inline-flex h-10 items-center gap-1.5 rounded-lg bg-personal px-4 text-[13.5px] font-semibold text-personal-foreground">
                  <BookOpen className="h-4 w-4" aria-hidden="true" /> Đọc tiếp
                </button>
              ) : field(continueBook, keys.link) !== "" ? (
                <a href={field(continueBook, keys.link)} target="_blank" rel="noreferrer noopener" className="press inline-flex h-10 items-center gap-1.5 rounded-lg bg-personal px-4 text-[13.5px] font-semibold text-personal-foreground">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" /> Mở link
                </a>
              ) : null}
              <button type="button" onClick={() => void openNotes(`sach=${encodeURIComponent(continueBook.id)}&ten=${encodeURIComponent(continueBook.title)}`)} className="press inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-[13.5px]">
                <NotebookText className="h-4 w-4" aria-hidden="true" /> Ghi chép sách {notesOf(continueBook.id).length}
              </button>
              {epubOf(continueRef) !== null ? (
                <a href={epubOf(continueRef) ?? undefined} className="press inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-[13.5px]">
                  <Download className="h-4 w-4" aria-hidden="true" /> Mở bằng app đọc trên máy
                </a>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <OnDeviceLine />
      {/* AVORA-93 · 3.4: an empty shelf has nothing to search; with books, 🔍 opens the box (kept open while it holds words). */}
      <div className="flex items-center gap-2" data-shelf-tools="">
        <button type="button" onClick={() => setIsAdding(true)} className="press inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-[13.5px] md:flex-none">
          <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /> <span className="truncate">Thêm sách tôi đang có</span>
        </button>
        {books.length > 0 ? (
          <button type="button" onClick={() => setIsShelfSearchOpen((open) => !open || query.trim() !== "")} aria-label="Tìm sách trên kệ" aria-expanded={isShelfSearchOpen || query.trim() !== ""} data-shelf-search-toggle="" className="icon-btn h-10 w-10">
            <Search className="h-[17px] w-[17px]" aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" onClick={() => navigate(`/ke-hoach?ke=ke-sach&bang=${shelf.id}`)} aria-label="Xem dạng bảng" title="Xem dạng bảng" className="icon-btn h-10 w-10">
          <Table2 className="h-[17px] w-[17px]" aria-hidden="true" />
        </button>
      </div>
      {books.length > 0 && (isShelfSearchOpen || query.trim() !== "") ? (
        <label className="mt-2 flex h-10 min-w-0 items-center gap-2 rounded-md border border-border bg-card px-3" data-shelf-search="">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm trên kệ của bạn…" aria-label="Tìm sách trên kệ" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none md:text-[14.5px]" />
        </label>
      ) : null}

      {books.length === 0 ? (
        <div className="mt-6 flex flex-col items-center text-center">
          <Library className="h-9 w-9 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-[15px] font-medium text-foreground">Kệ còn trống — chọn một cuốn ở Thư viện mở bên dưới.</p>
        </div>
      ) : filtered.length === 0 && query.trim() !== "" ? (
        <p role="status" className="mt-6 text-center text-[14.5px] text-muted-foreground">Không thấy sách nào khớp “{query.trim()}”.</p>
      ) : (
        TIERS.map((tier) => {
          // AVORA-89 · 1.6: 📌 books stand first on their tier (pinned most recently first).
          const list = filtered
            .filter((book) => book.status === tier.key)
            .sort((a, b) => (pinnedAt.get(b.id) ?? "").localeCompare(pinnedAt.get(a.id) ?? ""));
          if (list.length === 0) return null;
          return (
            <section key={tier.key} aria-label={tier.label} className="mt-6">
              <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{tier.label} · {list.length}</h3>
              <ul className="flex gap-3 overflow-x-auto border-b-[3px] border-foreground/10 pb-0 [mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] md:grid md:[mask-image:none] md:grid-cols-[repeat(auto-fill,minmax(118px,1fr))] md:overflow-visible md:px-0">
                {list.map((book) => {
                  const progress = readingProgress(field(book, keys.position));
                  const lesson = tier.key === "da_doc" ? field(book, keys.lesson) : "";
                  return (
                    <li key={book.id} className="w-[104px] shrink-0 pb-2 md:w-auto">
                      <button type="button" onClick={() => setOpenId(book.id)} title={lesson === "" ? undefined : lesson} className="press group block w-full text-left">
                        <span className="relative flex aspect-[2/3] w-full flex-col justify-between overflow-hidden rounded-md p-2.5 shadow-sm ring-1 ring-black/10 transition-transform group-hover:-translate-y-1" style={{ backgroundColor: coverColor(book.title) }}>
                          <span className="line-clamp-4 text-[13px] font-semibold leading-snug text-white">{book.title}</span>
                          <span className="line-clamp-2 text-[11px] text-white/75">{field(book, keys.author)}</span>
                          {stars.data?.has(book.id) === true ? <Star className="absolute right-1.5 top-1.5 h-3.5 w-3.5 fill-amber-300 text-amber-300" aria-label="Quan trọng" /> : null}
                          {pinnedAt.has(book.id) ? <span className="absolute left-1.5 top-1.5 text-[12px]" data-book-pinned="" aria-label="Đã ghim">📌</span> : null}
                        </span>
                        {deviceKeys.has(catalogKeyOf(book)) ? (
                          <span className="mt-1 block text-[11px] text-muted-foreground" data-book-on-device="">✓ trên máy</span>
                        ) : null}
                        {progress !== null ? (
                          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-secondary">
                            <span className="block h-full rounded-full bg-personal" style={{ width: `${Math.round(progress * 100)}%` }} />
                          </span>
                        ) : null}
                        {lesson !== "" ? <span className="mt-1 line-clamp-2 block text-[11.5px] italic leading-snug text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{lesson}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}

      <OpenLibrary onShelf={onShelf} onAdd={addFromCatalog} />

      <AddBookDialog
        open={isAdding}
        onOpenChange={setIsAdding}
        onAdd={async (input) => {
          const extensionFields: Record<string, string> = {};
          if (keys.author !== null && input.author.trim() !== "") extensionFields[keys.author] = input.author.trim();
          if (keys.source !== null && input.source !== "") extensionFields[keys.source] = input.source;
          if (keys.link !== null && input.link.trim() !== "") extensionFields[keys.link] = input.link.trim();
          await actions.createRecord({ tableId: shelf.id, scope: scopeOfTable(shelf), title: input.title, status: "muon_doc", extensionFields });
          toast.success("Đã thêm vào tầng Muốn đọc.");
        }}
      />

      <Dialog open={opened !== null} onOpenChange={(next) => !next && setOpenId(null)}>
        <DialogContent className="max-h-[88dvh] max-w-[480px] overflow-y-auto">
          {opened !== null ? (
            <>
              <DialogTitle className="text-[19px]">{opened.title}</DialogTitle>
              <DialogDescription className="text-[13px]">{[field(opened, keys.author), field(opened, keys.source)].filter((part) => part !== "").join(" · ") || "Chưa ghi tác giả"}</DialogDescription>
              <div role="group" aria-label="Trạng thái" className="flex flex-wrap gap-1.5">
                {TIERS.map((tier) => (
                  <button
                    key={tier.key}
                    type="button"
                    aria-pressed={opened.status === tier.key}
                    onClick={() => opened.status !== tier.key && void setTier(opened, tier.key)}
                    className={cn("press rounded-full border px-3 py-1.5 text-[13px]", opened.status === tier.key ? "border-personal bg-personal-soft font-semibold text-personal-soft-foreground" : "border-border")}
                  >
                    {tier.label}
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="text-[13px] font-medium">Đang ở</span>
                <input
                  key={`pos-${opened.id}`}
                  defaultValue={field(opened, keys.position)}
                  placeholder="40% · trang 120/300 · chương 5"
                  onBlur={(event) => event.target.value !== field(opened, keys.position) && patchField(opened, keys.position, event.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-[16px] outline-none focus:border-personal md:text-[14.5px]"
                />
              </label>
              <label className="block">
                <span className="text-[13px] font-medium">Bài học chính</span>
                <textarea
                  key={`lesson-${opened.id}`}
                  rows={3}
                  defaultValue={field(opened, keys.lesson)}
                  placeholder="Điều này áp dụng vào đâu?"
                  onBlur={(event) => event.target.value !== field(opened, keys.lesson) && patchField(opened, keys.lesson, event.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[16px] outline-none focus:border-personal md:text-[14.5px]"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {catalogRefOf(field(opened, keys.link)) !== null ? (
                  <button type="button" onClick={() => read(opened)} className="press inline-flex items-center gap-1.5 rounded-md bg-personal px-3 py-2 text-[13.5px] font-semibold text-personal-foreground">
                    <BookOpen className="h-4 w-4" aria-hidden="true" /> Đọc trong Avora
                  </button>
                ) : field(opened, keys.link) !== "" ? (
                  <a href={field(opened, keys.link)} target="_blank" rel="noreferrer noopener" className="press inline-flex items-center gap-1.5 rounded-md bg-personal px-3 py-2 text-[13.5px] font-semibold text-personal-foreground">
                    <ExternalLink className="h-4 w-4" aria-hidden="true" /> Mở link
                  </a>
                ) : null}
                <button type="button" onClick={() => star.mutate(opened.id)} className="press inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[13.5px]">
                  <Star className={cn("h-4 w-4", stars.data?.has(opened.id) === true && "fill-amber-400 text-amber-400")} aria-hidden="true" /> Quan trọng
                </button>
                <button
                  type="button"
                  onClick={() => void openNotes(`sach=${encodeURIComponent(opened.id)}&ten=${encodeURIComponent(opened.title)}`)}
                  className="press inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[13.5px] font-medium"
                >
                  <NotebookText className="h-4 w-4" aria-hidden="true" />
                  {bookNotes.length === 0 ? "Ghi chép sách" : "Ghi chép mới"}
                </button>
              </div>
              {bookNotes.length > 0 ? (
                <div>
                  <p className="text-[13px] font-medium">Ghi chép về cuốn này · {bookNotes.length}</p>
                  <ul className="mt-1.5 space-y-1">
                    {bookNotes.map((note) => (
                      <li key={note.id}>
                        <button type="button" onClick={() => void openNotes(`ghi-chep=${encodeURIComponent(note.id)}`)} className="press flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-[13.5px] hover:bg-accent/40">
                          <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="truncate">{noteDisplayTitle(note)}</span>
                          <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground">{new Date(note.updatedAt).toLocaleDateString("vi-VN")}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div>
                <p className="text-[13px] font-medium">Đọc lại sau…</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[30, 90].map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() =>
                        actions.updateRecord(opened.id, { status: "doc_lai", nextActionDate: addDays(days) }).then(
                          () => toast.success(`Sẽ nhắc đọc lại sau ${days} ngày.`),
                          (error: unknown) => toast.error(error instanceof Error ? error.message : "Không lưu được."),
                        )
                      }
                      className="press rounded-full border border-border px-3 py-1.5 text-[13px]"
                    >
                      {days} ngày
                    </button>
                  ))}
                  <DateField
                    id={`reread-${opened.id}`}
                    className="min-w-[160px]"
                    value={opened.nextActionDate ?? ""}
                    onChange={(value) => value !== "" && void actions.updateRecord(opened.id, { status: "doc_lai", nextActionDate: value })}
                    label="Chọn ngày đọc lại"
                    title="Chọn ngày đọc lại"
                    allow="future"
                    min={todayIso()}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpenId(null);
                  navigate(`/ke-hoach?ke=ke-sach&bang=${shelf.id}&hang-muc=${opened.id}`);
                }}
                className="press self-start text-[13px] font-medium text-personal"
              >
                Áp dụng: tạo Hạng mục hoặc nhiệm vụ từ sách này →
              </button>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Thư viện mở: Vietnamese Wikisource first, then Project Gutenberg; search and nine categories. */
/** C6 · `n cuốn trên máy · x MB` → the list, `Xoá khỏi máy` one by one. Only this device knows. */
function OnDeviceLine() {
  const [open, setOpen] = useState<boolean>(false);
  const list = useQuery({ queryKey: ["books-on-device"], queryFn: booksOnDevice, staleTime: 10_000 });
  const whole = (list.data ?? []).filter((item) => item.complete);
  if (whole.length === 0) return null;
  const mb = whole.reduce((sum, item) => sum + item.bytes, 0) / 1_048_576;
  return (
    <div className="mb-3" data-on-device="">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="press inline-flex min-h-10 items-center gap-1.5 text-[13px] text-muted-foreground">
        <Download className="h-4 w-4" aria-hidden="true" /> {whole.length} cuốn trên máy · {mb.toFixed(1)} MB
      </button>
      {open ? (
        <ul className="mt-1 overflow-hidden rounded-xl border border-border bg-card">
          {whole.map((item) => (
            <li key={item.key} className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-[14px]">✓ {item.title}</span>
              <button
                type="button"
                onClick={() => {
                  const [source, ...rest] = item.key.split(":");
                  void removeFromDevice(source === "wikisource" ? "wikisource" : "gutenberg", rest.join(":")).then(() => list.refetch());
                }}
                className="press min-h-9 rounded-md px-2 text-[13px] text-destructive"
              >
                Xoá khỏi máy
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function OpenLibrary({ onShelf, onAdd }: { onShelf: ReadonlySet<string>; onAdd: (item: CatalogBook) => Promise<void> }) {
  const [text, setText] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [category, setCategory] = useState<BookCategory | null>(null);
  const [source, setSource] = useState<BookSource>("wikisource");
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [adding, setAdding] = useState<string | null>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [text]);
  // Typing searches both sources; browsing stays on the chosen one.
  const effectiveSource: BookSource | null = query === "" ? source : null;
  const results = useQuery<CatalogBook[], Error>({
    queryKey: ["book-catalog", query, category, effectiveSource],
    queryFn: async () => withoutAdultInBrowse(await searchCatalog(query, category, effectiveSource), query),
    staleTime: 5 * 60_000,
  });
  // C7: titles outside book_title_vi.csv, translated on this device only (never stored on a server).
  const [deviceTitles, setDeviceTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    for (const item of results.data ?? []) {
      if (item.titleVi !== null || item.language === "vi") continue;
      void translateTitleOnDevice(item.title, item.language).then((vi) => {
        if (!cancelled && vi !== null) setDeviceTitles((all) => ({ ...all, [`${item.source}:${item.sourceId}`]: vi }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [results.data]);
  return (
    <section aria-label="Thư viện mở" data-open-library="" className="mt-8">
      <div className="flex items-center gap-3">
        <h3 className="shrink-0 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Thư viện mở</h3>
        <button type="button" onClick={() => setIsSearchOpen((open) => !open || text !== "")} aria-label="Tìm trong Thư viện mở" aria-expanded={isSearchOpen || text !== ""} data-library-search-toggle="" className="icon-btn h-9 w-9">
          <Search className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>
      <div role="tablist" aria-label="Nguồn" className="mt-3 grid grid-cols-2 gap-2 md:flex md:flex-wrap" data-library-sources="">
        {(
          [
            ["wikisource", "Tiếng Việt", "Tiếng Việt (Wikisource)"],
            ["gutenberg", "Gutenberg", "Project Gutenberg — hơn 75.000 sách"],
          ] as const
        ).map(([id, short, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={source === id && query === ""}
            onClick={() => {
              setSource(id);
              setText("");
            }}
            className={cn("press h-9 min-w-0 rounded-full border px-3.5 text-[13px] font-medium", source === id && query === "" ? "border-personal bg-personal-soft text-personal-soft-foreground" : "border-border bg-card")}
          >
            <span className="md:hidden">{short}</span>
            <span className="hidden md:inline">{label}</span>
          </button>
        ))}
      </div>
      {isSearchOpen || text !== "" ? (
      <label className="mt-3 flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-3" data-library-search="">
        <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <input autoFocus={isSearchOpen} value={text} onChange={(event) => setText(event.target.value)} placeholder="Tìm tên sách, tác giả" aria-label="Tìm trong Thư viện mở" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none md:text-[14.5px]" />
      </label>
      ) : null}
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 [mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] [scrollbar-width:none] md:flex-wrap md:[mask-image:none]">
        {BOOK_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={category === item.id}
            onClick={() => setCategory(category === item.id ? null : item.id)}
            className={cn("press h-8 shrink-0 rounded-full border px-3 text-[12.5px]", category === item.id ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground")}
          >
            {item.label}
          </button>
        ))}
      </div>
      {results.isPending ? (
        <p className="mt-4 flex items-center gap-2 text-[13.5px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Đang tìm…
        </p>
      ) : results.isError ? (
        <div className="mt-4 text-[13.5px] text-muted-foreground">
          {results.error.message}{" "}
          <button type="button" onClick={() => void queryClient.invalidateQueries({ queryKey: ["book-catalog"] })} className="press font-medium text-personal">
            Thử lại
          </button>
        </div>
      ) : results.data.length === 0 ? (
        <p className="mt-4 text-[13.5px] text-muted-foreground">Không thấy sách nào khớp.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-[repeat(2,minmax(0,1fr))]" data-catalog-results="">
          {results.data.map((item) => {
            const key = `${item.source}:${item.sourceId}`;
            const isOn = onShelf.has(key);
            return (
              <li key={key} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
                <span className="h-12 w-8 shrink-0 rounded-sm ring-1 ring-black/10" style={{ backgroundColor: coverColor(item.title) }} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  {(() => {
                    const fromFile = bookTitleLines(item);
                    const device = fromFile.original === null && item.language !== "vi" ? deviceTitles[key] : undefined;
                    const lines = device === undefined ? fromFile : { main: device, original: item.title, tentative: true };
                    return (
                      <>
                        <span className="line-clamp-2 text-[14px] font-medium leading-snug text-foreground" data-title-main="">
                          {lines.main}
                          {lines.tentative ? <span className="ml-1 text-[11px] font-normal text-muted-foreground" data-tentative="">tạm dịch</span> : null}
                        </span>
                        {lines.original !== null ? (
                          <span className="block truncate text-[12px] text-muted-foreground/80" data-title-original="">
                            <span lang={item.language}>{lines.original}</span>
                            {/* Same Vietnamese title in two languages (Candide, Monte Cristo…): the language tells them apart. */}
                            <span data-title-language=""> · {LANGUAGE_NAMES[item.language] ?? item.language}</span>
                          </span>
                        ) : null}
                      </>
                    );
                  })()}
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {[item.authors, sourceLabel(item.source), LANGUAGE_NAMES[item.language]].filter((part) => part != null && part !== "").join(" · ")}
                  </span>
                </span>
                {isOn ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-muted-foreground">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" /> <span className="md:hidden">Trên kệ</span><span className="hidden md:inline">Trên kệ của bạn</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={adding === key}
                    onClick={() => {
                      setAdding(key);
                      onAdd(item)
                        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Chưa thêm được sách."))
                        .finally(() => setAdding(null));
                    }}
                    className="press inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-[12.5px] font-medium disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Muốn đọc
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[12px] text-muted-foreground">Chỉ sách thuộc phạm vi công cộng. Mỗi cuốn giữ nguyên ghi chú nguồn và giấy phép ở mục “Về bản này”.</p>
    </section>
  );
}

/** `+ Thêm sách tôi đang có` (D1): a book I own — where I read it goes to `Nguồn`. No reading inside Avora. */
function AddBookDialog({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: (input: { title: string; author: string; source: string; link: string }) => Promise<void> }) {
  const [title, setTitle] = useState<string>("");
  const [author, setAuthor] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [link, setLink] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setAuthor("");
    setSource("");
    setLink("");
  }, [open]);
  const input = "mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-[16px] outline-none focus:border-personal md:text-[14.5px]";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogTitle className="text-[18px]">Thêm sách tôi đang có</DialogTitle>
        <DialogDescription className="text-[13px]">Sách bạn đọc ở nơi khác. Avora giữ chỗ đọc và ghi chép, không mở nội dung.</DialogDescription>
        <label className="block"><span className="text-[13px] font-medium">Tên sách</span><input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} className={input} /></label>
        <label className="block"><span className="text-[13px] font-medium">Tác giả</span><input value={author} onChange={(e) => setAuthor(e.target.value)} className={input} /></label>
        <div role="group" aria-label="Đọc ở đâu">
          <span className="text-[13px] font-medium">Đọc ở đâu</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {OWN_SOURCES.map((option) => (
              <button key={option} type="button" aria-pressed={source === option} onClick={() => setSource(source === option ? "" : option)} className={cn("press h-9 rounded-full border px-3.5 text-[13px]", source === option ? "border-personal bg-personal-soft text-personal-soft-foreground" : "border-border")}>
                {option}
              </button>
            ))}
          </div>
        </div>
        <label className="block"><span className="text-[13px] font-medium">Link (không bắt buộc)</span><input value={link} inputMode="url" onChange={(e) => setLink(e.target.value)} className={input} /></label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className="press rounded-md border border-border px-4 py-2 text-[14px]">Huỷ</button>
          <button
            type="button"
            disabled={title.trim() === "" || isSaving}
            onClick={() => {
              setIsSaving(true);
              onAdd({ title, author, source, link })
                .then(() => onOpenChange(false), (error: unknown) => toast.error(error instanceof Error ? error.message : "Không thêm được sách."))
                .finally(() => setIsSaving(false));
            }}
            className="press rounded-md bg-personal px-4 py-2 text-[14px] font-semibold text-personal-foreground disabled:opacity-50"
          >
            Thêm vào Muốn đọc
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
