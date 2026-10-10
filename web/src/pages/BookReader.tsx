import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookCheck, ChevronLeft, Copy, Download, Languages, List, Loader2, Moon, MoreHorizontal, NotebookPen, Pin, Type, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { useActivityMeter } from "@/lib/use-activity";
import { useTranslationConfig } from "@/lib/use-app-config";
import { TempTabBar } from "@/components/nav/TempTabBar";
import { toast } from "sonner";

import { useBookshelf } from "@/components/library/use-bookshelf";
import { DeviceFullSheet } from "@/components/library/OnDeviceList";
import { askConfirm } from "@/components/ConfirmHost";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { findJournal } from "@/hooks/use-paste-task";
import { useAuth } from "@/lib/auth";
import { catalogRefOf, epubOf, LANGUAGE_NAMES, sourceLine } from "@/lib/book-catalog";
import { ensureJournalConversation, fetchMessages, sendMessage } from "@/lib/chat";
import { conversationTitle, type ChatMessage } from "@/lib/chat-cache";
import { INCOMING_MESSAGE_EVENT, type IncomingMessageSignal } from "@/lib/in-app-alerts";
import { countMissed, setQuietReading, takeMissed, useQuietReading } from "@/lib/quiet-reading";
import {
  curlAllowed,
  ensureReaderFont,
  keepTranslation,
  keptTranslation,
  minutesLeft,
  READER_FONTS,
  READER_LEADING,
  READER_MARGINS,
  READER_SIZES,
  READER_THEMES,
  readerSettingsFrom,
  readerZone,
  READER_BOTTOM_BAND,
  READER_TOP_BAND,
  deviceEngine,
  LOOKUP_MAX_CHARS,
  NO_DEVICE_TRANSLATION,
  sentenceAround,
  translatorApi,
  type ReaderSettings,
} from "@/lib/reader-settings";
import { withReturn } from "@/lib/return-to";
import { useBack } from "@/lib/go-back";
import { useBackPress } from "@/hooks/use-back-press";
import {
  BookTextError,
  clipExcerpt,
  DeviceFullError,
  downloadBook,
  FINISHED_PERCENT,
  hasRoomFor,
  markFinishAsked,
  removeFromDevice,
  wasFinishAsked,
  fetchAllReadingStates,
  fetchReadingState,
  flushPositions,
  furtherElsewhere,
  isOnDevice,
  loadBookText,
  loadPart,
  localPosition,
  makeLocator,
  parseLocator,
  percentOf,
  PinFullError,
  positionLabel,
  readingKeys,
  savePosition,
  setBookPin,
  thisDeviceLabel,
  type BookBlock,
  type BookText,
  type ReadingState,
} from "@/lib/reading-state";
import { useConversations } from "@/lib/use-conversations";
import { useProfilePrefs } from "@/lib/use-default-boards";
import { useThinkHubActions } from "@/lib/use-think-hub";
import { cn } from "@/lib/utils";
import { BackClosesBinding } from "@/lib/use-back-closes";

const GAP = 48;

/**
 * AVORA-77 · D3 + AVORA-81 · C1–C6 (ADR-051) — reading a public-domain book inside Avora.
 *
 * Full screen, no app bars. Tap the middle third for tools, the right two-thirds… the right third for
 * the next page, the left third for the previous one; swipe and ← → / Space too. Pages come from CSS
 * columns (two side by side on a wide computer); `Cuộn liền` keeps the old scroll. The place is a
 * chapter + paragraph (never a page number, which changes with the size).
 *
 * Plain text with `lang`, never `translate="no"`, no iframe or canvas, so the browser can translate.
 * Avora's own `Dịch` uses only the on-device Translator; nothing is sent or stored on a server.
 */
