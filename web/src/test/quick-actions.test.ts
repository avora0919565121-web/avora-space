import { describe, expect, it } from "vitest";

import { QUICK_ACTIONS, directQuickAction, type QuickAction } from "@/lib/quick-actions";

describe("quick-action bubble", () => {
  it("holds Lịch first, then Avora AI — the assistant is named but not built", () => {
    expect(QUICK_ACTIONS.map((action) => action.id)).toEqual(["calendar", "assistant"]);
    expect(QUICK_ACTIONS.find((action) => action.id === "assistant")?.isUpcoming).toBe(true);
    expect(QUICK_ACTIONS.find((action) => action.id === "calendar")?.isUpcoming).toBe(false);
  });

  it("opens a chooser rather than guessing when there is more than one action", () => {
    expect(directQuickAction(QUICK_ACTIONS)).toBeNull();
    expect(directQuickAction([])).toBeNull();
  });

  it("still opens a single action directly", () => {
    const only: QuickAction[] = [QUICK_ACTIONS[0]];
    expect(directQuickAction(only)?.id).toBe("calendar");
  });
});
