import { useMutation } from "@tanstack/react-query";
import { BookmarkPlus, Loader2, NotebookText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import type { NoteCard } from "@/lib/chat";
import { noteCardMarkers } from "@/lib/note-card";
import { cn } from "@/lib/utils";

/**
 * AVORA-100 · S.3 (a) — a ghi chép forwarded into a conversation: `Ghi chép · <tiêu đề>`. Opening it
 * shows the same structure (levels and markers), read-only; the original stays the sender's.
 * The recipient may `Lưu vào Nhật ký` — their own copy (words and levels; the files stay in the chat).
 */
export function NoteCardBubble({ card, messageId, outgoing }: { card: NoteCard; messageId: string; outgoing: boolean }) {
  const [open, setOpen] = useState<boolean>(false);
  const markers = noteCardMarkers(card.blocks);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("save_note_card" as never, { p_message_id: messageId } as never);
      if (error) throw new Error("Chưa lưu được vào Nhật ký.");
    },
    onSuccess: () => toast.success("Đã lưu một bản vào Ghi chép của bạn."),
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-note-card=""
        className={cn(
          "press flex w-[260px] max-w-full flex-col gap-1 rounded-card border px-3.5 py-3 text-left",
          outgoing ? "border-personal/30 bg-personal-soft text-personal-soft-foreground" : "border-border bg-card text-foreground",
        )}
      >
        <span className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.08em] opacity-75">
          <NotebookText className="h-3.5 w-3.5" aria-hidden="true" /> Ghi chép
        </span>
        <span className="line-clamp-2 text-[16px] font-semibold leading-snug">{card.title}</span>
        {card.blocks.slice(0, 3).map((block, index) => (
          <span key={index} className="truncate text-[13.5px] opacity-80" style={{ paddingLeft: block.level * 10 }}>
            {markers[index]} {block.text}
          </span>
        ))}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] scroll-y p-0 md:mx-auto md:max-w-2xl md:rounded-t-card" data-note-card-view="">
          <SheetHeader className="px-4 pt-4 text-left">
            <SheetTitle className="text-[18px]">{card.title}</SheetTitle>
            <SheetDescription className="text-[13px]">Bản chụp ghi chép · chỉ xem, không sửa bản gốc</SheetDescription>
          </SheetHeader>
          <ol className="space-y-1.5 px-4 pb-4 pt-3">
            {card.blocks.map((block, index) => (
              <li key={index} className="flex gap-2 text-[16px] leading-relaxed text-foreground" style={{ paddingLeft: block.level * 12 }}>
                <span className="shrink-0 text-muted-foreground">{markers[index]}</span>
                <span className="min-w-0 whitespace-pre-wrap break-words">{block.text}</span>
              </li>
            ))}
          </ol>
          {!outgoing ? (
            <div className="border-t border-border px-4 py-3">
              <button
                type="button"
                disabled={save.isPending || save.isSuccess}
                onClick={() => save.mutate()}
                data-note-card-save=""
                className="press inline-flex min-h-11 items-center gap-2 rounded-control border border-border px-4 text-[15px] font-medium disabled:opacity-60"
              >
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <BookmarkPlus className="h-4 w-4" aria-hidden="true" />}
                {save.isSuccess ? "Đã lưu vào Nhật ký" : "Lưu vào Nhật ký"}
              </button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