const BookReader = () => {
  const { recordId = "" } = useParams<{ recordId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { shelf, books, keys, field, isPending: shelfPending } = useBookshelf();
  const actions = useThinkHubActions();
  const { data: conversations } = useConversations();
  const { prefs, setPref } = useProfilePrefs();
  const book = books.find((item) => item.id === recordId) ?? null;
  // AVORA-93 · PHẦN 2: reading time — page turns, taps and keys keep it counting; idle > 2 min stops it.
  const activity = useActivityMeter("book", book === null ? null : recordId);
  const ref = book === null ? null : catalogRefOf(field(book, keys.link));

  const [isPhone] = useState<boolean>(() => window.matchMedia("(max-width: 767px)").matches);
  const settings: ReaderSettings = useMemo(() => readerSettingsFrom(prefs, isPhone, safeLocal("avora.reader.size")), [prefs, isPhone]);
  const [draft, setDraft] = useState<ReaderSettings | null>(null);
  const look = draft ?? settings;
  const reducedMotion = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  const [text, setText] = useState<BookText | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chapter, setChapter] = useState<number>(0);
  const [page, setPage] = useState<number>(0);
  const [pages, setPages] = useState<number>(1);
  const [toolsOpen, setToolsOpen] = useState<boolean>(false);
  const [panel, setPanel] = useState<"toc" | "aa" | "translate" | "pin" | null>(null);
  const [isPartLoading, setIsPartLoading] = useState<boolean>(false);
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  const [offer, setOffer] = useState<ReadingState | null>(null);
  const [onDevice, setOnDevice] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [isDeviceFull, setIsDeviceFull] = useState<boolean>(false);
  const [translated, setTranslated] = useState<Record<number, string[]>>({});
  const [translating, setTranslating] = useState<{ target: string; progress: string | null } | null>(null);
  const [showOriginal, setShowOriginal] = useState<boolean>(false);
  const [strip, setStrip] = useState<{ conversationId: string; name: string; line: string } | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const quiet = useQuietReading();

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<number>(0);
  const restoredRef = useRef<boolean>(false);
  const lastSavedRef = useRef<string>("");
  const pageTimesRef = useRef<number[]>([]);
  const pageAtRef = useRef<number>(Date.now());
  const translatorRef = useRef<{ translate: (text: string) => Promise<string> } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const paged = look.turn === "lat";
  const spread = paged && size.w >= 1024 && size.w > size.h;
  const pageWidth = size.w;
  const columnWidth = spread ? (pageWidth - GAP) / 2 : pageWidth;
  const step = pageWidth + GAP;
  const theme = READER_THEMES.find((item) => item.id === look.theme) ?? READER_THEMES[1];
  const font = READER_FONTS.find((item) => item.id === look.font) ?? READER_FONTS[0];
  const effect: "curl" | "fade" | "slide" = curlAllowed(look, reducedMotion) ? "curl" : reducedMotion ? "fade" : "slide";

  useEffect(() => ensureReaderFont(look.font), [look.font]);
  // A web font that arrives after the first layout reflows the text: count the pages again.
  const [fontTick, setFontTick] = useState<number>(0);
  useEffect(() => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts === undefined) return;
    const bump = (): void => setFontTick((tick) => tick + 1);
    fonts.addEventListener("loadingdone", bump);
    void fonts.ready.then(bump);
    return () => fonts.removeEventListener("loadingdone", bump);
  }, []);

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
  const allStates = useQuery({ queryKey: ["book-reading-state", "all"], queryFn: fetchAllReadingStates, enabled: Boolean(user?.id), staleTime: 30_000 });
  const isPinned = (allStates.data ?? []).some((state) => state.recordId === recordId && state.pinnedAt != null);

  useEffect(() => {
    void flushPositions();
    const onOnline = (): void => void flushPositions();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  // C6: a book being read (or pinned) comes down whole, in the background.
  useEffect(() => {
    if (ref === null || text === null) return;
    let cancelled = false;
    void isOnDevice(ref.source, ref.sourceId).then((whole) => {
      if (cancelled) return;
      setOnDevice(whole);
      if (!whole && (book?.status === "dang_doc" || isPinned) && navigator.onLine) {
        // AVORA-103 · D1: with five books already here, read online and keep nothing.
        void hasRoomFor(ref.source, ref.sourceId).then((room) => (room ? downloadBook(ref.source, ref.sourceId) : Promise.reject(new DeviceFullError()))).then(
          (full) => {
            if (cancelled) return;
            setText((current) => (current === null ? full : { ...current, chapters: full.chapters }));
            setOnDevice(true);
          },
          () => undefined,
        );
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once the text is known
  }, [text !== null, ref?.sourceId, isPinned]);

  // Where to start: this device's own place first; another device further along is only offered.
  useEffect(() => {
    if (text === null || restoredRef.current || serverState.isPending) return;
    restoredRef.current = true;
    void localPosition(recordId).then((mine) => {
      const server = serverState.data ?? null;
      const sameDevice = server !== null && server.deviceLabel === thisDeviceLabel();
      // AVORA-93 · 3.3: `?o=chapter:block` (from a book note on kệ 5) opens that passage first.
      const asked = new URLSearchParams(location.search).get("o");
      const start = parseLocator(asked !== null && /^\d{1,5}:\d{1,6}$/.test(asked) ? asked : (mine?.locator ?? (sameDevice ? server.locator : null)));
      const at = Math.min(Math.max(0, start.chapter), text.chapters.length - 1);
      anchorRef.current = start.block;
      setChapter(at);
      void ensurePart(at);
      const elsewhere = furtherElsewhere(server, { percent: mine?.percent ?? 0, at: mine?.at ?? null }, thisDeviceLabel());
      if (elsewhere !== null) setOffer(elsewhere);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when both are known
  }, [text, serverState.isPending]);

  const ensurePart = useCallback(
    async (index: number): Promise<void> => {
      const current = text;
      if (current === null || current.chapters[index]?.blocks != null) return;
      setIsPartLoading(true);
      try {
        setText(await loadPart(current, index));
      } catch (caught) {
        toast.error(caught instanceof BookTextError ? caught.message : "Chưa tải được chương này.");
      } finally {
        setIsPartLoading(false);
      }
    },
    [text],
  );

  // ------------------------------------------------------------------ layout (pages)
  const hasText = text !== null;
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (node === null) return;
    const measure = (): void => setSize({ w: node.clientWidth, h: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [paged, hasText]);

  const current = text?.chapters[chapter];
  const body = current?.blocks ?? null;
  const shown: BookBlock[] | null = useMemo(() => {
    if (body === null) return null;
    const words = translated[chapter];
    if (words === undefined || showOriginal) return body;
    return body.map((block, index) => (block.k === "p" || block.k === "h" ? { ...block, t: words[index] ?? block.t } : block));
  }, [body, translated, chapter, showOriginal]);

  /** Where a paragraph starts inside the flow (transform-free): its first fragment, not `offsetLeft`. */
  const startOf = useCallback((node: HTMLElement, flow: HTMLElement): number => {
    const first = node.getClientRects()[0];
    return first === undefined ? 0 : first.left - flow.getBoundingClientRect().left;
  }, []);
  /**
   * The paragraph at the top of a page: the first one with a fragment in that column. Every
   * paragraph on a page shares the same left edge, so "starts before" alone would pick the last.
   */
  const blockAtPage = useCallback(
    (at: number): number => {
      const flow = flowRef.current;
      if (flow === null) return 0;
      const base = flow.getBoundingClientRect().left;
      const from = at * step - 2;
      const to = at * step + step - 2;
      let lastBefore = 0;
      for (const node of flow.querySelectorAll<HTMLElement>("[data-b]")) {
        const lefts = [...node.getClientRects()].filter((rect) => rect.width > 0).map((rect) => rect.left - base);
        if (lefts.some((left) => left >= from && left < to)) return Number(node.dataset.b);
        if (lefts.length > 0 && lefts[0] < from) lastBefore = Number(node.dataset.b);
      }
      return lastBefore;
    },
    [step],
  );
  const pageOfBlock = useCallback(
    (block: number): number => {
      const flow = flowRef.current;
      const node = flow?.querySelector<HTMLElement>(`[data-b="${block}"]`);
      if (flow == null || node == null || step <= 0) return block === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : 0;
      return Math.max(0, Math.floor((startOf(node, flow) + 2) / step));
    },
    [step, startOf],
  );

  // A new size, face, margin or a turned phone: count the pages again, stay on the same paragraph.
  useLayoutEffect(() => {
    if (!paged || flowRef.current === null || size.w === 0 || shown === null) return;
    const flow = flowRef.current;
    const total = Math.max(1, Math.round((flow.scrollWidth + GAP) / step));
    setPages(total);
    setPage(Math.min(total - 1, pageOfBlock(anchorRef.current)));
  }, [paged, size.w, size.h, look.size, look.font, look.margin, look.leading, look.justify, shown, step, pageOfBlock, fontTick]);

  useEffect(() => {
    if (!paged && scrollRef.current !== null && shown !== null) {
      const node = scrollRef.current.querySelector<HTMLElement>(`[data-b="${anchorRef.current}"]`);
      scrollRef.current.scrollTop = node === null ? 0 : Math.max(0, node.offsetTop - 80);
    }
  }, [paged, shown]);

  // ------------------------------------------------------------------ save the place
  const currentPlace = useCallback((): { locator: string; percent: number; block: number } | null => {
    if (text === null) return null;
    if (paged) {
      const block = blockAtPage(page);
      return { locator: makeLocator(chapter, block), percent: percentOf(text.chapters.length, chapter, pages <= 1 ? 1 : page / (pages - 1)), block };
    }
    const scroller = scrollRef.current;
    if (scroller === null) return null;
    let block = 0;
    for (const node of scroller.querySelectorAll<HTMLElement>("[data-b]")) {
      if (node.offsetTop <= scroller.scrollTop + 90) block = Number(node.dataset.b);
      else break;
    }
    const within = scroller.scrollHeight <= scroller.clientHeight ? 1 : scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight);
    return { locator: makeLocator(chapter, block), percent: percentOf(text.chapters.length, chapter, within), block };
  }, [text, paged, page, pages, chapter, blockAtPage]);

  const save = useCallback((): void => {
    const place = currentPlace();
    if (place === null || book === null) return;
    const key = `${place.locator}|${Math.round(place.percent)}`;
    if (key === lastSavedRef.current) return;
    lastSavedRef.current = key;
    void savePosition(book.id, place.locator, place.percent);
    if (place.percent >= FINISHED_PERCENT) void offerLetGoRef.current();
    const label = positionLabel(chapter, place.percent);
    if (keys.position !== null && field(book, keys.position) !== label) {
      actions.updateRecord(book.id, { extensionFields: { ...book.extensionFields, [keys.position]: label } }).catch(() => undefined);
    }
  }, [currentPlace, book, chapter, keys.position, field, actions]);

  const offerLetGoRef = useRef<() => Promise<void>>(async () => undefined);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const timer = window.setTimeout(() => saveRef.current(), 2000);
    return () => window.clearTimeout(timer);
  }, [page, chapter]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (paged || scroller === null) return;
    let timer: number | null = null;
    const onScroll = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => saveRef.current(), 2000);
      setSelection(null);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [paged, shown]);
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

  const goChapter = async (index: number, block = 0, atEnd = false): Promise<void> => {
    if (text === null || index < 0 || index >= text.chapters.length) return;
    save();
    setPanel(null);
    anchorRef.current = atEnd ? Number.MAX_SAFE_INTEGER : block;
    setChapter(index);
    setPage(0);
    await ensurePart(index);
    lastSavedRef.current = "";
  };

  const turn = useCallback(
    (direction: 1 | -1): void => {
      if (text === null) return;
      setSelection(null);
      activity.touch();
      const now = Date.now();
      if (direction === 1) pageTimesRef.current = [...pageTimesRef.current.slice(-19), now - pageAtRef.current];
      pageAtRef.current = now;
      if (!paged) {
        scrollRef.current?.scrollBy({ top: direction * (scrollRef.current.clientHeight - 60), behavior: reducedMotion ? "auto" : "smooth" });
        return;
      }
      const next = page + direction;
      if (next >= pages) {
        void goChapter(chapter + 1);
        return;
      }
      if (next < 0) {
        void goChapter(chapter - 1, 0, true);
        return;
      }
      anchorRef.current = blockAtPage(next);
        setPage(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- goChapter reads current state
    [text, paged, page, pages, chapter, blockAtPage, reducedMotion, activity],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (panel !== null || (event.target as HTMLElement | null)?.closest("input, textarea") !== null) return;
      if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown") {
        event.preventDefault();
        turn(1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        turn(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turn, panel]);

  // Fullscreen API where there is one (Android, computers), on the first touch. iPhone has none.
  const askedFullscreen = useRef<boolean>(false);
  const tryFullscreen = (): void => {
    if (askedFullscreen.current) return;
    askedFullscreen.current = true;
    const root = document.documentElement;
    if (document.fullscreenElement == null && typeof root.requestFullscreen === "function" && !/iPhone|iPad/.test(navigator.userAgent)) {
      void root.requestFullscreen().catch(() => undefined);
    }
  };
  useEffect(
    () => () => {
      if (document.fullscreenElement != null) void document.exitFullscreen().catch(() => undefined);
    },
    [],
  );

  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  /*
   * AVORA-93 · 4.1 (ADR-061): four zones — top band = tools, bottom band = the five tabs, left half =
   * previous page, right half = next page (exactly half; no dead middle). Scroll mode: halves do nothing.
   */
  const [tabsShown, setTabsShown] = useState<boolean>(false);
  const tapAt = (clientX: number, clientY: number, target: EventTarget | null): void => {
    tryFullscreen();
    if ((window.getSelection()?.toString() ?? "") !== "") return;
    if (target instanceof HTMLElement && target.closest("a, button, input, [data-reader-tabs]") !== null) return;
    // The reader root pads by env(safe-area-inset-top): the top band starts under the notch.
    const root = document.querySelector<HTMLElement>("[data-reader]");
    const safeTop = root === null ? 0 : Number.parseFloat(getComputedStyle(root).paddingTop) || 0;
    const zone = readerZone({ x: clientX, y: clientY, width: window.innerWidth, height: window.innerHeight, safeTop, isPaged: paged });
    if (zone === "tools") {
      setTabsShown(false);
      setToolsOpen((open) => !open);
      return;
    }
    if (zone === "tabs") {
      setToolsOpen(false);
      setTabsShown((open) => !open);
      return;
    }
    setTabsShown(false);
    if (zone === "none") return;
    setToolsOpen(false);
    turn(zone === "forward" ? 1 : -1);
  };
  const onTap = (event: React.MouseEvent<HTMLElement>): void => tapAt(event.clientX, event.clientY, event.target);
  // The bars hide themselves after 5 s untouched.
  useEffect(() => {
    if (!tabsShown) return;
    const timer = window.setTimeout(() => setTabsShown(false), 5000);
    return () => window.clearTimeout(timer);
  }, [tabsShown]);
  const [isFirstOpen, setIsFirstOpen] = useState<boolean>(() => safeLocal("avora.reader.zones-seen") !== "1");
  const dismissFirstOpen = (): void => {
    setIsFirstOpen(false);
    try {
      window.localStorage.setItem("avora.reader.zones-seen", "1");
    } catch {
      // Shown again next time; harmless.
    }
  };

  // ------------------------------------------------------------------ selection → note
  useEffect(() => {
    const onSelect = (): void => {
      const picked = window.getSelection();
      const chosen = picked?.toString().trim() ?? "";
      const root = paged ? flowRef.current : scrollRef.current;
      if (picked === null || chosen.length < 2 || picked.rangeCount === 0 || root === null) return setSelection(null);
      const range = picked.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return setSelection(null);
      const rect = range.getBoundingClientRect();
      setSelection({ text: chosen, top: Math.max(64, rect.top - 52), left: Math.min(window.innerWidth - 260, Math.max(12, rect.left + rect.width / 2 - 130)) });
    };
    document.addEventListener("selectionchange", onSelect);
    return () => document.removeEventListener("selectionchange", onSelect);
  }, [paged]);

  const toNotes = async (): Promise<void> => {
    if (selection === null || book === null || text === null) return;
    try {
      const journalId = findJournal(conversations)?.conversationId ?? (await ensureJournalConversation());
      const where = text.chapters[chapter]?.title ?? `Chương ${chapter + 1}`;
      const params = new URLSearchParams({ xem: "ghi-chep", sach: book.id, ten: book.title, trich: clipExcerpt(selection.text), cho: where.slice(0, 120) });
      // AVORA-93 · 3.3: where the passage is, so kệ 5 can open it again.
      const place = currentPlace();
      if (place !== null) params.set("o", place.locator);
      save();
      navigate(withReturn(`/tin-nhan/${journalId}?${params.toString()}`, { path: `${location.pathname}${location.search}`, label: book.title.slice(0, 40) }));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Chưa mở được Ghi chép.");
    }
  };

  const leaveQuiet = useCallback((): void => {
    if (!quiet.quiet) return;
    setQuietReading(false);
    void supabase.rpc("set_quiet_reading", { p_on: false });
    const n = takeMissed();
    if (n > 0) toast(`Có ${n} tin nhắn trong lúc bạn đọc ›`, { action: { label: "Xem", onClick: () => navigate("/tin-nhan") } });
  }, [quiet.quiet, navigate]);
  const leaveQuietRef = useRef(leaveQuiet);
  leaveQuietRef.current = leaveQuiet;
  useEffect(() => () => leaveQuietRef.current(), []);
  // At most three hours, even if the reader stays open.
  useEffect(() => {
    if (!quiet.quiet) return;
    const timer = window.setTimeout(() => leaveQuietRef.current(), 3 * 3_600_000);
    return () => window.clearTimeout(timer);
  }, [quiet.quiet]);

  // AVORA-94B · luật 1: one way back (history → `tu` → Kế hoạch kệ 5), never a push.
  const readerBack = useBack({ path: "/ke-hoach?ke=5", label: "Kế hoạch" });
  const back = (): void => {
    save();
    readerBack.back();
  };
  const backPress = useBackPress(back);
  // AVORA-94B · PHẦN C: never a spinner forever — after 10 s say so, with `Thử lại`.
  const [isSlow, setIsSlow] = useState<boolean>(false);

  // ------------------------------------------------------------------ C5 · messages while reading
  useEffect(() => {
    const onMessage = async (event: Event): Promise<void> => {
      const signal = (event as CustomEvent<IncomingMessageSignal>).detail;
      if (signal.isReading) return;
      if (quiet.quiet) {
        countMissed();
        return;
      }
      const summary = (conversations ?? []).find((item) => item.conversationId === signal.conversationId);
      let line = "Tin nhắn mới";
      try {
        const latest = await fetchMessages(signal.conversationId);
        line = latest.slice(-1)[0]?.content ?? line;
      } catch {
        // The strip still says who.
      }
      setStrip({ conversationId: signal.conversationId, name: summary === undefined ? "Tin nhắn" : conversationTitle(summary), line });
    };
    const listener = (event: Event): void => void onMessage(event);
    window.addEventListener(INCOMING_MESSAGE_EVENT, listener);
    return () => window.removeEventListener(INCOMING_MESSAGE_EVENT, listener);
  }, [conversations, quiet.quiet]);
  useEffect(() => {
    if (strip === null) return;
    const timer = window.setTimeout(() => setStrip(null), 6000);
    return () => window.clearTimeout(timer);
  }, [strip]);

  // ------------------------------------------------------------------ C4 · on-device translation
  const translateChapter = useCallback(
    async (index: number, target: string): Promise<void> => {
      const blocks = text?.chapters[index]?.blocks;
      const translator = translatorRef.current;
      if (blocks == null || translator === null || text === null) return;
      const key = `${text.source}:${text.sourceId}:${index}:${target}`;
      const kept = await keptTranslation(key);
      if (kept !== null) {
        setTranslated((all) => ({ ...all, [index]: kept }));
        return;
      }
      const out: string[] = [];
      for (const block of blocks) {
        // One paragraph at a time, never blocking a page turn.
        out.push(block.k === "p" || block.k === "h" ? await translator.translate(block.t).catch(() => block.t) : "");
      }
      setTranslated((all) => ({ ...all, [index]: out }));
      await keepTranslation(key, out);
    },
    [text],
  );
  const startTranslate = async (target: string): Promise<void> => {
    const api = translatorApi();
    if (api === null || text === null || !canTranslateChapter) return;
    try {
      const availability = await api.availability({ sourceLanguage: text.language, targetLanguage: target });
      if (availability === "unavailable") {
        toast.error("Máy này chưa dịch được cặp ngôn ngữ này.");
        return;
      }
      setTranslating({ target, progress: availability === "available" ? null : "Đang tải gói ngôn ngữ…" });
      translatorRef.current = await api.create({
        sourceLanguage: text.language,
        targetLanguage: target,
        monitor: (monitor) =>
          monitor.addEventListener("downloadprogress", (event) => {
            const loaded = (event as unknown as { loaded: number }).loaded;
            setTranslating({ target, progress: loaded >= 1 ? null : `Đang tải gói ngôn ngữ… ${Math.round(loaded * 100)}%` });
          }),
      });
      setTranslating({ target, progress: null });
      setPanel(null);
      setShowOriginal(false);
      await translateChapter(chapter, target);
    } catch {
      toast.error("Chưa dịch được trên máy này.");
      setTranslating(null);
    }
  };
  // ------------------------------------------------------------------ AVORA-93 · 2.4 / 2.6 · two ways
  const translationConfig = useTranslationConfig();
  const engine = deviceEngine();
  // Whole-chapter machine translation only on an engine VMT approved (ADR-060); otherwise lookups only.
  const canTranslateChapter = engine !== null && translationConfig.chapterEngines.includes(engine);
  const [lookup, setLookup] = useState<{ source: string; word: string | null; out: string | null; sentenceOut: string | null; error: string | null; top: number } | null>(null);
  const runLookup = async (): Promise<void> => {
    if (selection === null || text === null) return;
    const picked = selection.text.trim();
    const top = Math.min(window.innerHeight - 220, selection.top + 64);
    if (picked.length > LOOKUP_MAX_CHARS) {
      setLookup({ source: picked, word: null, out: null, sentenceOut: null, error: "Chọn ngắn lại — tra tối đa một đoạn", top });
      return;
    }
    const api = translatorApi();
    const target = text.language === "vi" ? "en" : "vi";
    if (api === null) {
      setLookup({ source: picked, word: null, out: null, sentenceOut: null, error: NO_DEVICE_TRANSLATION, top });
      return;
    }
    const isWord = !/\s/.test(picked);
    const paragraph = window.getSelection()?.anchorNode?.parentElement?.closest("p, blockquote, li")?.textContent ?? picked;
    setLookup({ source: picked, word: isWord ? picked : null, out: null, sentenceOut: null, error: null, top });
    try {
      // On this device only: the picked words never leave it.
      const translator = await api.create({ sourceLanguage: text.language, targetLanguage: target });
      const out = await translator.translate(picked);
      const sentenceOut = isWord ? await translator.translate(sentenceAround(paragraph, picked)) : null;
      setLookup((current) => (current?.source === picked ? { ...current, out, sentenceOut } : current));
    } catch {
      setLookup((current) => (current?.source === picked ? { ...current, error: NO_DEVICE_TRANSLATION } : current));
    }
  };
  const lookupToNotes = async (): Promise<void> => {
    if (lookup === null || lookup.out === null || book === null || text === null) return;
    try {
      const journalId = findJournal(conversations)?.conversationId ?? (await ensureJournalConversation());
      const where = text.chapters[chapter]?.title ?? `Chương ${chapter + 1}`;
      const params = new URLSearchParams({ xem: "ghi-chep", sach: book.id, ten: book.title, trich: clipExcerpt(`${lookup.source} → ${lookup.out}`), cho: where.slice(0, 120) });
      const place = currentPlace();
      if (place !== null) params.set("o", place.locator);
      save();
      navigate(withReturn(`/tin-nhan/${journalId}?${params.toString()}`, { path: `${location.pathname}${location.search}`, label: book.title.slice(0, 40) }));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Chưa mở được Ghi chép.");
    }
  };
  // ~50% into a chapter: the next one is translated ahead (in the background).
  const progressInChapter = paged ? (pages <= 1 ? 1 : page / (pages - 1)) : 0;
  useEffect(() => {
    if (translating === null || translating.progress !== null || text === null) return;
    if (translated[chapter] === undefined) void translateChapter(chapter, translating.target);
    const next = chapter + 1;
    if (progressInChapter >= 0.5 && next < text.chapters.length && translated[next] === undefined) {
      void ensurePart(next).then(() => translateChapter(next, translating.target));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by chapter / progress
  }, [translating, chapter, progressInChapter >= 0.5]);

  // ------------------------------------------------------------------ settings
  const change = (patch: Partial<ReaderSettings>): void => {
    const next = { ...look, ...patch };
    anchorRef.current = currentPlace()?.block ?? anchorRef.current;
    setDraft(next);
    void setPref("reader", next).catch(() => undefined);
  };

  const togglePin = async (): Promise<void> => {
    try {
      await setBookPin(recordId, !isPinned);
      void queryClient.invalidateQueries({ queryKey: ["book-reading-state"] });
      toast.success(isPinned ? "Đã bỏ ghim." : "Đã ghim để đọc trước.");
    } catch (caught) {
      if (caught instanceof PinFullError) setPanel("pin");
      else toast.error(caught instanceof Error ? caught.message : "Chưa ghim được.");
    }
  };
  const download = async (): Promise<void> => {
    if (ref === null) return;
    try {
      const full = await downloadBook(ref.source, ref.sourceId, (done, total) => setDownloading(`${done}/${total}`));
      setText((cur) => (cur === null ? full : { ...cur, chapters: full.chapters }));
      setOnDevice(true);
      toast.success("Đã tải cả cuốn về máy.");
    } catch (caught) {
      if (caught instanceof DeviceFullError) setIsDeviceFull(true);
      else toast.error(caught instanceof BookTextError ? caught.message : "Chưa tải được.");
    } finally {
      setDownloading(null);
    }
  };

  /** D3 · finished (≥ 95 %, or marked): ask once whether to let it go from this device. */
  const offerLetGo = useCallback(async (): Promise<void> => {
    if (ref === null || book === null || wasFinishAsked(book.id) || !(await isOnDevice(ref.source, ref.sourceId))) return;
    markFinishAsked(book.id);
    const letGo = await askConfirm({ title: "Bạn đã đọc xong", body: "Bỏ cuốn này khỏi máy để dành chỗ cho cuốn tiếp theo?", confirmLabel: "Bỏ khỏi máy", cancelLabel: "Giữ lại" });
    if (!letGo) return;
    await removeFromDevice(ref.source, ref.sourceId);
    setOnDevice(false);
    void queryClient.invalidateQueries({ queryKey: ["books-on-device"] });
    toast.success("Đã bỏ khỏi máy. Ghi chú và chỗ đang đọc vẫn còn.");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref is derived from the link string
  }, [ref?.source, ref?.sourceId, book, queryClient]);
  offerLetGoRef.current = offerLetGo;
  const markFinished = async (): Promise<void> => {
    if (book === null) return;
    try {
      await actions.updateRecord(book.id, { status: "da_doc" });
      toast.success("Đã chuyển sang Đã đọc.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Không lưu được.");
      return;
    }
    await offerLetGo();
  };

  const isOpeningBook = shelfPending || (book !== null && ref !== null && text === null && loadError === null);
  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
  useEffect(() => {
    if (!isOpeningBook) {
      setIsSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setIsSlow(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [isOpeningBook]);

  // ------------------------------------------------------------------ render
  const isLast = text !== null && chapter === text.chapters.length - 1;
  const language = text?.language ?? "vi";
  const epub = epubOf(ref);
  const minutes = minutesLeft(pageTimesRef.current, Math.max(0, pages - page - 1));
  const pageNumber = Math.min(page + 1, pages);
  const nextBlocks = text !== null && chapter + 1 < text.chapters.length ? (text.chapters[chapter + 1]?.blocks ?? null) : null;

  const stuckBar = (
    <header className="flex items-center gap-1 px-1.5 pt-[max(env(safe-area-inset-top),0.25rem)]">
      <button type="button" {...backPress} aria-label="Quay lại. Giữ để về đầu Kế hoạch" data-back="" className="icon-btn no-callout h-11 w-11 select-none [touch-action:manipulation]">
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
    </header>
  );
  if (isOpeningBook) {
    return (
      <div className="paper flex min-h-0 flex-1 flex-col" data-reader-loading="">
        {stuckBar}
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center" role="status">
          {isSlow ? (
            <>
              <p className="max-w-sm text-[15px] text-muted-foreground">{isOffline ? "Đang không có mạng. " : ""}Chưa mở được sách.</p>
              <button type="button" onClick={() => window.location.reload()} className="press mt-4 min-h-11 rounded-md border border-border bg-card px-5 text-[14px] font-medium">Thử lại</button>
            </>
          ) : (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="sr-only">Đang mở sách</span>
            </>
          )}
        </div>
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
          ‹ {readerBack.label}
        </button>
      </div>
    );
  }
  if (text === null || book === null) {
    // No shelf to read from (or nothing to show): explain and offer `‹`, never a blank screen.
    return (
      <div className="paper flex min-h-0 flex-1 flex-col" data-reader-empty="">
        {stuckBar}
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p role="alert" className="max-w-sm text-[15px] text-muted-foreground">Chưa có Kệ sách để mở cuốn này. Thêm sách từ Kế hoạch › Đọc &amp; Nhật ký.</p>
        </div>
      </div>
    );
  }

  const articleStyle: CSSProperties = {
    fontSize: `${READER_SIZES[look.size]}px`,
    lineHeight: READER_LEADING[look.leading].value,
    fontFamily: font.family,
    textAlign: look.justify ? "justify" : "start",
    hyphens: look.justify ? "auto" : "manual",
    color: theme.ink,
  };
  const margin = READER_MARGINS[look.margin].px;
  const blocks = (shown ?? []).map((block, index) => <Block key={index} block={block} index={index} muted={theme.muted} />);
  const endOfChapter = (
    <>
      {isLast ? <AboutEdition text={text} epub={epub} /> : null}
      {nextBlocks !== null ? (
        // C4 ②: the next chapter already in the page (out of sight) so the browser translates it ahead.
        <div aria-hidden="true" data-next-chapter="" lang={language} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          {nextBlocks.map((block, index) => (block.k === "p" || block.k === "h" ? <p key={index}>{block.t}</p> : null))}
        </div>
      ) : null}
    </>
  );

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col"
      style={{ backgroundColor: theme.paper, color: theme.ink, paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      data-reader=""
      data-theme={look.theme}
      data-turn={look.turn}
      data-turn-effect={effect}
      data-spread={spread ? "" : undefined}
    >
      {toolsOpen ? (
        <header className="absolute inset-x-0 top-0 z-30 flex items-center gap-0.5 border-b px-1.5 pb-1 pt-[max(env(safe-area-inset-top),0.25rem)] shadow-sm" style={{ backgroundColor: theme.paper, borderColor: `${theme.muted}33` }} data-reader-tools="">
          <button type="button" {...backPress} aria-label={`Quay lại ${readerBack.label}. Giữ để về đầu Kế hoạch`} data-back="" className="icon-btn no-callout h-11 w-11 select-none [touch-action:manipulation]">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <p className="min-w-0 flex-1 truncate px-1 text-[14px] font-semibold">{book.title}</p>
          <button type="button" onClick={() => setPanel("toc")} aria-label="Mục lục" className="icon-btn h-11 w-11">
            <List className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setPanel("aa")} aria-label="Chữ và giao diện" className="icon-btn h-11 w-11">
            <Type className="h-5 w-5" aria-hidden="true" />
          </button>
          {language !== "vi" ? (
            <button type="button" onClick={() => setPanel("translate")} aria-label="Dịch" className="icon-btn h-11 w-11">
              <Languages className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            aria-pressed={quiet.quiet}
            aria-label="Đọc yên tĩnh"
            onClick={() => {
              if (quiet.quiet) leaveQuiet();
              else {
                setQuietReading(true);
                void supabase.rpc("set_quiet_reading", { p_on: true });
                toast("Đọc yên tĩnh · tối đa 3 giờ", { description: "Chỉ áp dụng cho Avora. Muốn im cả máy, bật chế độ Tập trung của điện thoại." });
              }
            }}
            className={cn("icon-btn h-11 w-11", quiet.quiet && "text-personal")}
          >
            <Moon className={cn("h-5 w-5", quiet.quiet && "fill-current")} aria-hidden="true" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="Thêm" className="icon-btn h-11 w-11">
              <MoreHorizontal className="h-5 w-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void togglePin()}>
                <Pin className="mr-2 h-4 w-4" /> {isPinned ? "Bỏ ghim" : "Ghim để đọc trước"}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={onDevice || downloading !== null} onSelect={() => void download()}>
                <Download className="mr-2 h-4 w-4" /> {onDevice ? "Đã có trên máy ✓" : downloading !== null ? `Đang tải ${downloading}` : "Tải về"}
              </DropdownMenuItem>
              {book !== null && book.status !== "da_doc" ? (
                <DropdownMenuItem onSelect={() => void markFinished()}>
                  <BookCheck className="mr-2 h-4 w-4" /> Đánh dấu đã đọc xong
                </DropdownMenuItem>
              ) : null}
              {epub !== null ? (
                <DropdownMenuItem onSelect={() => window.open(epub, "_blank", "noopener")}>
                  <Download className="mr-2 h-4 w-4" /> Mở bằng app đọc trên máy
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
      ) : null}

      {strip !== null && !quiet.quiet ? (
        <div className="absolute inset-x-2 top-[max(env(safe-area-inset-top),0.5rem)] z-40 mx-auto flex max-w-md items-center gap-2 rounded-card border border-border bg-card px-3 py-2 text-foreground shadow-lg" data-message-strip="" role="status">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold">{strip.name}</span>
            <span className="block truncate text-[12.5px] text-muted-foreground">{strip.line}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              save();
              setPeek(strip.conversationId);
              setStrip(null);
            }}
            className="press shrink-0 rounded-md bg-personal px-2.5 py-1.5 text-[12.5px] font-semibold text-personal-foreground"
          >
            Xem nhanh
          </button>
        </div>
      ) : null}

      {offer !== null ? (
        <div className="relative z-20 flex shrink-0 flex-wrap items-center gap-2 bg-personal-soft px-4 py-2 text-[13.5px] text-personal-soft-foreground" data-reading-offer="">
          <span className="min-w-0 flex-1">Bạn đã đọc tới {Math.round(offer.percent)}% trên {offer.deviceLabel ?? "máy khác"} — mở tới đó?</span>
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
      {translating !== null && !showOriginal ? (
        <p className="relative z-20 shrink-0 px-4 py-1 text-center text-[12px]" style={{ color: theme.muted }} data-translation-line="">
          {translating.progress ?? `Bản dịch máy · ${translating.target === "vi" ? "Tiếng Việt" : translating.target}${translated[chapter + 1] !== undefined ? ` · chương ${chapter + 2} đã dịch sẵn` : ""}`}{" "}
          <button type="button" onClick={() => setShowOriginal(true)} className="press font-medium underline underline-offset-2">
            Xem bản gốc
          </button>
        </p>
      ) : null}

      {paged ? (
        <div
          ref={viewportRef}
          className="relative min-h-0 flex-1 cursor-default overflow-hidden"
          style={{ margin: `${toolsOpen ? 56 : 24}px ${margin}px 8px`, perspective: effect === "curl" ? "1600px" : undefined }}
          onClick={onTap}
          onTouchStart={(event) => (swipeRef.current = { x: event.touches[0]?.clientX ?? 0, y: event.touches[0]?.clientY ?? 0 })}
          onTouchEnd={(event) => {
            const start = swipeRef.current;
            swipeRef.current = null;
            const dx = (event.changedTouches[0]?.clientX ?? 0) - (start?.x ?? 0);
            const dy = (event.changedTouches[0]?.clientY ?? 0) - (start?.y ?? 0);
            if (start !== null && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
              event.preventDefault();
              turn(dx < 0 ? 1 : -1);
            }
          }}
        >
          {body === null || isPartLoading ? (
            <p className="flex items-center gap-2 text-[15px]" role="status" style={{ color: theme.muted }}>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Đang tải chương…
            </p>
          ) : (
            <article
              ref={flowRef}
              lang={language}
              key={`${chapter}-${effect}`}
              data-page={page}
              className={cn("reader-flow h-full", effect === "fade" && "reader-turn-fade", effect === "curl" && "reader-turn-curl")}
              style={{
                ...articleStyle,
                columnWidth: `${columnWidth}px`,
                columnGap: `${GAP}px`,
                columnFill: "auto",
                height: "100%",
                transform: `translateX(${-page * step}px)`,
                transition: effect === "slide" ? "transform 220ms ease-out" : undefined,
              }}
            >
              {blocks}
              {endOfChapter}
            </article>
          )}
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" data-scroll-memory="" onClick={onTap}>
          <article lang={language} className="mx-auto max-w-[40rem] pb-24 pt-14" style={{ ...articleStyle, paddingLeft: margin, paddingRight: margin }}>
            {body === null || isPartLoading ? <p role="status">Đang tải chương…</p> : blocks}
            {endOfChapter}
          </article>
        </div>
      )}

      <footer className="relative z-20 shrink-0 px-4 pb-1.5 pt-1 text-center text-[11.5px] tabular-nums" style={{ color: theme.muted }} data-reader-foot="">
        {toolsOpen ? (
          <div className="mx-auto flex max-w-xl flex-col gap-1 pb-1" data-reader-progress="">
            <input
              type="range"
              min={0}
              max={Math.max(0, pages - 1)}
              value={page}
              aria-label="Trang trong chương"
              onChange={(event) => {
                const next = Number(event.target.value);
                anchorRef.current = blockAtPage(next);
                setPage(next);
              }}
              className="w-full accent-[hsl(var(--personal))]"
            />
            <span>
              Trang {pageNumber} / {pages} · Chương {chapter + 1}
              {onDevice ? " · có trên máy ✓" : ""}
            </span>
          </div>
        ) : (
          <span>
            {minutes !== null ? `Còn ${minutes} phút trong chương · ` : ""}trang {pageNumber} / {pages}
          </span>
        )}
      </footer>

      {selection !== null ? (
        <div role="toolbar" aria-label="Đoạn đang chọn" data-selection-bar="" className="fixed z-50 flex w-[280px] items-center gap-1 rounded-card border border-border bg-card p-1 text-foreground shadow-lg" style={{ top: selection.top, left: selection.left }}>
          {/* AVORA-93 · 2.6: Dịch · Ghi chú · Chép. Lookups stay on this device. */}
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void runLookup()} className="press flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[13px] font-semibold text-personal hover:bg-accent/40">
            <Languages className="h-4 w-4" aria-hidden="true" /> Dịch
          </button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void toNotes()} className="press flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[13px] hover:bg-accent/40">
            <NotebookPen className="h-4 w-4" aria-hidden="true" /> Ghi chú
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
            <Copy className="h-4 w-4" aria-hidden="true" /> Chép
          </button>
        </div>
      ) : null}

      {/* Mục lục */}
      <Sheet open={panel === "toc"} onOpenChange={(open) => !open && setPanel(null)}>
        <SheetContent side="right" className="flex w-full max-w-sm flex-col p-0" aria-label="Mục lục">
          <SheetTitle className="border-b border-border px-4 py-3 text-[16px]">Mục lục</SheetTitle>
          <SheetDescription className="sr-only">Các chương của sách</SheetDescription>
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
        </SheetContent>
      </Sheet>

      {/* Aa */}
      <Sheet open={panel === "aa"} onOpenChange={(open) => !open && setPanel(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[80dvh] max-w-lg overflow-y-auto rounded-t-card" data-reader-aa="">
          <SheetTitle className="text-[17px]">Chữ và giao diện</SheetTitle>
          <SheetDescription className="sr-only">Cỡ chữ, kiểu chữ, giao diện, lề, giãn dòng, cách sang trang</SheetDescription>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" aria-label="Chữ nhỏ hơn" disabled={look.size === 0} onClick={() => change({ size: look.size - 1 })} className="press h-11 w-14 rounded-lg border border-border text-[15px] disabled:opacity-40">A−</button>
            <div className="flex flex-1 justify-between" aria-label={`Cỡ chữ nấc ${look.size + 1} / 7`} data-size-step={look.size + 1}>
              {READER_SIZES.map((px, index) => (
                <button key={px} type="button" aria-label={`Nấc ${index + 1}`} onClick={() => change({ size: index })} className={cn("h-2.5 w-2.5 rounded-full", index <= look.size ? "bg-personal" : "bg-border")} />
              ))}
            </div>
            <button type="button" aria-label="Chữ to hơn" disabled={look.size === READER_SIZES.length - 1} onClick={() => change({ size: look.size + 1 })} className="press h-11 w-14 rounded-lg border border-border text-[18px] disabled:opacity-40">A+</button>
          </div>
          <Choice label="Kiểu chữ" value={look.font} options={READER_FONTS.map((f) => ({ id: f.id, label: f.label }))} onPick={(id) => change({ font: id })} />
          <div className="mt-4">
            <p className="mb-1.5 text-[13px] font-medium">Giao diện</p>
            <div className="grid grid-cols-4 gap-2">
              {READER_THEMES.map((item) => (
                <button key={item.id} type="button" aria-pressed={look.theme === item.id} onClick={() => change({ theme: item.id })} className={cn("press flex h-14 flex-col items-center justify-center rounded-lg border text-[12.5px]", look.theme === item.id ? "border-personal ring-2 ring-personal/40" : "border-border")} style={{ backgroundColor: item.paper, color: item.ink }}>
                  Aa<span className="text-[11px]">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
          <Choice label="Lề" value={look.margin} options={(["hep", "vua", "rong"] as const).map((id) => ({ id, label: READER_MARGINS[id].label }))} onPick={(id) => change({ margin: id })} />
          <Choice label="Giãn dòng" value={look.leading} options={(["gon", "vua", "thoang"] as const).map((id) => ({ id, label: READER_LEADING[id].label }))} onPick={(id) => change({ leading: id })} />
          <Choice label="Cách sang trang" value={look.turn} options={[{ id: "lat", label: "Lật trái / phải" }, { id: "cuon", label: "Cuộn liền" }]} onPick={(id) => change({ turn: id })} />
          <label className="mt-4 flex items-center justify-between gap-3 text-[14px]">
            Căn đều hai bên <Switch checked={look.justify} onCheckedChange={(on) => change({ justify: on })} aria-label="Căn đều hai bên" />
          </label>
          <label className="mt-3 flex items-center justify-between gap-3 text-[14px]">
            <span>
              Hiệu ứng lật giấy
              {reducedMotion ? <span className="block text-[12px] text-muted-foreground">Máy đang bật giảm chuyển động — trang chỉ mờ dần.</span> : null}
            </span>
            <Switch checked={look.curl} onCheckedChange={(on) => change({ curl: on })} aria-label="Hiệu ứng lật giấy" />
          </label>
        </SheetContent>
      </Sheet>

      {/* Dịch */}
      <Sheet open={panel === "translate"} onOpenChange={(open) => !open && setPanel(null)}>
        <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-card" data-reader-dich="">
          <SheetTitle className="text-[17px]">Dịch sách {LANGUAGE_NAMES[language] ?? ""}</SheetTitle>
          <SheetDescription className="text-[13px]">Dịch trên máy — chữ sách không rời máy, bản dịch không lưu ở máy chủ.</SheetDescription>
          {canTranslateChapter ? (
            <div className="mt-3 space-y-2">
              <button type="button" onClick={() => void startTranslate("vi")} className="press flex h-12 w-full items-center justify-center rounded-control bg-personal text-[15px] font-semibold text-personal-foreground">
                Dịch cả chương sang Tiếng Việt
              </button>
              {translating?.progress != null ? <p className="text-center text-[13px] text-muted-foreground">{translating.progress}</p> : null}
            </div>
          ) : (
            <div className="mt-3 space-y-2" data-translate-help="">
              {/* AVORA-93 · 2.4 (3): honest — no whole-chapter machine translation until it reads well. */}
              <p className="rounded-card bg-secondary/60 px-4 py-3 text-[14.5px]">Sách này chưa có bản dịch tiếng Việt đủ hay để đọc liền mạch. Giữ ngón tay lên chữ để tra từ hoặc đoạn.</p>
              {engine === null ? <p className="text-[13px] text-muted-foreground">{NO_DEVICE_TRANSLATION}</p> : null}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {lookup !== null ? (
        <div role="dialog" aria-label="Tra nghĩa" data-lookup-card="" className="fixed inset-x-3 z-50 mx-auto max-h-[45vh] max-w-md overflow-y-auto rounded-card border border-border bg-card p-3 text-foreground shadow-xl" style={{ top: lookup.top }}>
          <BackClosesBinding close={() => setLookup(null)} />
          <div className="flex items-start gap-2">
            <p className="line-clamp-2 min-w-0 flex-1 text-[13px] text-muted-foreground" lang={language}>{lookup.source}</p>
            <button type="button" onClick={() => setLookup(null)} aria-label="Đóng" className="icon-btn h-8 w-8"><X className="h-4 w-4" aria-hidden="true" /></button>
          </div>
          {lookup.error !== null ? (
            <p className="mt-1 text-[14px]" data-lookup-error="">{lookup.error}</p>
          ) : lookup.out === null ? (
            <p className="mt-1 flex items-center gap-2 text-[14px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Đang dịch trên máy…</p>
          ) : (
            <>
              <p className="mt-1 text-[17px] font-medium leading-snug">{lookup.word !== null ? `${lookup.word} → ${lookup.out}` : lookup.out}</p>
              {lookup.sentenceOut !== null ? <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{lookup.sentenceOut}</p> : null}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11.5px] text-muted-foreground">Dịch máy · để hiểu ý</span>
                <button type="button" onClick={() => void lookupToNotes()} className="press h-9 rounded-lg px-2.5 text-[13px] font-medium text-personal">Ghi vào Nhật ký</button>
              </div>
            </>
          )}
        </div>
      ) : null}
      {/* AVORA-93 · 4.1: the four zones as buttons for keyboard / VoiceOver (taps on the page use the same rule). */}
      <div className="sr-only">
        <button type="button" onClick={() => setToolsOpen((open) => !open)}>Hiện công cụ đọc</button>
        <button type="button" onClick={() => turn(-1)}>Trang trước</button>
        <button type="button" onClick={() => turn(1)}>Trang sau</button>
        <button type="button" onClick={() => setTabsShown((open) => !open)}>Hiện các tab</button>
      </div>
      {/* The bottom band also catches taps outside the page frame (footer). */}
      <button type="button" aria-label="Hiện các tab" data-reader-bottom-band="" onClick={() => { setToolsOpen(false); setTabsShown((open) => !open); }} className="absolute inset-x-0 bottom-0 z-[25] bg-transparent" style={{ height: `${READER_BOTTOM_BAND - 40}px` }} />
      {tabsShown ? <TempTabBar onHide={() => setTabsShown(false)} /> : null}
      {isFirstOpen ? (
        <button type="button" onClick={dismissFirstOpen} data-reader-zones-intro="" className="absolute inset-0 z-[60] flex flex-col bg-foreground/60 text-background">
          <span className="flex items-center justify-center border-b border-dashed border-background/50 text-[13px]" style={{ height: `calc(env(safe-area-inset-top) + ${READER_TOP_BAND}px)` }}>Chạm: công cụ đọc</span>
          <span className="flex flex-1">
            <span className="flex flex-1 items-center justify-center border-r border-dashed border-background/50 text-[13px]">‹ Trang trước</span>
            <span className="flex flex-1 items-center justify-center text-[13px]">Trang sau ›</span>
          </span>
          <span className="flex items-center justify-center border-t border-dashed border-background/50 text-[13px]" style={{ height: `${READER_BOTTOM_BAND}px` }}>Chạm: các tab</span>
          {/* AVORA-94: kept clear of the ‹ › labels at mid-height (they overlapped at 390). */}
          <span className="absolute inset-x-0 text-center text-[17px] font-semibold" style={{ bottom: `${READER_BOTTOM_BAND + 28}px` }}>Chạm để bắt đầu đọc</span>
        </button>
      ) : null}
      <DeviceFullSheet open={isDeviceFull} onOpenChange={setIsDeviceFull} onRoom={() => void download()} />
      <PinFullSheet open={panel === "pin"} onClose={() => setPanel(null)} books={books.map((item) => ({ id: item.id, title: item.title }))} states={allStates.data ?? []} wanted={recordId} />
      <QuickPeek conversationId={peek} page={pageNumber} onClose={() => setPeek(null)} />
    </div>
  );
};

function safeLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function Choice<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: readonly { id: T; label: string }[]; onPick: (id: T) => void }) {
  return (
    <div className="mt-4">
      <p className="mb-1.5 text-[13px] font-medium">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => onPick(option.id)} className={cn("press min-h-10 rounded-full border px-3 text-[13px]", value === option.id ? "border-personal bg-personal-soft font-semibold text-personal-soft-foreground" : "border-border")}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AboutEdition({ text, epub }: { text: BookText; epub: string | null }) {
  return (
    <section aria-label="Về bản này" data-about-edition="" className="mt-10 break-before-column rounded-card border border-border bg-card/70 p-5 font-sans text-[13px] leading-relaxed text-muted-foreground" style={{ textAlign: "start" }}>
      <h2 className="text-[15px] font-semibold text-foreground">Về bản này</h2>
      <p className="mt-1">
        Nguồn: {sourceLine(text.source)} ·{" "}
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
        <div className="mt-3 space-y-2 whitespace-pre-line" lang={text.source === "wikisource" ? "vi" : text.language}>
          {text.license.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** C6: a fourth pin asks which one to drop. */
function PinFullSheet({ open, onClose, books, states, wanted }: { open: boolean; onClose: () => void; books: { id: string; title: string }[]; states: ReadingState[]; wanted: string }) {
  const queryClient = useQueryClient();
  const pinned = states.filter((state) => state.pinnedAt != null).map((state) => books.find((book) => book.id === state.recordId)).filter((book): book is { id: string; title: string } => book !== undefined);
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-card" data-pin-full="">
        <SheetTitle className="text-[17px]">Đã ghim 3 cuốn</SheetTitle>
        <SheetDescription className="text-[13.5px]">Bỏ ghim cuốn nào để ghim cuốn này?</SheetDescription>
        <ul className="mt-2">
          {pinned.map((book) => (
            <li key={book.id} className="border-b border-border/60 last:border-b-0">
              <button
                type="button"
                onClick={async () => {
                  onClose();
                  try {
                    await setBookPin(book.id, false);
                    await setBookPin(wanted, true);
                    void queryClient.invalidateQueries({ queryKey: ["book-reading-state"] });
                    toast.success("Đã ghim để đọc trước.");
                  } catch (caught) {
                    toast.error(caught instanceof Error ? caught.message : "Chưa ghim được.");
                  }
                }}
                className="press flex min-h-14 w-full items-center gap-3 py-2 text-left"
              >
                <Pin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[15px]">{book.title}</span>
                <span className="text-[13px] font-medium text-personal">Bỏ ghim</span>
              </button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

/** C5 · `Xem nhanh`: a drawer of the last messages, a quick reply, and `Quay lại trang x`. */
function QuickPeek({ conversationId, page, onClose }: { conversationId: string | null; page: number; onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: conversations } = useConversations();
  const [reply, setReply] = useState<string>("");
  const messages = useQuery<ChatMessage[], Error>({
    queryKey: ["reader-peek", conversationId],
    queryFn: () => fetchMessages(conversationId as string),
    enabled: conversationId !== null,
  });
  const summary = (conversations ?? []).find((item) => item.conversationId === conversationId);
  const send = async (): Promise<void> => {
    if (conversationId === null || user?.id === undefined || reply.trim() === "") return;
    try {
      await sendMessage(conversationId, user.id, reply.trim());
      setReply("");
      void messages.refetch();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Chưa gửi được.");
    }
  };
  return (
    <Sheet open={conversationId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="mx-auto flex h-[55dvh] max-w-lg flex-col rounded-t-card" data-quick-peek="">
        <SheetTitle className="text-[16px]">{summary === undefined ? "Tin nhắn" : conversationTitle(summary)}</SheetTitle>
        <SheetDescription className="sr-only">Vài tin gần nhất</SheetDescription>
        <ul className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {(messages.data ?? []).slice(-8).map((message) => (
            <li key={message.id} className={cn("max-w-[86%] rounded-card px-3 py-1.5 text-[14.5px]", message.senderId === user?.id ? "ml-auto bg-personal text-personal-foreground" : "bg-secondary")}>
              {message.content}
            </li>
          ))}
        </ul>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <input value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Trả lời nhanh…" aria-label="Trả lời nhanh" className="h-11 min-w-0 flex-1 rounded-control border border-border bg-background px-3 text-[16px] outline-none focus:border-personal" />
          <button type="submit" disabled={reply.trim() === ""} className="press h-11 rounded-control bg-personal px-4 text-[14px] font-semibold text-personal-foreground disabled:opacity-50">Gửi</button>
        </form>
        <div className="mt-2 flex items-center justify-between gap-2">
          <button type="button" onClick={() => conversationId !== null && navigate(`/tin-nhan/${conversationId}`)} className="press min-h-11 text-[14px] font-medium text-personal">
            Mở cuộc trò chuyện ›
          </button>
          <button type="button" onClick={onClose} data-back-to-page="" className="press inline-flex h-11 items-center gap-1 rounded-control border border-border px-4 text-[14px] font-semibold">
            <X className="h-4 w-4" aria-hidden="true" /> Quay lại trang {page}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Block({ block, index, muted }: { block: BookBlock; index: number; muted: string }) {
  if (block.k === "h") {
    const Tag = block.l <= 2 ? "h2" : "h3";
    return (
      <Tag data-b={index} className={cn("mb-4 mt-8 text-balance font-semibold leading-snug first:mt-0", block.l <= 2 ? "text-[1.35em]" : "text-[1.15em]")} style={{ textAlign: "start", breakAfter: "avoid" }}>
        {block.t}
      </Tag>
    );
  }
  if (block.k === "img") {
    return (
      <figure data-b={index} className="my-6 break-inside-avoid">
        <img src={block.src} alt={block.alt.trim()} loading="lazy" className="mx-auto max-h-[60vh] max-w-full rounded-sm" />
      </figure>
    );
  }
  if (block.k === "pre") {
    return (
      <pre data-b={index} className="my-4 whitespace-pre-wrap" style={{ fontFamily: "inherit", color: muted === "" ? undefined : "inherit" }}>
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
