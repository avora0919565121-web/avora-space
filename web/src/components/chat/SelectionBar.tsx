import { Forward, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type SelectionBarProps = {
  count: number;
  /** True only in a journal, where a note is nobody else's record. */
  canDelete: boolean;
  onForward: () => void;
  onDelete: () => void;
  onCancel: () => void;
  isWorking: boolean;
};

/**
 * The bar that appears once messages are being picked.
 *
 * Floats over the thread rather than replacing the composer: the conversation stays readable
 * while choosing, which is the whole point of picking several messages out of it.
 *
 * "Xoá" is absent outside a journal, not disabled. Elsewhere a message is part of a record
 * two people share, and the honest instrument there is "Thu hồi" — which leaves a visible
 * gap both can see, rather than quietly removing what was said.
 */
export function SelectionBar({
  count,
  canDelete,
  onForward,
  onDelete,
  onCancel,
  isWorking,
}: SelectionBarProps) {
  const nothingPicked = count === 0;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-2 py-2 shadow-lg backdrop-blur-sm">
        <span className="px-2 text-[13.5px] font-medium tabular-nums text-foreground" aria-live="polite">
          {nothingPicked ? "Chọn tin nhắn" : `Đã chọn ${count}`}
        </span>

        <button
          type="button"
          onClick={onForward}
          disabled={nothingPicked || isWorking}
          className={cn(
            "press flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-medium transition-colors",
            nothingPicked || isWorking
              ? "cursor-not-allowed text-muted-foreground/60"
              : "bg-primary text-primary-foreground hover:bg-primary/92",
          )}
        >
          <Forward className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          Chuyển tiếp{nothingPicked ? "" : ` (${count})`}
        </button>

        {canDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={nothingPicked || isWorking}
            className={cn(
              "press flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-medium transition-colors",
              nothingPicked || isWorking
                ? "cursor-not-allowed text-muted-foreground/60"
                : "text-destructive hover:bg-destructive/10",
            )}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Xoá{nothingPicked ? "" : ` (${count})`}
          </button>
        ) : null}

        <button
          type="button"
          onClick={onCancel}
          aria-label="Thoát chế độ chọn"
          className="press flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
