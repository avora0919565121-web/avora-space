import { ListPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** How long a finger must rest on a bubble before it counts as "I mean this one". */
export const LONG_PRESS_MS = 500;

/** Movement beyond this is a scroll, not a press, so the gesture is abandoned. */
export const LONG_PRESS_SLOP_PX = 10;

type MessageTaskButtonProps = {
  /** Raises the dialog with this bubble as the quoted message. */
  onCreateTask: () => void;
  /** Named in the accessible label so a screen reader knows which message is meant. */
  messageLabel: string;
  className?: string;
};

/**
 * "Tạo task từ tin nhắn này", attached to one bubble.
 *
 * The button beside the composer answers "what we were just saying"; this answers "that thing,
 * three messages up". Both exist because both questions get asked. On a pointer device the
 * action appears on hover or keyboard focus, staying out of the way of reading; on a touch
 * screen there is no hover, so resting a finger on the bubble opens the same thing.
 */
export function MessageTaskButton({ onCreateTask, messageLabel, className }: MessageTaskButtonProps) {
  return (
    <button
      type="button"
      onClick={onCreateTask}
      aria-label={`Tạo task từ tin nhắn này: ${messageLabel}`}
      title="Tạo task từ tin nhắn này"
      className={cn(
        "press flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 transition-all hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 motion-reduce:transition-none",
        className,
      )}
    >
      <ListPlus className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

/**
 * The touch half of the same action: a press held on the bubble itself.
 *
 * Returns handlers to spread onto the bubble. The press is abandoned as soon as the finger
 * travels — otherwise every scroll through a thread would fire it — and a fired long press
 * swallows the click that follows, so the gesture never counts twice.
 */
export function useLongPress(onLongPress: () => void): {
  handlers: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onContextMenu: (event: React.MouseEvent) => void;
  };
  isPressing: boolean;
} {
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef<boolean>(false);
  const [isPressing, setIsPressing] = useState<boolean>(false);

  const clear = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
    setIsPressing(false);
  }, []);

  useEffect(() => clear, [clear]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent): void => {
      // Mouse and pen already have hover and a visible button; this is for fingers.
      if (event.pointerType !== "touch") return;
      firedRef.current = false;
      originRef.current = { x: event.clientX, y: event.clientY };
      setIsPressing(true);
      timerRef.current = window.setTimeout(() => {
        firedRef.current = true;
        clear();
        onLongPress();
      }, LONG_PRESS_MS);
    },
    [clear, onLongPress],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent): void => {
      const origin = originRef.current;
      if (origin === null) return;
      const travelled =
        Math.abs(event.clientX - origin.x) > LONG_PRESS_SLOP_PX ||
        Math.abs(event.clientY - origin.y) > LONG_PRESS_SLOP_PX;
      if (travelled) clear();
    },
    [clear],
  );

  const onContextMenu = useCallback((event: React.MouseEvent): void => {
    // A long press on mobile also raises the native menu; ours has already answered.
    if (firedRef.current) event.preventDefault();
  }, []);

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp: clear, onPointerCancel: clear, onContextMenu },
    isPressing,
  };
}

/**
 * One message bubble, with both ways of turning it into a task.
 *
 * The hook lives here rather than in the thread's render loop, where it would be a hook inside
 * a map. The bubble dims slightly while a finger is held on it, so the gesture is visibly doing
 * something before it fires.
 */
export function MessageTaskAffordance({
  onCreateTask,
  messageLabel,
  outgoing,
  children,
}: {
  onCreateTask: () => void;
  messageLabel: string;
  outgoing: boolean;
  children: React.ReactNode;
}) {
  const { handlers, isPressing } = useLongPress(onCreateTask);

  return (
    <div className={cn("flex w-full items-center gap-1.5", outgoing ? "flex-row-reverse" : "flex-row")}>
      <div
        {...handlers}
        className={cn(
          "max-w-[80%] transition-opacity",
          isPressing ? "opacity-70" : "opacity-100",
          // A held finger must not also select the text underneath it.
          isPressing ? "select-none" : "",
        )}
      >
        {children}
      </div>
      <MessageTaskButton messageLabel={messageLabel} onCreateTask={onCreateTask} />
    </div>
  );
}
