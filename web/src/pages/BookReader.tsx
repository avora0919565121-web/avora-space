import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Copy, Download, List, Loader2, NotebookPen, Type, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { useBookshelf } from "@/components/library/BookshelfPanel";
import { findJournal } from "@/hooks/use-paste-task";
import { catalogRefOf, epubOf, LANGUAGE_NAMES } from "@/lib/book-catalog";
import { ensureJournalConversation } from "@/lib/chat";
import { readReturn, withReturn } from "@/lib/return-to";
import {
  BookTextError,
  clipExcerpt,
  fetchReadingState,
  flushPositions,
  furtherElsewhere,
  loadBookText,
  loadPart,
  localPosition,
  makeLocator,
  parseLocator,
  percentOf,
  positionLabel,
  readingKeys,
  readTextSize,
  rememberTextSize,
  savePosition,
  TEXT_SIZES,
  thisDeviceLabel,
  type BookBlock,
  type BookText,
  type ReadingState,
} from "@/lib/reading-state";
import { useConversations } from "@/lib/use-conversations";
import { useThinkHubActions } from "@/lib/use-think-hub";
import { cn } from "@/lib/utils";

/**
 * AVORA-77 · D3 — reading a public-domain book inside Avora.
 *
 * Plain text in the page (no iframe, no canvas), `lang` set to the book's language and never
 * `translate="no"`, so the browser's own translation works. A translation is never stored.
 * Serif 17px / 1.7 on paper; `Aa` has three sizes kept on this device. No page-turn effects.
 */
