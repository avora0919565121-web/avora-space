import { ChevronLeft, X } from "lucide-react";
import { useRef, type PointerEvent, type ReactNode } from "react";

/**
 * Header of a panel opened from `⋯` (AVORA-52 · C): `‹ {tên cuộc}` steps back to `⋯` (still open
 * underneath, at the same scroll), `✕` closes everything and returns to the conversation.
 */
export function StackedSheetHeader({
  backLabel,
  onBack,
  onCloseAll,
  children,
}: {
  backLabel: string;
  onBack: () => void;
  onCloseAll: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-border px-2 py-2">
      <button
        type="button"
        onClick={onBack}
        className="press flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-md px-2 text-left text-[14px] font-medium text-primary hover:bg-accent/40"
      >
        <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden="true" />
        <span className="truncate">{backLabel}</span>
      </button>
      {children}
      <button
        type="button"
        onClick={onCloseAll}
        aria-label="Đóng hết, về cuộc trò chuyện"
        className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      >
        <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Phone: a swipe from the left edge is `‹` (AVORA-52 · C). Spread onto the panel's body. */
export function useEdgeSwipeBack(onBack: (() => void) | undefined) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>): void => {
      if (onBack === undefined || event.pointerType !== "touch") return;
      const left = event.currentTarget.getBoundingClientRect().left;
      startRef.current = event.clientX - left <= 24 ? { x: event.clientX, y: event.clientY } : null;
    },
    onPointerUp: (event: PointerEvent<HTMLElement>): void => {
      const start = startRef.current;
      startRef.current = null;
      if (start === null || onBack === undefined) return;
      const dx = event.clientX - start.x;
      if (dx > 72 && Math.abs(event.clientY - start.y) < dx) onBack();
    },
    onPointerCancel: (): void => {
      startRef.current = null;
    },
  };
}
