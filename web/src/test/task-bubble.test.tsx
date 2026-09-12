import { renderToStaticMarkup } from "react-dom/server";

import {
  PERSONAL_BUBBLE_STATE,
  SHARED_BUBBLE_STATE,
  TaskBubble,
  type BubbleState,
} from "@/components/TaskBubble";
import type { TaskStatus } from "@/lib/tasks";

function markup(state: BubbleState, onClick?: () => void): string {
  return renderToStaticMarkup(<TaskBubble state={state} label={state} onClick={onClick} />);
}

const ALL_STATUSES: TaskStatus[] = ["pending_confirmation", "confirmed", "done_pending_review", "done"];

describe("SHARED_BUBBLE_STATE", () => {
  it("walks a shared task through box, check, half, full", () => {
    expect(SHARED_BUBBLE_STATE.pending_confirmation).toBe("box");
    expect(SHARED_BUBBLE_STATE.confirmed).toBe("check");
    expect(SHARED_BUBBLE_STATE.done_pending_review).toBe("half");
    expect(SHARED_BUBBLE_STATE.done).toBe("full");
  });

  it("maps every status to its own shape, so no two states look alike", () => {
    const states = ALL_STATUSES.map((status) => SHARED_BUBBLE_STATE[status]);
    expect(new Set(states).size).toBe(ALL_STATUSES.length);
  });
});

describe("PERSONAL_BUBBLE_STATE", () => {
  it("never puts a check on an unfinished personal task", () => {
    // A personal task's 'confirmed' means "still to do", not "accepted" — nobody accepts it.
    expect(PERSONAL_BUBBLE_STATE.confirmed).toBe("box");
    expect(PERSONAL_BUBBLE_STATE.done).toBe("full");
  });

  it("only ever shows two shapes, because a personal task has no hand-off", () => {
    const states = ALL_STATUSES.map((status) => PERSONAL_BUBBLE_STATE[status]);
    expect(new Set(states)).toEqual(new Set(["box", "full"]));
  });
});

describe("TaskBubble", () => {
  it("fills the review-pending circle from its left edge, not from its centre", () => {
    const html = markup("half");
    const fill = html.match(/data-bubble-fill="half" class="([^"]+)"/)?.[1] ?? "";

    expect(fill).toContain("absolute");
    expect(fill).toContain("left-0");
    expect(fill).toContain("w-1/2");
    expect(fill).toContain("inset-y-0");
  });

  it("clips the fill to the circle so it reads as a half-moon", () => {
    const html = markup("half");
    const ring = html.match(/data-bubble="half" class="([^"]+)"/)?.[1] ?? "";

    expect(ring).toContain("rounded-full");
    expect(ring).toContain("overflow-hidden");
    expect(ring).toContain("relative");
  });

  it("keeps the unaccepted task an empty square with nothing inside it", () => {
    const html = markup("box");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("rounded-full");
    expect(html).not.toContain("bg-foreground");
  });

  it("marks an accepted task with one check and a finished task with two", () => {
    const accepted = markup("check");
    const finished = markup("full");
    const strokes = (html: string): number => (html.match(/<path/g) ?? []).length;

    expect(accepted).toContain("<svg");
    expect(finished).toContain("<svg");
    expect(strokes(finished)).toBeGreaterThan(strokes(accepted));
  });

  it("fills only the finished circle, leaving the accepted one hollow", () => {
    expect(markup("full")).toContain("bg-foreground");
    expect(markup("check")).toContain("bg-card");
    expect(markup("check")).not.toContain("bg-foreground");
  });

  it("puts no mark inside the half-filled circle, so it cannot be mistaken for finished", () => {
    expect(markup("half")).not.toContain("<svg");
  });

  it("rounds every state except the box, which stays a square", () => {
    expect(markup("check")).toContain("rounded-full");
    expect(markup("half")).toContain("rounded-full");
    expect(markup("full")).toContain("rounded-full");
    expect(markup("box")).toContain("rounded-[7px]");
  });

  it("renders as a button only when this person can act, and as an image otherwise", () => {
    expect(markup("half", () => {})).toContain("<button");
    const idle = markup("half");
    expect(idle).not.toContain("<button");
    expect(idle).toContain('role="img"');
  });

  it("always carries an accessible label", () => {
    const states: BubbleState[] = ["box", "check", "half", "full"];
    for (const state of states) {
      expect(markup(state)).toContain(`aria-label="${state}"`);
      expect(markup(state, () => {})).toContain(`aria-label="${state}"`);
    }
  });
});
