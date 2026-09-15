import { Plus, SmilePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { emojiBounceClass, EMOJI_BOUNCE_MS } from "@/lib/emoji-bounce";
import {
  describeReactors,
  MORE_REACTIONS,
  QUICK_REACTIONS,
  type ReactionGroup,
} from "@/lib/reactions";
import { cn } from "@/lib/utils";

/**
 * The reactions already on a message, and the way to add one.
 *
 * Each chip is a toggle rather than a counter: pressing one you are already part of takes
 * your own reaction back. That is why the chip shows whether you are in it — a number alone
 * would leave "did I already react?" unanswerable without a tooltip.
 */
export function MessageReactions({
  groups,
  nameOf,
  viewerId,
  onToggle,
  outgoing,
}: {
  groups: readonly ReactionGroup[];
  nameOf: (userId: string) => string;
  viewerId: string | undefined;
  onToggle: (emoji: string) => void;
  outgoing: boolean;
}) {
  if (groups.length === 0) return null;

  return (
    <div
      className={cn(
        "mt-1 flex flex-wrap items-center gap-1",
        outgoing ? "justify-end" : "justify-start",
      )}
    >
      {groups.map((group) => (
        <button
          key={group.emoji}
          type="button"
          onClick={() => onToggle(group.emoji)}
          aria-pressed={group.mine}
          title={describeReactors(group, nameOf, viewerId)}
          className={cn(
            "press flex h-7 items-center gap-1 rounded-full border px-2 text-[12px] transition-colors",
            group.mine
              ? "border-primary/50 bg-primary/10 text-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-accent/40",
          )}
        >
          <span aria-hidden="true">{group.emoji}</span>
          <span className="tabular">{group.count}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The picker: eight quick feelings, plus everything else behind "+".
 *
 * The quick row is deliberately not all positive — sadness, sympathy and surprise belong in a
 * real conversation as much as approval does. A bar that can only agree turns every reaction
 * into applause, and then people stop using it to say anything true.
 */
export function ReactionPicker({
  onPick,
  label,
  className,
}: {
  onPick: (emoji: string) => void;
  label: string;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [showAll, setShowAll] = useState<boolean>(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const closeRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (closeRef.current !== null) window.clearTimeout(closeRef.current);
    },
    [],
  );

  /**
   * The reaction is sent now; the sheet waits out the bounce.
   *
   * Saving first and animating after means a slow network never costs the feedback, and the
   * person still sees which of eight small faces took their press before it all closes.
   */
  const pick = (emoji: string): void => {
    onPick(emoji);
    setPressed(emoji);
    if (closeRef.current !== null) window.clearTimeout(closeRef.current);
    closeRef.current = window.setTimeout(() => {
      setIsOpen(false);
      setShowAll(false);
      setPressed(null);
    }, EMOJI_BOUNCE_MS);
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(next) => {
        setIsOpen(next);
        if (!next) {
          setShowAll(false);
          setPressed(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Thả cảm xúc: ${label}`}
          title="Thả cảm xúc"
          className={cn(
            "press flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 transition-all hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 group-hover:opacity-100 motion-reduce:transition-none",
            className,
          )}
        >
          <SmilePlus className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-auto max-w-[288px] p-2">
        <div className="flex flex-wrap gap-1">
          {QUICK_REACTIONS.map((entry) => (
            <button
              key={entry.emoji}
              type="button"
              onClick={() => pick(entry.emoji)}
              title={entry.label}
              aria-label={entry.label}
              className="press flex h-10 w-10 items-center justify-center rounded-[8px] text-[20px] transition-colors hover:bg-accent/50"
            >
              <span aria-hidden="true" className={emojiBounceClass(pressed, entry.emoji)}>
                {entry.emoji}
              </span>
            </button>
          ))}
          {!showAll ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              aria-label="Thêm cảm xúc khác"
              title="Thêm cảm xúc khác"
              className="press flex h-10 w-10 items-center justify-center rounded-[8px] border border-border text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {showAll ? (
          <div className="mt-1.5 max-h-[168px] overflow-y-auto border-t border-border pt-1.5">
            <div className="flex flex-wrap gap-1">
              {MORE_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => pick(emoji)}
                  aria-label={`Thả ${emoji}`}
                  className="press flex h-10 w-10 items-center justify-center rounded-[8px] text-[20px] transition-colors hover:bg-accent/50"
                >
                  <span aria-hidden="true" className={emojiBounceClass(pressed, emoji)}>
                    {emoji}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
