import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  ListChecks,
  Loader2,
  MessageSquare,
  NotebookText,
  Search,
  Table2,
  UserRound,
  Users,
  X,
  type LucideIcon,
  Repeat,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { findJournal } from "@/hooks/use-paste-task";
import { useNotes } from "@/lib/use-notes";
import { withReturn } from "@/lib/return-to";
import {
  aroundMatch,
  highlightParts,
  MIN_QUERY_LENGTH,
  resultHref,
  SCOPE_LABELS,
  SEARCH_DEBOUNCE_MS,
  SEARCH_TYPE_FILTERS,
  searchAvora,
  splitResults,
  type SearchHere,
  type SearchKind,
  type SearchResult,
} from "@/lib/search";
import { useConversations } from "@/lib/use-conversations";
import { cn } from "@/lib/utils";

const KIND_ICONS: Readonly<Record<SearchKind, LucideIcon>> = {
  message: MessageSquare,
  file: FileText,
  task: ListChecks,
  note: NotebookText,
  record: Table2,
  table: Table2,
  contact: UserRound,
  conversation: Users,
  habit: Repeat,
};

const OPEN_EVENT = "avora:search";

/** Opens the one search from anywhere (a subtab's "Tìm … trong toàn AVORA ›" line). */
export function openAvoraSearch(detail: { query: string; here: SearchHere }): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail }));
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.match ? (
          <strong key={index} className="font-semibold text-foreground">
            {part.text}
          </strong>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** 🔍 beside a tab's title: opens the search with this tab as "here". */
export function AvoraSearchButton({ here, className }: { here: SearchHere; className?: string }) {
  return (
    <button
      type="button"
      aria-label="Tìm trong toàn AVORA"
      title="Tìm trong toàn AVORA"
      onClick={() => openAvoraSearch({ query: "", here })}
      className={cn("icon-btn h-11 w-11 text-foreground", className)}
    >
      <Search className="h-[18px] w-[18px]" strokeWidth={1.6} />
    </button>
  );
}

/** "Tìm "{chữ}" trong toàn AVORA ›" under a subtab's own filter. */
export function SearchEverywhereLine({ query, here }: { query: string; here: SearchHere }) {
  if (query.trim().length < MIN_QUERY_LENGTH) return null;
  return (
    <button
      type="button"
      onClick={() => openAvoraSearch({ query, here })}
      className="press flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13.5px] text-primary hover:bg-accent/40"
    >
      <Search className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{`Tìm "${query.trim()}" trong toàn AVORA`}</span>
      <ChevronRight className="h-4 w-4 shrink-0" />
    </button>
  );
}

/**
 * The search screen (ADR-032). Mounted once for the whole app; full screen on a phone, a large box
 * on a computer. Results of where the person stands come first; the rest fold under
 * "Ở nơi khác trong AVORA". A failure says so — never an empty list that is really an error.
 */
export function AvoraSearchHost() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: conversations } = useConversations();
  const [open, setOpen] = useState<boolean>(false);
  const [here, setHere] = useState<SearchHere>({ tab: "ket-noi", label: "Kết nối" });
  const [query, setQuery] = useState<string>("");
  const [debounced, setDebounced] = useState<string>("");
  const [filter, setFilter] = useState<(typeof SEARCH_TYPE_FILTERS)[number]["id"]>("all");
  const [showElsewhere, setShowElsewhere] = useState<boolean>(false);
  const [showMoreHere, setShowMoreHere] = useState<boolean>(false);
  const notes = useNotes({ enabled: open && query.trim().startsWith("#") });

  useEffect(() => {
    const onOpen = (event: Event): void => {
      const detail = (event as CustomEvent<{ query: string; here: SearchHere }>).detail;
      setHere(detail.here);
      setQuery(detail.query);
      setDebounced(detail.query.trim());
      setFilter("all");
      setShowElsewhere(false);
      setShowMoreHere(false);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const kinds = SEARCH_TYPE_FILTERS.find((item) => item.id === filter)?.kinds ?? null;
  const results = useQuery<SearchResult[], Error>({
    queryKey: ["search-avora", debounced, here.tab, here.conversationId ?? null, filter],
    queryFn: () => searchAvora(debounced, here, kinds),
    enabled: open && debounced.length >= MIN_QUERY_LENGTH && !debounced.startsWith("#"),
    staleTime: 15_000,
  });
  const split = useMemo(() => splitResults(results.data ?? []), [results.data]);
  const journalId = findJournal(conversations)?.conversationId ?? null;

  const tagSuggestions = useMemo(() => {
    if (!query.trim().startsWith("#")) return [];
    const needle = query.trim().slice(1).toLocaleLowerCase("vi");
    const seen = new Map<string, { tag: string; count: number }>();
    for (const note of notes.liveNotes) {
      for (const tag of note.tags) {
        const key = tag.toLocaleLowerCase("vi");
        if (needle !== "" && !key.includes(needle)) continue;
        const entry = seen.get(key) ?? { tag, count: 0 };
        entry.count += 1;
        seen.set(key, entry);
      }
    }
    return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  }, [query, notes.liveNotes]);

  const go = (result: SearchResult): void => {
    const href = resultHref(result, journalId);
    if (href === null) return;
    setOpen(false);
    navigate(withReturn(href, { path: `${location.pathname}${location.search}`, label: here.label }));
  };

  const row = (result: SearchResult) => {
    const Icon = KIND_ICONS[result.kind];
    const main = result.kind === "message" ? aroundMatch(result.snippet ?? "", debounced) : (result.title ?? "");
    const sub = result.kind === "message" ? null : result.snippet !== null && result.snippet !== "" ? aroundMatch(result.snippet, debounced) : null;
    return (
      <li key={`${result.kind}:${result.id}`}>
        <button type="button" onClick={() => go(result)} className="press flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent/40">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
            <Icon className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 break-words text-[14px] text-foreground/85">
              <Highlighted text={main} query={debounced} />
            </span>
            {sub !== null ? (
              <span className="mt-0.5 line-clamp-1 text-[12.5px] text-muted-foreground">
                <Highlighted text={sub} query={debounced} />
              </span>
            ) : null}
            <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
              {`${result.placeName} · ${dayLabel(result.at)}`}
            </span>
          </span>
        </button>
      </li>
    );
  };

  const hereList = showMoreHere ? split.here : split.here.slice(0, 10);
  const scopes = (["personal", "direct", "group", "project"] as const)
    .map((scope) => ({ scope, items: split.elsewhere.filter((item) => item.scope === scope) }))
    .filter((group) => group.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[100dvh] max-w-none flex-col gap-0 rounded-none p-0 sm:h-auto sm:max-h-[86dvh] sm:max-w-[680px] sm:rounded-card [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">Tìm trong toàn AVORA</DialogTitle>
        <DialogDescription className="sr-only">Không tìm trong Két sắt.</DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm tin nhắn, tệp, nhiệm vụ, ghi chép… (không dấu cũng được)"
            aria-label="Tìm trong toàn AVORA"
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground/70"
          />
          <button type="button" aria-label="Đóng" onClick={() => setOpen(false)} className="press rounded-md p-1.5 text-muted-foreground hover:bg-accent/50">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b border-border px-4 py-2" role="group" aria-label="Loại">
          {SEARCH_TYPE_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={cn(
                "press shrink-0 rounded-full border px-3 py-1 text-[12.5px]",
                filter === item.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {query.trim().startsWith("#") ? (
            tagSuggestions.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13.5px] text-muted-foreground">Chưa có thẻ Ghi chép nào khớp.</p>
            ) : (
              <>
                <p className="px-3 pb-1 pt-1 text-[12px] font-medium text-muted-foreground">Thẻ Ghi chép</p>
                <ul className="flex flex-wrap gap-1.5 px-3">
                  {tagSuggestions.map(({ tag, count }) => (
                    <li key={tag}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          if (journalId !== null) navigate(withReturn(`/tin-nhan/${journalId}?xem=ghi-chep`, { path: `${location.pathname}${location.search}`, label: here.label }));
                        }}
                        className="press rounded-full bg-primary/10 px-2.5 py-1 text-[13px] text-primary"
                      >
                        {`#${tag} · ${count}`}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : debounced.length < MIN_QUERY_LENGTH ? (
            <p className="px-3 py-8 text-center text-[13.5px] text-muted-foreground">
              Gõ ít nhất 2 ký tự. Két sắt không nằm trong tìm chung — hãy tìm bên trong Két sắt.
            </p>
          ) : results.isPending ? (
            <div className="flex justify-center py-10" role="status" aria-label="Đang tìm">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : results.isError ? (
            <div className="px-3 py-8 text-center">
              <p role="alert" className="text-[14px] text-destructive">{results.error.message}</p>
              <button type="button" onClick={() => void results.refetch()} className="press mt-3 rounded-md border border-border px-4 py-2 text-[13px]">
                Thử lại
              </button>
            </div>
          ) : split.here.length + split.elsewhere.length === 0 ? (
            <p className="px-3 py-10 text-center text-[14px] text-muted-foreground">{`Không tìm thấy "${debounced}"`}</p>
          ) : (
            <>
              <p className="px-3 pb-1 pt-1 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{`Trong ${here.label}`}</p>
              {split.here.length === 0 ? (
                <p className="px-3 pb-2 text-[13px] text-muted-foreground">Không có kết quả ở đây.</p>
              ) : (
                <ul>{hereList.map(row)}</ul>
              )}
              {split.here.length > 10 && !showMoreHere ? (
                <button type="button" onClick={() => setShowMoreHere(true)} className="press mx-3 mb-1 text-[13px] text-primary">
                  Xem thêm
                </button>
              ) : null}
              {split.elsewhere.length > 0 ? (
                <>
                  <button
                    type="button"
                    aria-expanded={showElsewhere}
                    onClick={() => setShowElsewhere((current) => !current)}
                    className="press mt-2 flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-[12.5px] font-medium uppercase tracking-wide text-muted-foreground hover:bg-accent/40"
                  >
                    {showElsewhere ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    {`Ở nơi khác trong AVORA (${split.elsewhere.length})`}
                  </button>
                  {showElsewhere
                    ? scopes.map((group) => (
                        <section key={group.scope}>
                          <p className="px-3 pb-0.5 pt-2 text-[12px] font-medium text-muted-foreground">{SCOPE_LABELS[group.scope]}</p>
                          <ul>{group.items.map(row)}</ul>
                        </section>
                      ))
                    : null}
                </>
              ) : null}
            </>
          )}
        </div>
        <p className="flex items-center gap-1.5 border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" /> Chỉ những gì bạn đang có quyền xem. Két sắt tìm riêng bên trong Két sắt.
        </p>
      </DialogContent>
    </Dialog>
  );
}
