import { useLayoutEffect, useRef, useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { reactionPill, type ReactionGroup } from "@/lib/reactions";
import { cn } from "@/lib/utils";

/**
 * AVORA-108 · 4 — reactions float over the bubble's lower inner corner instead of taking a row of
 * their own (an incoming line: bottom-right; my own: bottom-left). The pill's ring is the thread's
 * own background, so it reads as cut out of the bubble. A tap opens who reacted — touch has no
 * hover title — with `Bỏ cảm xúc của tôi` on my own line. Giving a reaction stays where it was
 * (hold menu, double tap ❤️, picker).
 */
export function ReactionPill({
  groups,
  outgoing,
  nameOf,
  viewerId,
  onRemoveMine,
}: {
  groups: readonly ReactionGroup[];
  outgoing: boolean;
  nameOf: (userId: string) => string;
  viewerId: string | undefined;
  onRemoveMine: (emoji: string) => void;
}) {
  const [open, setOpen] = useState<boolean>(false);
  const [filter, setFilter] = useState<string | null>(null);
  // A pill wider than a short bubble ("ok") anchors to the other corner, so it sticks out toward
  // the middle of the thread and never past the screen edge.
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const signature = groups.map((g) => `${g.emoji}${g.count}`).join("|");
  useLayoutEffect(() => {
    const el = pillRef.current;
    const parent = el?.parentElement;
    if (el == null || parent == null) return;
    setIsFlipped(el.offsetWidth + 8 > parent.offsetWidth);
  }, [signature]);
  if (groups.length === 0) return null;
  const pill = reactionPill(groups);
  const rows = groups
    .filter((group) => filter === null || group.emoji === filter)
    .flatMap((group) => group.userIds.map((userId) => ({ userId, emoji: group.emoji })));

  return (
    <>
      <button
        ref={pillRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        data-reaction-pill=""
        aria-label={`Cảm xúc: ${groups.map((g) => `${g.emoji} ${g.count}`).join(", ")}. Xem ai đã thả`}
        className={cn(
          // 24 px tall, 12 px over the bubble's lower edge; ::after widens the hit area to 44 px.
          "avora-reaction-pill absolute -bottom-3 z-[1] flex h-6 items-center gap-0.5 rounded-full border-2 border-[hsl(var(--background))] bg-card px-1.5 text-[12px] leading-none text-foreground shadow-[0_1px_3px_hsl(30_20%_20%/0.18)] after:absolute after:-inset-x-2.5 after:-inset-y-2.5 after:content-['']",
          outgoing !== isFlipped ? "left-2" : "right-2",
          pill.mine && "ring-1 ring-[hsl(var(--personal))]",
        )}
      >
        {pill.emoji.map((emoji) => (
          <span key={emoji} aria-hidden="true">
            {emoji}
          </span>
        ))}
        {pill.more > 0 ? <span className="ml-0.5 text-muted-foreground">+{pill.more}</span> : null}
        {pill.showTotal ? <span className="tabular ml-0.5 text-muted-foreground">{pill.total}</span> : null}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[70dvh] scroll-y p-0 md:mx-auto md:max-w-md md:rounded-t-card" data-reaction-list="">
          <SheetHeader className="px-4 pt-4 text-left">
            <SheetTitle className="text-[17px]">Cảm xúc</SheetTitle>
            <SheetDescription className="sr-only">Ai đã thả cảm xúc cho tin này</SheetDescription>
          </SheetHeader>
          <div role="tablist" aria-label="Lọc cảm xúc" className="mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" data-h-scroll="">
            <button type="button" role="tab" aria-selected={filter === null} onClick={() => setFilter(null)} className={cn("press h-9 shrink-0 rounded-full border px-3 text-[13.5px]", filter === null ? "border-foreground bg-foreground text-background" : "border-border bg-card")}>
              Tất cả
            </button>
            {groups.map((group) => (
              <button key={group.emoji} type="button" role="tab" aria-selected={filter === group.emoji} onClick={() => setFilter(group.emoji)} className={cn("press h-9 shrink-0 rounded-full border px-3 text-[13.5px]", filter === group.emoji ? "border-foreground bg-foreground text-background" : "border-border bg-card")}>
                {group.emoji} {group.count}
              </button>
            ))}
          </div>
          <ul className="pb-4 pt-2">
            {rows.map((row) => (
              <li key={`${row.userId}-${row.emoji}`} className="flex min-h-11 items-center justify-between gap-3 px-4 text-[15px]">
                <span className="min-w-0 truncate text-foreground">{row.userId === viewerId ? "Bạn" : nameOf(row.userId)}</span>
                <span className="flex items-center gap-3">
                  <span aria-hidden="true">{row.emoji}</span>
                  {row.userId === viewerId ? (
                    <button type="button" onClick={() => { onRemoveMine(row.emoji); setOpen(false); }} className="press min-h-11 text-[13px] text-muted-foreground hover:text-foreground" data-reaction-remove="">
                      Bỏ cảm xúc của tôi
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
