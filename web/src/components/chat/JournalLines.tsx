import { CheckSquare, Copy, FileText, Forward, Image as ImageIcon, Link2, ListChecks, ListPlus, Mic, Pencil, Pin, PinOff, Reply, Trash2, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { DayLineList, type DayLine } from "@/components/chat/DayLineList";
import { MessageActionsMenu, type MessageAction } from "@/components/chat/MessageActionsMenu";
import { MessageAttachments } from "@/components/chat/MessageAttachments";
import type { MessageAttachment } from "@/lib/attachments";
import { messageBodyText, type ChatMessage } from "@/lib/chat-cache";
import { isLongEntry, journalEntryKind, journalFirstLine, type JournalEntryKind } from "@/lib/journal-lines";
import { highlightParts } from "@/lib/search";
import { cn } from "@/lib/utils";

const KIND_ICON: Readonly<Record<JournalEntryKind, LucideIcon | null>> = {
  text: null,
  forwarded: Reply,
  file: FileText,
  image: ImageIcon,
  link: Link2,
  voice: Mic,
  task: ListChecks,
};

export const JOURNAL_FOLD_KEY = "avora.journal.folded-days";

/**
 * AVORA-70 · A: Nhật ký của tôi as a notebook — one line per entry, grouped by day, oldest at the
 * top and the newest right above the composer. A tap opens the entry in place with the message's
 * own actions; holding opens the same message menu as everywhere else (71 · B).
 */
export function JournalLines({
  messages,
  attachmentsOf,
  urlOf,
  taskMessageIds,
  viewerId,
  flashId,
  searchHit = null,
  isPinned,
  isSelecting,
  selected,
  onSelect,
  onAction,
  editingId,
  editDraft,
  onEditDraft,
  onSaveEdit,
  onCancelEdit,
  isSavingEdit,
}: {
  messages: readonly ChatMessage[];
  attachmentsOf: (messageId: string) => MessageAttachment[];
  urlOf: (storagePath: string) => string | null;
  taskMessageIds: ReadonlySet<string>;
  viewerId: string | undefined;
  flashId: string | null;
  /** The search that landed on a line: its matching words are lit when the line opens. */
  searchHit?: { id: string; query: string } | null;
  isPinned: (messageId: string) => boolean;
  isSelecting: boolean;
  selected: ReadonlySet<string>;
  onSelect: (ids: readonly string[], on: boolean) => void;
  onAction: (message: ChatMessage, action: MessageAction) => void;
  editingId: string | null;
  editDraft: string;
  onEditDraft: (text: string) => void;
  onSaveEdit: (message: ChatMessage) => void;
  onCancelEdit: () => void;
  isSavingEdit: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const byId = new Map(messages.map((message) => [message.id, message] as const));
  // Oldest at the top, newest right above the composer — whatever order the source handed over.
  const entries = messages
    .filter((message) => message.systemKind == null)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const lines: DayLine[] = entries.map((message) => {
    const files = attachmentsOf(message.id);
    const kind = journalEntryKind(message, files, taskMessageIds.has(message.id));
    const image = files.find((item) => item.kind === "image");
    return {
      id: message.id,
      at: message.createdAt,
      icon: KIND_ICON[kind],
      title: kind === "forwarded" ? `Tin chuyển tiếp: ${journalFirstLine(message.content, files)}` : journalFirstLine(messageBodyText(message), files),
      thumbUrl: image === undefined ? null : urlOf(image.storagePath),
      entryId: message.pending === true ? null : message.id,
      isLong: isLongEntry(message.content, files),
    };
  });

  const detail = (line: DayLine, full: boolean) => {
    const message = byId.get(line.id);
    if (message === undefined) return null;
    const files = attachmentsOf(message.id);
    const pinned = isPinned(message.id);
    const actions: { action: MessageAction; label: string; icon: LucideIcon; danger?: boolean }[] = [
      { action: "task", label: "Tạo nhiệm vụ", icon: ListPlus },
      { action: "forward", label: "Chuyển tiếp", icon: Forward },
      pinned ? { action: "unpin", label: "Bỏ ghim", icon: PinOff } : { action: "pin", label: "Ghim", icon: Pin },
      ...(message.content.trim() !== "" ? [{ action: "copy" as const, label: "Sao chép", icon: Copy }] : []),
      ...(message.senderId === viewerId && message.content.trim() !== "" ? [{ action: "edit" as const, label: "Sửa", icon: Pencil }] : []),
      { action: "select", label: "Chọn nhiều", icon: CheckSquare },
      { action: "delete", label: "Xoá", icon: Trash2, danger: true },
    ];
    return (
      <div className="space-y-2.5">
        {files.length > 0 ? (
          <div className="max-w-full overflow-hidden">
            <MessageAttachments attachments={files} urlOf={urlOf} outgoing={false} />
          </div>
        ) : null}
        {editingId === message.id ? (
          <div className="space-y-1.5">
            <textarea
              lang="vi"
              spellCheck
              value={editDraft}
              onChange={(event) => onEditDraft(event.target.value)}
              rows={3}
              maxLength={4000}
              aria-label="Sửa mục Nhật ký"
              className="w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-[16px] leading-relaxed outline-none focus:border-primary/60 md:text-[15px]"
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={isSavingEdit || editDraft.trim() === ""}
                onClick={() => onSaveEdit(message)}
                className="press h-10 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
              >
                {isSavingEdit ? "Đang lưu…" : "Lưu"}
              </button>
              <button type="button" onClick={onCancelEdit} className="press h-10 rounded-md px-3 text-[13px] text-muted-foreground">
                Huỷ
              </button>
            </div>
          </div>
        ) : message.content.trim() !== "" ? (
          <p className={cn("whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground", !full && "line-clamp-[10]")}>
            {searchHit !== null && searchHit.id === message.id
              ? highlightParts(message.content, searchHit.query).map((part, index) =>
                  part.match ? (
                    <mark key={index} data-search-mark="" className="rounded-[3px] bg-[hsl(42_95%_72%)] px-0.5 text-foreground dark:bg-[hsl(42_70%_38%)]">
                      {part.text}
                    </mark>
                  ) : (
                    <span key={index}>{part.text}</span>
                  ),
                )
              : message.content}
          </p>
        ) : null}
        {!full ? (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Thao tác với mục này">
            {actions.map((entry) => (
              <button
                key={entry.action}
                type="button"
                onClick={() => onAction(message, entry.action)}
                className={cn(
                  "press inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[13px] font-medium",
                  entry.danger ? "text-destructive" : "text-foreground",
                )}
              >
                <entry.icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" /> {entry.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <DayLineList
      lines={lines}
      foldKey={JOURNAL_FOLD_KEY}
      label="Nhật ký của tôi"
      openId={openId}
      onOpenChange={setOpenId}
      renderDetail={(line) => detail(line, false)}
      renderFull={(line) => detail(line, true)}
      flashId={flashId}
      idPrefix="message-"
      isSelecting={isSelecting}
      selected={selected}
      onSelect={onSelect}
      onSwipeDelete={(line) => {
        const message = byId.get(line.id);
        if (message !== undefined) onAction(message, "delete");
      }}
      menuFor={(line, open, onOpenChange) => {
        const message = byId.get(line.id);
        if (message === undefined) return null;
        return (
          <MessageActionsMenu
            message={message}
            viewerId={viewerId}
            canRaiseTask={message.pending !== true}
            canPin={message.pending !== true}
            isPinned={isPinned(message.id)}
            canForward={message.pending !== true}
            canCopy
            canDelete
            onAction={(action) => onAction(message, action)}
            open={open}
            onOpenChange={onOpenChange}
            className="hidden md:inline-flex md:opacity-0"
          />
        );
      }}
    />
  );
}
