import { useMutation } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LongDialogBody, LongDialogFooter, LongDialogHeader, longDialogContentClass } from "@/components/ui/long-dialog";
import type { AttachmentPermission } from "@/lib/attachments";
import { conversationTitle, matchesConversationQuery, type ConversationSummary } from "@/lib/chat";
import { forwardJournalItem, type JournalForwardItem } from "@/lib/journal-forward";
import { useConversations } from "@/lib/use-conversations";
import { cn } from "@/lib/utils";

const PERMISSIONS: readonly { id: AttachmentPermission; label: string }[] = [
  { id: "view", label: "Chỉ xem" },
  { id: "forward", label: "Cho chuyển tiếp" },
  { id: "export", label: "Cho tải ra" },
];

/**
 * AVORA-100 · S.3 (a) — `Chuyển tiếp…` from Nhật ký: a file of `File của tôi`, a file attached in a
 * ghi chép, or a whole ghi chép. The sender chooses what the recipient may do with the files
 * (`Chỉ xem · Cho chuyển tiếp · Cho tải ra`, default `Cho tải ra`); the recipient gets a pointer to
 * the original (ADR-012), never a copy, and never the right to edit a ghi chép.
 */
export type { JournalForwardItem };

export function JournalForwardDialog({ item, onOpenChange }: { item: JournalForwardItem | null; onOpenChange: (open: boolean) => void }) {
  // Mounted only while open: screens that merely offer the action need no chat data.
  if (item === null) return null;
  return <JournalForwardSheet item={item} onOpenChange={onOpenChange} />;
}

function JournalForwardSheet({ item, onOpenChange }: { item: JournalForwardItem | null; onOpenChange: (open: boolean) => void }) {
  const open = item !== null;
  const conversations = useConversations();
  const [query, setQuery] = useState<string>("");
  const [permission, setPermission] = useState<AttachmentPermission>("export");

  useEffect(() => {
    if (!open) {
      setQuery("");
      setPermission("export");
    }
  }, [open]);

  const destinations = useMemo(
    () =>
      (conversations.data ?? [])
        .filter((c) => c.kind !== "personal")
        .filter((c) => c.verification == null && c.isConnected !== false)
        .filter((c) => matchesConversationQuery(c, query)),
    [conversations.data, query],
  );

  const send = useMutation({
    mutationFn: async (target: ConversationSummary) => {
      if (item === null) return;
      await forwardJournalItem(item, target.conversationId, permission);
      return target;
    },
    onSuccess: (target) => {
      if (target !== undefined) toast.success(`Đã chuyển tiếp tới ${conversationTitle(target)}.`);
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(longDialogContentClass, "max-w-md")} data-journal-forward={item?.kind ?? ""}>
        <LongDialogHeader>
          <DialogTitle className="text-[17px] font-semibold tracking-tight">{item?.kind === "note" ? "Chuyển tiếp ghi chép" : "Chuyển tiếp tệp"}</DialogTitle>
          <DialogDescription className="mt-1 truncate text-[13px] text-muted-foreground">{item?.label ?? ""}</DialogDescription>
          <div role="radiogroup" aria-label="Người nhận được làm gì với tệp" className="mt-3 grid grid-cols-3 gap-1 rounded-control bg-secondary/60 p-1">
            {PERMISSIONS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={permission === p.id}
                data-forward-permission={p.id}
                onClick={() => setPermission(p.id)}
                className={cn("press min-h-10 rounded-[calc(var(--radius-control)-4px)] px-1 text-[13.5px] font-medium", permission === p.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            {item?.kind === "note"
              ? "Người nhận thấy một bản chụp ghi chép (đúng các cấp I. / 1. / A.) và các tệp đính kèm. Họ không sửa được bản gốc."
              : "Người nhận mở tệp gốc của bạn, không có bản sao nào được tạo."}
          </p>
        </LongDialogHeader>
        <div className="shrink-0 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm cuộc trò chuyện…"
              aria-label="Tìm nơi nhận"
              className="h-11 w-full rounded-md border border-border bg-card pl-9 pr-3 text-[16px] text-foreground outline-none focus:border-personal/60 md:text-[14px]"
            />
          </div>
        </div>
        <LongDialogBody className="px-2 pb-3 pt-0">
          {destinations.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13.5px] text-muted-foreground">Không tìm thấy cuộc trò chuyện nào.</p>
          ) : (
            <ul>
              {destinations.map((c) => {
                const title = conversationTitle(c);
                return (
                  <li key={c.conversationId}>
                    <button
                      type="button"
                      disabled={send.isPending}
                      onClick={() => send.mutate(c)}
                      data-forward-target={c.conversationId}
                      className="press flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent/45 disabled:opacity-60"
                    >
                      {c.kind === "group" ? (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                          <Users className="h-4 w-4" aria-hidden="true" />
                        </span>
                      ) : (
                        <InitialsAvatar name={title} size="md" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-foreground">{title}</span>
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
