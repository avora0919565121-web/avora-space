import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  formatInboxTime,
  isSearchable,
  matchExcerpt,
  MESSAGE_SEARCH_MIN_LENGTH,
  searchMessages,
  type ChatMessage,
} from "@/lib/chat";
import { cn } from "@/lib/utils";

/** Long enough that typing a word does not fire a request per keystroke. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Searching inside one conversation.
 *
 * Scoped to this thread on purpose: "where did we agree that" is nearly always a question
 * about one conversation, and answering it across every thread at once would need ranking and
 * a results screen of its own. This gets you to the message, in place, and then gets out of
 * the way.
 *
 * Withdrawn messages never appear here. The recall destroyed their words, so there is nothing
 * to match — and a result that said "Tin nhắn đã được thu hồi" would be a hit on a message
 * whose contents nobody can see.
 */
export function ThreadSearch({
  conversationId,
  senderNameOf,
  onJumpTo,
  onClose,
}: {
  conversationId: string;
  senderNameOf: (message: ChatMessage) => string;
  onJumpTo: (messageId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState<string>("");
  const [debounced, setDebounced] = useState<string>("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const ready = isSearchable(debounced);

  const { data, isFetching } = useQuery<ChatMessage[], Error>({
    queryKey: ["message-search", conversationId, debounced],
    queryFn: () => searchMessages(conversationId, debounced),
    enabled: ready,
    staleTime: 30_000,
  });

  const results = useMemo(() => data ?? [], [data]);

  return (
    <div className="border-b border-border bg-card px-5 py-3 md:px-10">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <input
              autoFocus={true}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm trong cuộc trò chuyện này…"
              aria-label="Tìm trong cuộc trò chuyện này"
              className="h-11 w-full rounded-md border border-border bg-card pl-9 pr-3 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng tìm kiếm"
            className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        {query.trim() !== "" && !ready ? (
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            Nhập ít nhất {MESSAGE_SEARCH_MIN_LENGTH} ký tự.
          </p>
        ) : null}

        {ready ? (
          <div className="mt-2">
            {isFetching ? (
              <p className="flex items-center gap-2 py-2 text-[12.5px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Đang tìm…
              </p>
            ) : results.length === 0 ? (
              <p className="py-2 text-[12.5px] text-muted-foreground">
                Không có tin nhắn nào khớp. Tin đã thu hồi không tìm được.
              </p>
            ) : (
              <>
                <p className="py-1 text-[12px] text-muted-foreground">
                  {results.length} kết quả · mới nhất trước
                </p>
                <ul className="max-h-[280px] space-y-1 overflow-y-auto">
                  {results.map((message) => {
                    const excerpt = matchExcerpt(message.content, debounced);
                    const before =
                      excerpt.matchStart === -1 ? excerpt.text : excerpt.text.slice(0, excerpt.matchStart);
                    const match =
                      excerpt.matchStart === -1
                        ? ""
                        : excerpt.text.slice(
                            excerpt.matchStart,
                            excerpt.matchStart + excerpt.matchLength,
                          );
                    const after =
                      excerpt.matchStart === -1
                        ? ""
                        : excerpt.text.slice(excerpt.matchStart + excerpt.matchLength);
                    return (
                      <li key={message.id}>
                        <button
                          type="button"
                          onClick={() => onJumpTo(message.id)}
                          className={cn(
                            "press w-full rounded-[8px] border border-transparent px-2.5 py-2 text-left transition-colors",
                            "hover:border-border hover:bg-accent/40",
                          )}
                        >
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[12px] font-medium text-muted-foreground">
                              {senderNameOf(message)}
                            </span>
                            <span className="tabular shrink-0 text-[11.5px] text-muted-foreground">
                              {formatInboxTime(message.createdAt)}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[13px] leading-5 text-foreground">
                            {before}
                            {/* The matched words, so the reason a row is here is visible. */}
                            {match !== "" ? (
                              <mark className="rounded-[3px] bg-primary/25 px-0.5 text-foreground">
                                {match}
                              </mark>
                            ) : null}
                            {after}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
