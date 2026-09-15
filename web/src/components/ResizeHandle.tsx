import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import type { ColumnWidthControl } from "@/lib/column-width";
import { cn } from "@/lib/utils";

/**
 * The drag strip at a column boundary on desktop.
 *
 * A grab handle is honest about being one: on rest it shows the same border colour the
 * layout already uses, so the line does not shout, and answers the pointer the moment it
 * arrives. Double-click gives the default back; arrow keys move it for anyone not dragging.
 * It renders only at `md` and up — the phone layout has one column and nothing to resize.
 */
export function ResizeHandle({
  columnRef,
  control,
  label,
}: {
  columnRef: RefObject<HTMLElement | null>;
  control: ColumnWidthControl;
  label: string;
}) {
  const handleRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return;
      const column = columnRef.current;
      const handle = handleRef.current;
      if (!column || !handle) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);

      const left = column.getBoundingClientRect().left;
      setIsDragging(true);
      const onMove = (moveEvent: PointerEvent): void => control.resize(moveEvent.clientX - left);
      const stop = (): void => {
        window.removeEventListener("pointermove", onMove);
        setIsDragging(false);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop, { once: true });
      window.addEventListener("pointercancel", stop, { once: true });
    },
    [columnRef, control],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        control.nudge(-16);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        control.nudge(16);
        return;
      }
      if (event.key === "Home" || event.key === "Enter") {
        event.preventDefault();
        control.reset();
      }
    },
    [control],
  );

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={control.reset}
      onKeyDown={handleKeyDown}
      title={`${label} — kéo để đổi, nhấp đúp để về mặc định`}
      className={cn(
        "group absolute inset-y-0 right-0 z-20 hidden w-2.5 -mr-[5px] cursor-col-resize touch-none select-none md:flex",
        isDragging && "bg-primary/5",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mx-auto h-16 w-[3px] self-center rounded-full transition-colors",
          isDragging
            ? "bg-primary"
            : "bg-border group-hover:bg-primary/50 group-focus-visible:bg-primary/60",
        )}
      />
    </div>
  );
}
