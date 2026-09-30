import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Paperclip, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { attachmentKeys } from "@/lib/attachments";
import { chatKeys, fetchTrashedJournal, formatClock, formatDayLabel, type TrashedJournalEntry } from "@/lib/chat";
import { daysLeftInTrash } from "@/lib/chat-cache";
import { restoreJournalMessages } from "@/lib/forwarding";
import { logError } from "@/lib/log";

export const journalTrashKey = (conversationId: string) => ["journal-trash", conversationId] as const;

/** The number of entries waiting in Nhật ký's bin, for the ⋯ row's count. */
export function useJournalTrashCount(conversationId: string | undefined, enabled: boolean): number | null {
  const query = useQuery<TrashedJournalEntry[], Error>({
    queryKey: journalTrashKey(conversationId ?? ""),
    queryFn: () => fetchTrashedJournal(conversationId ?? ""),
    enabled: enabled && conversationId !== undefined,
    staleTime: 30_000,
  });
  return query.data?.length ?? null;
}

function preview(entry: TrashedJournalEntry): string {
  const text = entry.content.trim();
  if (text !== "") return text;
  return entry.attachmentCount > 0 ? `${entry.attachmentCount} tệp` : "Mục trống";
}

/**
 * Thùng rác của Nhật ký (AVORA-44 · việc 8): what was deleted, how many days it has left before
 * it is emptied for good, and Khôi phục. Restoring puts the entry back where it was, with its files.
 */
export function JournalTrashSheet({
  conversationId,
  open,
  onOpenChange,
}: {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery<TrashedJournalEntry[], Error>({
    queryKey: journalTrashKey(conversationId),
    queryFn: () => fetchTrashedJournal(conversationId),
    enabled: open,
  });
  const restore = useMutation({
    mutationFn: (ids: string[]) => restoreJournalMessages(ids),
    onSuccess: (count: number) => {
      toast.success(count === 1 ? "Đã khôi phục 1 mục về Nhật ký." : `Đã khôi phục ${count} mục về Nhật ký.`);
      void queryClient.invalidateQueries({ queryKey: journalTrashKey(conversationId) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
      void queryClient.invalidateQueries({ queryKey: attachmentKeys.thread(conversationId) });
    },
    onError: (error: Error) => {
      logError("journal-trash", error);
      toast.error("Chưa khôi phục được. Thử lại nhé.");
    },
  });
  const entries = query.data ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 border-border bg-card p-0 sm:max-w-md">
        <div className="border-b border-border px-6 pb-4 pt-7">
          <SheetTitle className="text-[20px] font-semibold tracking-tight text-foreground">Thùng rác Nhật ký</SheetTitle>
          <SheetDescription className="mt-1 text-[13px] text-muted-foreground">
            Mục đã xoá được giữ 30 ngày, cùng tệp, rồi mới xoá hẳn.
          </SheetDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
          {query.isPending && open ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : query.isError ? (
            <div className="px-3 py-10 text-center">
              <p className="text-[14px] text-muted-foreground">Không tải được Thùng rác.</p>
              <button type="button" onClick={() => void query.refetch()} className="press mt-3 rounded-md border border-border px-4 py-2 text-[13px]">
                Thử lại
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground">
                <Trash2 className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
              </span>
              <p className="mt-4 text-[15px] font-semibold text-foreground">Thùng rác trống</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Mục xoá khỏi Nhật ký sẽ nằm đây 30 ngày.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {entries.map((entry) => {
                const left = daysLeftInTrash(entry.trashedAt);
                return (
                  <li key={entry.id} className="rounded-[12px] border border-border bg-background px-3 py-2.5">
                    <p className="line-clamp-3 whitespace-pre-wrap break-words text-[14px] leading-5 text-foreground">{preview(entry)}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                      {entry.attachmentCount > 0 && entry.content.trim() !== "" ? (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="h-3 w-3" aria-hidden="true" /> {entry.attachmentCount}
                        </span>
                      ) : null}
                      <span className="tabular">Ghi {formatDayLabel(entry.createdAt)} · {formatClock(entry.createdAt)}</span>
                      <span className={left <= 3 ? "font-medium text-destructive" : undefined}>
                        {left === 0 ? "Xoá hẳn trong hôm nay" : `Còn ${left} ngày`}
                      </span>
                      <button
                        type="button"
                        disabled={restore.isPending}
                        onClick={() => restore.mutate([entry.id])}
                        className="press ml-auto inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-md border border-border px-2.5 text-[12.5px] font-medium text-foreground hover:bg-accent/40 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Khôi phục
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {entries.length > 1 ? (
          <div className="border-t border-border px-6 py-3">
            <button
              type="button"
              disabled={restore.isPending}
              onClick={() => restore.mutate(entries.map((entry) => entry.id))}
              className="press h-11 w-full whitespace-nowrap rounded-[10px] border border-border text-[14px] font-medium hover:bg-accent/40 disabled:opacity-50"
            >
              Khôi phục tất cả ({entries.length})
            </button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
