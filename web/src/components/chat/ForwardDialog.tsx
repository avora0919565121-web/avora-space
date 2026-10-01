import { useMutation } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LongDialogBody, LongDialogFooter, LongDialogHeader, longDialogContentClass } from "@/components/ui/long-dialog";
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
  /** Two or more messages: the first lines of the conversation as "Tên: nội dung" (B1). */
  previewLines?: readonly string[];
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
  previewLines = [],
}: ForwardDialogProps) {
  const [query, setQuery] = useState<string>("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const destinations = useMemo(
    () =>
      conversations
        .filter((item) => item.conversationId !== currentConversationId)
        // A "Chờ kết bạn" frame is text only, and a pair no longer bạn cannot receive more.
        .filter((item) => item.verification == null && item.isConnected !== false)
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
      <DialogContent className={cn(longDialogContentClass, "max-w-md")}>
        <LongDialogHeader>
          <DialogTitle className="text-[17px] font-semibold tracking-tight">
            {count > 1 ? `Chuyển tiếp đoạn hội thoại · ${count} tin` : "Chuyển tiếp tin nhắn"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
            {count > 1
              ? "Người nhận thấy tên người nói và nội dung chữ. Ảnh và tệp không đi kèm."
              : "Chọn nơi nhận. Tệp chỉ đi theo nếu người gửi cho phép chuyển tiếp."}
          </DialogDescription>
          {count > 1 && previewLines.length > 0 ? (
            <div className="mt-3 space-y-0.5 rounded-[10px] border border-border bg-secondary/40 px-3 py-2 text-[12.5px] leading-5 text-foreground/85">
              {previewLines.slice(0, 4).map((line, index) => (
                <p key={index} className="truncate">
                  {line}
                </p>
              ))}
            </div>
          ) : null}
        </LongDialogHeader>

        <div className="shrink-0 px-5 py-3">
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
              className="h-11 w-full rounded-md border border-border bg-card pl-9 pr-3 text-[16px] md:text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
          </div>
        </div>

        <LongDialogBody className="px-2 pb-3 pt-0">
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
        </LongDialogBody>
        <LongDialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} className="press h-10 rounded-md border border-border px-4 text-[14px]">
            Huỷ
          </button>
        </LongDialogFooter>
      </DialogContent>
    </Dialog>
  );
}
