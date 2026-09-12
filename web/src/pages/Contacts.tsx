import { Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { NewChatDialog } from "@/components/NewChatDialog";
import { useConversations } from "@/lib/use-conversations";

type Contact = {
  peerId: string;
  name: string;
  email: string | null;
  conversationId: string;
};

/** People you already have a conversation with. New people are added by email. */
const Contacts = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState<string>("");
  const [isNewChatOpen, setIsNewChatOpen] = useState<boolean>(false);

  const conversationsQuery = useConversations();

  const contacts: Contact[] = useMemo(() => {
    const seen = new Set<string>();
    const list: Contact[] = [];
    for (const item of conversationsQuery.data ?? []) {
      if (item.peerId === null || seen.has(item.peerId)) continue;
      seen.add(item.peerId);
      list.push({
        peerId: item.peerId,
        name: item.peerName,
        email: item.peerEmail,
        conversationId: item.conversationId,
      });
    }
    return list.sort((left, right) => left.name.localeCompare(right.name, "vi"));
  }, [conversationsQuery.data]);

  const entries: Contact[] = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) return contacts;
    return contacts.filter(
      (entry) =>
        entry.name.toLowerCase().includes(normalized) || (entry.email ?? "").toLowerCase().includes(normalized),
    );
  }, [contacts, query]);

  const openConversation = useCallback(
    (conversationId: string): void => {
      navigate(`/tin-nhan/${conversationId}`);
    },
    [navigate],
  );

  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10 md:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Liên hệ</h1>
            <p className="mt-1 text-[15px] text-muted-foreground">Những người bạn đã trò chuyện trên AVORA</p>
          </div>
          <button
            type="button"
            onClick={() => setIsNewChatOpen(true)}
            className="press rounded-md bg-primary px-5 py-2.5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92"
          >
            Trò chuyện mới
          </button>
        </header>

        <label className="relative mt-7 block">
          <span className="sr-only">Tìm liên hệ</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.6}
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm theo tên hoặc email"
            className="h-11 w-full rounded-md border border-border bg-card pl-11 pr-4 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
          />
        </label>

        <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
          {conversationsQuery.isPending ? (
            <ul aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <li key={row} className="flex items-center gap-3 border-b border-border px-5 py-3.5 last:border-b-0">
                  <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-secondary" />
                  <span className="min-w-0 flex-1 space-y-2">
                    <span className="block h-3.5 w-1/3 animate-pulse rounded bg-secondary" />
                    <span className="block h-3 w-1/2 animate-pulse rounded bg-secondary/70" />
                  </span>
                </li>
              ))}
            </ul>
          ) : conversationsQuery.isError ? (
            <div className="px-6 py-10 text-center">
              <p className="text-[14px] text-muted-foreground">{(conversationsQuery.error as Error).message}</p>
              <button
                type="button"
                onClick={() => void conversationsQuery.refetch()}
                className="press mt-3 rounded-md border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40"
              >
                Thử lại
              </button>
            </div>
          ) : entries.length === 0 ? (
            <p className="px-6 py-10 text-center text-[14px] text-muted-foreground">
              {contacts.length === 0
                ? "Chưa có liên hệ nào. Dùng Trò chuyện mới và nhập email để bắt đầu."
                : "Không tìm thấy liên hệ nào."}
            </p>
          ) : (
            <ul>
              {entries.map((entry) => (
                <li key={entry.peerId} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => openConversation(entry.conversationId)}
                    className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent/35"
                  >
                    <InitialsAvatar name={entry.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-foreground">{entry.name}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {entry.email ?? "Người dùng AVORA"}
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] font-medium text-primary">Nhắn tin</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <NewChatDialog open={isNewChatOpen} onOpenChange={setIsNewChatOpen} onCreated={openConversation} />
    </div>
  );
};

export default Contacts;
