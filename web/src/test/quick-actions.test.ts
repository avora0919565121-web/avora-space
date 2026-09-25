import { describe, expect, it } from "vitest";

import { BUBBLE_HOLD_MS, QUICK_ACTIONS, directQuickAction, tapQuickAction, type QuickAction } from "@/lib/quick-actions";

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

describe("quick-action bubble on a phone (AVORA 31)", () => {
  it("opens Lịch on a quick tap, whatever else the bubble holds", () => {
    expect(tapQuickAction(QUICK_ACTIONS)?.id).toBe("calendar");
    expect(tapQuickAction([])).toBeNull();
  });

  it("waits about half a second before a hold opens the chooser", () => {
    expect(BUBBLE_HOLD_MS).toBe(500);
  });
});
