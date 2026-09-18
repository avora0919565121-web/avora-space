import { useMutation } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  conversationTitle,
  matchesConversationQuery,
  type ConversationSummary,
} from "@/lib/chat";
import { forwardMessages, forwardSummaryText, type ForwardResult } from "@/lib/forwarding";
import { cn } from "@/lib/utils";

export type ForwardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The messages being carried, oldest first. */
  messageIds: readonly string[];
  conversations: readonly ConversationSummary[];
  /** The thread being forwarded FROM — never a destination for its own messages. */
  currentConversationId: string | undefined;
  onForwarded: (result: ForwardResult, targetConversationId: string) => void;
};

/**
 * Choosing where messages go.
 *
 * A list of existing conversations rather than an email box: forwarding is about moving
 * something to a thread that already exists, and starting a brand-new conversation by
 * forwarding into it is a different intention that deserves its own door.
 *
 * The journal is a valid destination on purpose — "keep this where I can find it" is the
 * most common reason to forward anything at all.
 */
export function ForwardDialog({
  open,
  onOpenChange,
  messageIds,
  conversations,
  currentConversationId,
  onForwarded,
}: ForwardDialogProps) {
  const [query, setQuery] = useState<string>("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const destinations = useMemo(
    () =>
      conversations
        .filter((item) => item.conversationId !== currentConversationId)
        .filter((item) => matchesConversationQuery(item, query)),
    [conversations, currentConversationId, query],
  );

  const forwardMutation = useMutation({
    mutationFn: (target: ConversationSummary) =>
      forwardMessages(messageIds, target.conversationId).then((result) => ({ result, target })),
    onSuccess: ({ result, target }) => {
      toast.success(forwardSummaryText(result, conversationTitle(target)));
      onOpenChange(false);
      onForwarded(result, target.conversationId);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const choose = useCallback(
    (target: ConversationSummary): void => {
      if (forwardMutation.isPending) return;
      forwardMutation.mutate(target);
    },
    [forwardMutation],
  );

  const count = messageIds.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0">
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="text-[17px] font-semibold tracking-tight">
            Chuyển tiếp {count > 1 ? `${count} tin nhắn` : "tin nhắn"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
            Chọn nơi nhận. Tệp chỉ đi theo nếu người gửi cho phép chuyển tiếp.
          </DialogDescription>
        </div>

        <div className="px-5 py-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm cuộc trò chuyện…"
              aria-label="Tìm nơi nhận"
              className="h-11 w-full rounded-md border border-border bg-card pl-9 pr-3 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
          </div>
        </div>

        <div className="max-h-[320px] overflow-y-auto px-2 pb-3">
          {destinations.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13.5px] text-muted-foreground">
              {query.trim() === ""
                ? "Chưa có cuộc trò chuyện nào khác để chuyển tiếp."
                : "Không tìm thấy cuộc trò chuyện nào."}
            </p>
          ) : (
            <ul>
              {destinations.map((item) => {
                const title = conversationTitle(item);
                return (
                  <li key={item.conversationId}>
                    <button
                      type="button"
                      disabled={forwardMutation.isPending}
                      onClick={() => choose(item)}
                      className={cn(
                        "press flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent/45",
                        forwardMutation.isPending ? "opacity-60" : "",
                      )}
                    >
                      {item.kind === "group" ? (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                          <Users className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                        </span>
                      ) : (
                        <InitialsAvatar name={title} size="md" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-medium text-foreground">
                          {title}
                        </span>
                        {item.kind === "group" ? (
                          <span className="block text-[12px] text-muted-foreground">
                            {item.memberCount} thành viên
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