const BookReader = () => {
  const { recordId = "" } = useParams<{ recordId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { shelf, books, keys, field, isPending: shelfPending } = useBookshelf();
  const actions = useThinkHubActions();
  const { data: conversations } = useConversations();
  const book = books.find((item) => item.id === recordId) ?? null;
  const ref = book === null ? null : catalogRefOf(field(book, keys.link));

  const [text, setText] = useState<BookText | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chapter, setChapter] = useState<number>(0);
  const [size, setSize] = useState<"s" | "m" | "l">(() => readTextSize());
  const [isTocOpen, setIsTocOpen] = useState<boolean>(false);
  const [isPartLoading, setIsPartLoading] = useState<boolean>(false);
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  const [offer, setOffer] = useState<ReadingState | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const restoredRef = useRef<boolean>(false);
  const lastSavedRef = useRef<string>("");

  // ------------------------------------------------------------------ load
  useEffect(() => {
    if (ref === null) return;
    let cancelled = false;
    setLoadError(null);
    loadBookText(ref.source, ref.sourceId).then(
      (loaded) => !cancelled && setText(loaded),
      (caught: unknown) => !cancelled && setLoadError(caught instanceof BookTextError ? caught.message : "Chưa mở được sách."),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref is derived from the link string
  }, [ref?.source, ref?.sourceId]);

  const serverState = useQuery({ queryKey: readingKeys.state(recordId), queryFn: () => fetchReadingState(recordId), enabled: recordId !== "", retry: false });

  // Offline places go up as soon as the reader opens (and whenever the network comes back).
  useEffect(() => {
    void flushPositions();
    const onOnline = (): void => void flushPositions();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  // Where to start: this device's own place first; another device further along is only offered.
  useEffect(() => {
    if (text === null || restoredRef.current || serverState.isPending) return;
    restoredRef.current = true;
    void localPosition(recordId).then((mine) => {
      // Start where *this* device left off. Another device's place is only offered (D4) — never jumped to.
      const server = serverState.data ?? null;
      const sameDevice = server !== null && server.deviceLabel === thisDeviceLabel();
      const start = parseLocator(mine?.locator ?? (sameDevice ? server.locator : null));
      const at = Math.min(Math.max(0, start.chapter), text.chapters.length - 1);
      setChapter(at);
      void ensurePart(at).then(() => scrollToBlock(start.block));
      const elsewhere = furtherElsewhere(serverState.data ?? null, { percent: mine?.percent ?? 0, at: mine?.at ?? null }, thisDeviceLabel());
      if (elsewhere !== null) setOffer(elsewhere);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when both are known
  }, [text, serverState.isPending]);

  const ensurePart = useCallback(
    async (index: number): Promise<void> => {
      setText((current) => current);
      const current = text;
      if (current === null || current.chapters[index]?.blocks != null) return;
      setIsPartLoading(true);
      try {
        const next = await loadPart(current, index);
        setText(next);
      } catch (caught) {
        toast.error(caught instanceof BookTextError ? caught.message : "Chưa tải được chương này.");
      } finally {
        setIsPartLoading(false);
      }
    },
    [text],
  );

  const scrollToBlock = (block: number): void => {
    window.setTimeout(() => {
      const node = scrollRef.current?.querySelector<HTMLElement>(`[data-b="${block}"]`);
      if (node !== null && node !== undefined && scrollRef.current !== null) scrollRef.current.scrollTop = Math.max(0, node.offsetTop - 80);
      else if (scrollRef.current !== null) scrollRef.current.scrollTop = 0;
    }, 60);
  };

  // ------------------------------------------------------------------ save the place
  const currentPlace = useCallback((): { locator: string; percent: number } | null => {
    if (text === null || scrollRef.current === null) return null;
    const scroller = scrollRef.current;
    const blocks = [...scroller.querySelectorAll<HTMLElement>("[data-b]")];
    const top = scroller.scrollTop + 90;
    let block = 0;
    for (const node of blocks) {
      if (node.offsetTop <= top) block = Number(node.dataset.b);
      else break;
    }
    const within = scroller.scrollHeight <= scroller.clientHeight ? 1 : scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight);
    return { locator: makeLocator(chapter, block), percent: percentOf(text.chapters.length, chapter, within) };
  }, [text, chapter]);

  const save = useCallback((): void => {
    const place = currentPlace();
    if (place === null || book === null) return;
    const key = `${place.locator}|${Math.round(place.percent)}`;
    if (key === lastSavedRef.current) return;
    lastSavedRef.current = key;
    void savePosition(book.id, place.locator, place.percent);
    // `Đang ở` on the shelf reads the same place in words people read.
    const label = positionLabel(chapter, place.percent);
    if (keys.position !== null && field(book, keys.position) !== label) {
      actions.updateRecord(book.id, { extensionFields: { ...book.extensionFields, [keys.position]: label } }).catch(() => undefined);
    }
  }, [currentPlace, book, chapter, keys.position, field, actions]);

  // After 2 seconds without scrolling.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null) return;
    let timer: number | null = null;
    const onScroll = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(save, 2000);
      setSelection(null);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [save]);

  // Leaving the screen (and hiding the tab) saves too.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === "hidden") saveRef.current();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      saveRef.current();
    };
  }, []);

  const goChapter = async (index: number, block = 0): Promise<void> => {
    if (text === null) return;
    save();
    setIsTocOpen(false);
    setChapter(index);
    await ensurePart(index);
    scrollToBlock(block);
    lastSavedRef.current = "";
    window.setTimeout(() => saveRef.current(), 200);
  };

  // ------------------------------------------------------------------ selection → note
  useEffect(() => {
    const onSelect = (): void => {
      const picked = window.getSelection();
      const chosen = picked?.toString().trim() ?? "";
      if (picked === null || chosen.length < 2 || picked.rangeCount === 0 || scrollRef.current === null) return setSelection(null);
      const range = picked.getRangeAt(0);
      if (!scrollRef.current.contains(range.commonAncestorContainer)) return setSelection(null);
      const rect = range.getBoundingClientRect();
      setSelection({ text: chosen, top: Math.max(64, rect.top - 52), left: Math.min(window.innerWidth - 260, Math.max(12, rect.left + rect.width / 2 - 130)) });
    };
    document.addEventListener("selectionchange", onSelect);
    return () => document.removeEventListener("selectionchange", onSelect);
  }, []);

  const toNotes = async (): Promise<void> => {
    if (selection === null || book === null || text === null) return;
    try {
      const journalId = findJournal(conversations)?.conversationId ?? (await ensureJournalConversation());
      const where = text.chapters[chapter]?.title ?? `Chương ${chapter + 1}`;
      const params = new URLSearchParams({ xem: "ghi-chep", sach: book.id, ten: book.title, trich: clipExcerpt(selection.text), cho: where.slice(0, 120) });
      save();
      navigate(withReturn(`/tin-nhan/${journalId}?${params.toString()}`, { path: `${location.pathname}${location.search}`, label: book.title.slice(0, 40) }));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Chưa mở được Ghi chép.");
    }
  };

  const back = (): void => {
    save();
    const origin = readReturn(new URLSearchParams(location.search));
    navigate(origin?.path ?? "/ke-hoach?ke=ke-sach");
  };

  // ------------------------------------------------------------------ render
  const px = TEXT_SIZES.find((item) => item.id === size)?.px ?? 17;
  const current = text?.chapters[chapter];
  const isLast = text !== null && chapter === text.chapters.length - 1;
  const language = text?.language ?? "vi";
  const epub = epubOf(ref);

  const body = useMemo(() => (current?.blocks ?? null), [current]);

  if (shelfPending || (book !== null && ref !== null && text === null && loadError === null)) {
    return (
      <div className="paper flex min-h-0 flex-1 items-center justify-center" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Đang mở sách</span>
      </div>
    );
  }
  if (shelf !== null && (book === null || ref === null || loadError !== null)) {
    return (
      <div className="paper flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <p role="alert" className="max-w-sm text-[15px] text-muted-foreground">
          {loadError ?? (book === null ? "Cuốn này không còn trên Kệ sách của bạn." : "Cuốn này không đọc trong Avora được — chỉ sách từ Thư viện mở.")}
        </p>
        <button type="button" onClick={back} className="press mt-5 min-h-11 rounded-md border border-border bg-card px-5 text-[14px] font-medium">
          ‹ Kệ sách
        </button>
      </div>
    );
  }
  if (text === null || book === null) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[hsl(var(--reader-paper))]" data-reader="">
      <header className="flex shrink-0 items-center gap-1 border-b border-border/60 bg-[hsl(var(--reader-paper))]/95 px-2 py-1.5 backdrop-blur-sm">
        <button type="button" onClick={back} aria-label="Quay lại Kệ sách" className="icon-btn h-11 w-11">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-foreground">{book.title}</p>
          <p className="truncate text-[12px] text-muted-foreground">{current?.title ?? ""}</p>
        </div>
        <button type="button" onClick={() => setIsTocOpen(true)} aria-label="Mục lục" title="Mục lục" className="icon-btn h-11 w-11">
          <List className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            const next = size === "s" ? "m" : size === "m" ? "l" : "s";
            setSize(next);
            rememberTextSize(next);
          }}
          aria-label={`Cỡ chữ: ${TEXT_SIZES.find((item) => item.id === size)?.label ?? ""}`}
          title="Cỡ chữ"
          className="icon-btn h-11 w-11 gap-0.5"
        >
          <Type className="h-4 w-4" aria-hidden="true" />
          <span className="text-[12px] font-semibold">{size === "s" ? "1" : size === "m" ? "2" : "3"}</span>
        </button>
      </header>

      {language !== "vi" ? (
        <p className="shrink-0 border-b border-border/50 px-4 py-1.5 text-center text-[12.5px] text-muted-foreground" data-translate-line="">
          Sách {LANGUAGE_NAMES[language] ?? "nước ngoài"}. Dịch bằng trình duyệt — bản dịch không lưu.
        </p>
      ) : null}
      {offer !== null ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 bg-personal-soft px-4 py-2 text-[13.5px] text-personal-soft-foreground" data-reading-offer="">
          <span className="min-w-0 flex-1">
            Bạn đã đọc tới {Math.round(offer.percent)}% trên {offer.deviceLabel ?? "máy khác"} — mở tới đó?
          </span>
          <button
            type="button"
            onClick={() => {
              const at = parseLocator(offer.locator);
              setOffer(null);
              void goChapter(Math.min(at.chapter, text.chapters.length - 1), at.block);
            }}
            className="press rounded-md bg-personal px-3 py-1.5 text-[13px] font-semibold text-personal-foreground"
          >
            Mở tới đó
          </button>
          <button type="button" onClick={() => setOffer(null)} className="press rounded-md px-2 py-1.5 text-[13px] font-medium">
            Ở đây
          </button>
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" data-scroll-memory="">
        <article
          lang={language}
          className="mx-auto max-w-[38rem] px-6 pb-24 pt-8 font-reader text-foreground md:px-10"
          style={{ fontSize: `${px}px`, lineHeight: 1.7 }}
        >
          {body === null || isPartLoading ? (
            <p className="flex items-center gap-2 text-[15px] text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Đang tải chương…
            </p>
          ) : (
            body.map((block, index) => <Block key={index} block={block} index={index} />)
          )}

          <nav aria-label="Chuyển chương" className="mt-12 flex items-center justify-between gap-3 border-t border-border/60 pt-5 font-sans text-[14px]">
            <button type="button" disabled={chapter === 0} onClick={() => void goChapter(chapter - 1)} className="press min-h-11 rounded-md px-3 font-medium text-personal disabled:opacity-30">
              ‹ Chương trước
            </button>
            <span className="tabular text-[12.5px] text-muted-foreground">
              {chapter + 1} / {text.chapters.length}
            </span>
            <button type="button" disabled={isLast} onClick={() => void goChapter(chapter + 1)} className="press min-h-11 rounded-md px-3 font-medium text-personal disabled:opacity-30">
              Chương sau ›
            </button>
          </nav>

          {isLast ? (
            <section aria-label="Về bản này" data-about-edition="" className="mt-10 rounded-xl border border-border bg-card/70 p-5 font-sans text-[13px] leading-relaxed text-muted-foreground">
              <h2 className="text-[15px] font-semibold text-foreground">Về bản này</h2>
              <p className="mt-1">
                Nguồn: {text.source === "gutenberg" ? "Project Gutenberg" : "Wikisource tiếng Việt"} ·{" "}
                <a href={text.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-personal underline-offset-2 hover:underline">
                  bản gốc
                </a>
                {epub !== null ? (
                  <>
                    {" · "}
                    <a href={epub} className="text-personal underline-offset-2 hover:underline">
                      EPUB
                    </a>
                  </>
                ) : null}
              </p>
              {text.license.length > 0 ? (
                <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto whitespace-pre-line" lang={text.source === "gutenberg" ? "en" : "vi"}>
                  {text.license.map((line, index) => (
                    <p key={index}>{line}</p>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </article>
      </div>

      {epub !== null ? (
        <a href={epub} className="press fixed bottom-[calc(env(safe-area-inset-bottom)+76px)] right-4 z-20 hidden items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-[12.5px] font-medium text-foreground shadow-md md:inline-flex md:bottom-6">
          <Download className="h-4 w-4" aria-hidden="true" /> Mở bằng app đọc trên máy
        </a>
      ) : null}

      {selection !== null ? (
        <div role="toolbar" aria-label="Đoạn đang chọn" className="fixed z-40 flex w-[260px] items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-lg" style={{ top: selection.top, left: selection.left }}>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void toNotes()} className="press flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[13px] font-semibold text-personal hover:bg-accent/40">
            <NotebookPen className="h-4 w-4" aria-hidden="true" /> Chép vào Ghi chép sách
          </button>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              void navigator.clipboard?.writeText(selection.text).then(() => toast.success("Đã sao chép."), () => toast.error("Trình duyệt không cho sao chép."));
              setSelection(null);
            }}
            className="press flex items-center gap-1 rounded-lg px-2.5 py-2 text-[13px] hover:bg-accent/40"
          >
            <Copy className="h-4 w-4" aria-hidden="true" /> Sao chép
          </button>
        </div>
      ) : null}

      {isTocOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Mục lục" className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setIsTocOpen(false)}>
          <div className="flex h-full w-full max-w-sm flex-col bg-card shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-border px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]">
              <p className="flex-1 text-[16px] font-semibold">Mục lục</p>
              <button type="button" onClick={() => setIsTocOpen(false)} aria-label="Đóng" className="icon-btn h-10 w-10">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <ol className="min-h-0 flex-1 overflow-y-auto py-1" lang={language}>
              {text.chapters.map((item, index) => (
                <li key={index}>
                  <button type="button" onClick={() => void goChapter(index)} aria-current={index === chapter ? "true" : undefined} className={cn("press flex w-full items-baseline gap-3 px-4 py-2.5 text-left text-[14px] hover:bg-accent/30", index === chapter && "bg-personal-soft font-semibold text-personal-soft-foreground")}>
                    <span className="tabular w-7 shrink-0 text-[12px] text-muted-foreground">{index + 1}</span>
                    <span className="min-w-0 flex-1">{item.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </div>
  );
};

function Block({ block, index }: { block: BookBlock; index: number }) {
  if (block.k === "h") {
    const Tag = block.l <= 2 ? "h2" : "h3";
    return (
      <Tag data-b={index} className={cn("mb-4 mt-8 text-balance font-semibold leading-snug first:mt-0", block.l <= 2 ? "text-[1.35em]" : "text-[1.15em]")}>
        {block.t}
      </Tag>
    );
  }
  if (block.k === "img") {
    return (
      <figure data-b={index} className="my-6">
        <img src={block.src} alt={block.alt.trim()} loading="lazy" className="mx-auto max-h-[60vh] max-w-full rounded-sm" />
      </figure>
    );
  }
  if (block.k === "pre") {
    return (
      <pre data-b={index} className="my-4 whitespace-pre-wrap font-reader">
        {block.t}
      </pre>
    );
  }
  return (
    <p data-b={index} className="mb-[0.9em] whitespace-pre-line">
      {block.t}
    </p>
  );
}

export default BookReader;
