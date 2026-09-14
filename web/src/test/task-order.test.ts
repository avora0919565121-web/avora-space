import { describe, expect, it } from "vitest";

import {
  applyManualOrder,
  DEFAULT_VIEW_ORDER,
  defaultViewMode,
  moveBefore,
  moveItem,
  normalizeViewOrder,
  reorderIds,
} from "@/lib/task-order";

describe("moveItem", () => {
  it("drops the moved entry where it landed", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("leaves the list alone when the drop goes nowhere useful", () => {
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], -1, 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 0, 9)).toEqual(["a", "b", "c"]);
  });

  it("never mutates the list it was given", () => {
    const original = ["a", "b", "c"];
    moveItem(original, 0, 2);
    expect(original).toEqual(["a", "b", "c"]);
  });
});

describe("moveBefore", () => {
  it("moves one entry onto another's place", () => {
    expect(moveBefore(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("ignores a drop involving something not in the list", () => {
    expect(moveBefore(["a", "b"], "z", "a")).toEqual(["a", "b"]);
  });
});

describe("normalizeViewOrder", () => {
  it("keeps a good stored order as it is", () => {
    expect(normalizeViewOrder(["important", "deadline", "relationship", "heavy"])).toEqual([
      "important",
      "deadline",
      "relationship",
      "heavy",
    ]);
  });

  it("falls back to the shipped order when nothing was stored", () => {
    expect(normalizeViewOrder(null)).toEqual([...DEFAULT_VIEW_ORDER]);
    expect(normalizeViewOrder("hỏng")).toEqual([...DEFAULT_VIEW_ORDER]);
  });

  it("drops what it does not recognise and restores what is missing", () => {
    // A stale or hand-edited value must never leave the screen with a mode it cannot show.
    expect(normalizeViewOrder(["important", "khong-ton-tai"])).toEqual([
      "important",
      "deadline",
      "relationship",
      "heavy",
    ]);
    expect(normalizeViewOrder(["important", "important"])).toEqual([
      "important",
      "deadline",
      "relationship",
      "heavy",
    ]);
  });

  /**
   * Someone who arranged their tabs before the heavy view existed keeps the arrangement they
   * made, and the new tab arrives at the end rather than displacing their first choice.
   */
  it("appends a newly shipped reading without disturbing a saved arrangement", () => {
    expect(normalizeViewOrder(["important", "relationship", "deadline"])).toEqual([
      "important",
      "relationship",
      "deadline",
      "heavy",
    ]);
    expect(defaultViewMode(normalizeViewOrder(["important", "relationship", "deadline"]))).toBe(
      "important",
    );
  });
});

describe("defaultViewMode", () => {
  it("opens whichever reading was dragged to the front", () => {
    expect(defaultViewMode(["important", "deadline", "relationship"])).toBe("important");
    expect(defaultViewMode(DEFAULT_VIEW_ORDER)).toBe("deadline");
  });

  it("opens the deadline view when there is no order at all", () => {
    expect(defaultViewMode([])).toBe("deadline");
  });
});

describe("applyManualOrder", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("arranges the tasks the person has placed by hand", () => {
    expect(applyManualOrder(items, ["c", "a", "b"]).map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("leaves an untouched list in the order it arrived", () => {
    expect(applyManualOrder(items, []).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("puts tasks nobody has arranged after the ones they have", () => {
    // A new arrival must not silently jump the queue someone built by hand.
    expect(applyManualOrder(items, ["c"]).map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("ignores saved positions for tasks that are no longer there", () => {
    expect(applyManualOrder(items, ["zz", "b"]).map((item) => item.id)).toEqual(["b", "a", "c"]);
  });
});

describe("reorderIds", () => {
  it("records the first drag of a list that had no saved order", () => {
    expect(reorderIds(["a", "b", "c"], [], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("builds on the order already saved", () => {
    expect(reorderIds(["a", "b", "c"], ["c", "b", "a"], "a", "c")).toEqual(["a", "c", "b"]);
  });
});
