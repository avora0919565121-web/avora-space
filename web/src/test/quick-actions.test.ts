import { describe, expect, it } from "vitest";

import { QUICK_ACTIONS, directQuickAction } from "@/lib/quick-actions";

describe("quick-action bubble", () => {
  it("holds exactly Lịch today, and a tap opens it directly", () => {
    expect(QUICK_ACTIONS.map((action) => action.id)).toEqual(["calendar"]);
    expect(directQuickAction(QUICK_ACTIONS)?.id).toBe("calendar");
  });

  it("does not guess when there is more than one action", () => {
    const two = [...QUICK_ACTIONS, { id: "calendar" as const, label: "Khác" }];
    expect(directQuickAction(two)).toBeNull();
    expect(directQuickAction([])).toBeNull();
  });
});
