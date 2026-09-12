import { Check, CheckCheck } from "lucide-react";

import type { TaskStatus } from "@/lib/tasks";
import { cn } from "@/lib/utils";

/**
 * How far along a task is, read at a glance. Four shapes, four meanings — the glyph alone
 * distinguishes accepting the task from finishing it:
 *   box    empty square — nothing taken on yet
 *   check  ring with one check — taken on, being worked
 *   half   left half filled — reported done, awaiting the creator's confirmation
 *   full   solid disc with a double check — confirmed finished
 */
export type BubbleState = "box" | "check" | "half" | "full";

/** A shared task's status maps to exactly one shape, so the two never drift apart. */
export const SHARED_BUBBLE_STATE: Record<TaskStatus, BubbleState> = {
  pending_confirmation: "box",
  confirmed: "check",
  done_pending_review: "half",
  done: "full",
};

/**
 * A personal task has no one to accept it and no one to review it, so a single check would
 * be a lie: it is either outstanding or finished.
 */
export const PERSONAL_BUBBLE_STATE: Record<TaskStatus, BubbleState> = {
  pending_confirmation: "box",
  confirmed: "box",
  done_pending_review: "box",
  done: "full",
};

const BUBBLE_BASE = "flex h-8 w-8 shrink-0 items-center justify-center transition-colors duration-200";

function BubbleVisual({ state }: { state: BubbleState }) {
  if (state === "box") {
    return <span data-bubble="box" className={cn(BUBBLE_BASE, "rounded-[7px] border border-input bg-card")} />;
  }
  if (state === "check") {
    return (
      <span
        data-bubble="check"
        className={cn(BUBBLE_BASE, "rounded-full border border-foreground bg-card text-foreground")}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
      </span>
    );
  }
  if (state === "half") {
    // The fill is absolutely positioned: a flex child would be centred by BUBBLE_BASE
    // and read as a stripe down the middle rather than a half-filled circle.
    return (
      <span
        data-bubble="half"
        className={cn(BUBBLE_BASE, "relative overflow-hidden rounded-full border border-foreground bg-card")}
      >
        <span data-bubble-fill="half" className="absolute inset-y-0 left-0 w-1/2 bg-foreground" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      data-bubble="full"
      className={cn(BUBBLE_BASE, "rounded-full border border-foreground bg-foreground text-background")}
    >
      <CheckCheck className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}

/**
 * State circle for a task. Interactive only when this person is the one who can act,
 * so the circle never invites a tap it would reject.
 */
export function TaskBubble({
  state,
  onClick,
  label,
}: {
  state: BubbleState;
  onClick?: () => void;
  label: string;
}) {
  if (!onClick) {
    return (
      <span title={label} aria-label={label} role="img" className="shrink-0">
        <BubbleVisual state={state} />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="press shrink-0 rounded-full transition-opacity hover:opacity-80"
    >
      <BubbleVisual state={state} />
    </button>
  );
}
