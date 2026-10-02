import { useMediaQuery } from "@/hooks/use-media-query";
import { useCallback, useEffect, useState, type DragEvent, type KeyboardEvent } from "react";

/** AVORA-53 · 4.7: the drag hint is read once per device, then gets out of the way. */
const HINT_KEY = "avora.tasks.view-hint-seen";

function hintSeen(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

import { TASK_VIEW_LABELS, type TaskViewMode } from "@/lib/tasks";

/** A fine pointer that can hover and no coarse one: a computer with a mouse (and so a keyboard). */
export const KEYBOARD_POINTER_QUERY = "(hover: hover) and (pointer: fine) and (not (any-pointer: coarse))";
import { cn } from "@/lib/utils";

type TaskViewTabsProps = {
  mode: TaskViewMode;
  order: readonly TaskViewMode[];
  onChange: (mode: TaskViewMode) => void;
  onReorder: (movedId: TaskViewMode, targetId: TaskViewMode) => void;
};

/**
 * The three readings, in whatever order this person put them.
 *
 * They can be dragged around, and the one dragged to the front becomes the reading that opens
 * on arrival — the list you check first is a matter of how you work, not something the app
 * should decide. Dragging is a mouse gesture, so the same move is available from the keyboard
 * with Ctrl/⌘ + arrow keys, and the hint below the strip says so.
 */
export function TaskViewTabs({ mode, order, onChange, onReorder }: TaskViewTabsProps) {
  const [draggingId, setDraggingId] = useState<TaskViewMode | null>(null);
  const [overId, setOverId] = useState<TaskViewMode | null>(null);
  const [showHint] = useState<boolean>(() => !hintSeen());
  // AVORA-65 · B: decided by the kind of device (a mouse and a keyboard), not by screen width —
  // a phone on its side is wide but still has neither.
  const hasKeyboard = useMediaQuery(KEYBOARD_POINTER_QUERY);
  useEffect(() => {
    if (!showHint) return;
    try {
      window.localStorage.setItem(HINT_KEY, "1");
    } catch {
      // Private mode: the hint simply shows again next time.
    }
  }, [showHint]);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLButtonElement>, targetId: TaskViewMode): void => {
      event.preventDefault();
      const movedId = (event.dataTransfer.getData("text/plain") || draggingId) as TaskViewMode | "";
      setDraggingId(null);
      setOverId(null);
      if (movedId === "" || movedId === targetId) return;
      onReorder(movedId, targetId);
    },
    [draggingId, onReorder],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, option: TaskViewMode): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const index = order.indexOf(option);
      const nextIndex = event.key === "ArrowLeft" ? index - 1 : index + 1;
      const target = order[nextIndex];
      if (target === undefined) return;
      event.preventDefault();
      onReorder(option, target);
    },
    [order, onReorder],
  );

  return (
    <div>
      <div
        role="tablist"
        aria-label="Cách xem"
        className="flex items-center gap-1 rounded-[10px] border border-border bg-card p-1"
      >
        {order.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={mode === option}
            draggable={true}
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", option);
              event.dataTransfer.effectAllowed = "move";
              setDraggingId(option);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setOverId(null);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setOverId(option);
            }}
            onDragLeave={() => setOverId((current) => (current === option ? null : current))}
            onDrop={(event) => handleDrop(event, option)}
            onKeyDown={(event) => handleKeyDown(event, option)}
            onClick={() => onChange(option)}
            className={cn(
              "press min-h-12 flex-1 cursor-grab rounded-[7px] px-2 text-[13px] transition-colors active:cursor-grabbing sm:min-h-11 sm:flex-none sm:px-3",
              mode === option
                ? "bg-personal text-personal-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              draggingId === option ? "opacity-50" : "",
              overId === option && draggingId !== option ? "ring-2 ring-personal/50" : "",
            )}
          >
            {TASK_VIEW_LABELS[option]}
          </button>
        ))}
      </div>
      {showHint ? (
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          Kéo để đổi thứ tự
          {/* AVORA-61 · I: the keys are only mentioned where there is a keyboard and a mouse. */}
          {hasKeyboard ? " — thẻ đầu tiên là cách xem mở sẵn khi bạn quay lại. Dùng phím: Ctrl/⌘ + ← hoặc →" : ""}.
        </p>
      ) : null}
    </div>
  );
}
