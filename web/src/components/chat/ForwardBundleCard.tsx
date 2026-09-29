import { Forward } from "lucide-react";
import { useState } from "react";

import { bundleSpan, groupBySpeaker, type ForwardBundle } from "@/lib/chat-transcript";
import { cn } from "@/lib/utils";

/** Beyond this many lines the card folds, with "Xem toàn bộ" opening it in place. */
const FOLD_LINES = 12;

/**
 * A forwarded conversation (Đợt gộp 2 · B1): who said what, words only.
 *
 * Consecutive lines from one speaker read as one block under their name. Names are plain text —
 * no avatar, PIN or link — because the reader may not be connected to anyone in it.
 */
export function ForwardBundleCard({ bundle, outgoing }: { bundle: ForwardBundle; outgoing: boolean }) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const blocks = groupBySpeaker(bundle.items);
  const totalLines = blocks.reduce((sum, block) => sum + 1 + block.lines.length, 0);
  const isLong = totalLines > FOLD_LINES;
  const span = bundleSpan(bundle.firstAt, bundle.lastAt);

  let budget = isOpen || !isLong ? Number.POSITIVE_INFINITY : FOLD_LINES;
  const shown = [];
  for (const block of blocks) {
    if (budget <= 1) break;
    const lines = block.lines.slice(0, Math.max(0, budget - 1));
    shown.push({ name: block.name, lines });
    budget -= 1 + lines.length;
  }

  return (
    <div
      className={cn(
        "min-w-[220px] rounded-bubble border px-4 py-2.5",
        outgoing ? "rounded-br-[4px] border-primary/30 bg-primary/[0.07]" : "rounded-bl-[4px] border-border bg-card",
      )}
    >
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <Forward className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        <span className="truncate">
          Đoạn hội thoại · {bundle.count} tin{span !== "" ? ` · ${span}` : ""}
        </span>
      </p>
      <div className="mt-2 space-y-2">
        {shown.map((block, index) => (
          <div key={index}>
            <p className="text-[13px] font-medium text-foreground">{block.name}</p>
            {block.lines.map((line, lineIndex) => (
              <p
                key={lineIndex}
                className={cn(
                  "whitespace-pre-wrap break-words text-[14px] leading-6",
                  /^\[(Ảnh|\d+ ảnh|\d+ tệp)\]$/.test(line) ? "text-muted-foreground" : "text-foreground/90",
                )}
              >
                {line}
              </p>
            ))}
          </div>
        ))}
      </div>
      {isLong ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setIsOpen((current) => !current);
          }}
          className="press mt-2 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          {isOpen ? "Thu gọn" : "Xem toàn bộ"}
        </button>
      ) : null}
    </div>
  );
}
