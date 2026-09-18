import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  deleteSummaryText,
  forwardedFromLabel,
  forwardSummaryText,
  toggleSelected,
  type ForwardResult,
} from "@/lib/forwarding";

function result(overrides: Partial<ForwardResult> = {}): ForwardResult {
  return { forwarded: 1, filesCarried: 0, filesBlocked: 0, ...overrides };
}

describe("forwardedFromLabel", () => {
  it("names who originally said it", () => {
    expect(forwardedFromLabel("Minh")).toBe("Đã chuyển tiếp từ Minh");
  });

  it("still says it was forwarded when the name is unknown", () => {
    // Better an unattributed label than none: the reader must know these are not the
    // forwarder's own words.
    expect(forwardedFromLabel(null)).toBe("Đã chuyển tiếp");
    expect(forwardedFromLabel(undefined)).toBe("Đã chuyển tiếp");
    expect(forwardedFromLabel("   ")).toBe("Đã chuyển tiếp");
  });
});

describe("forwardSummaryText", () => {
  it("reports a single message plainly", () => {
    expect(forwardSummaryText(result(), "Minh")).toBe("Đã chuyển tiếp 1 tin đến Minh.");
  });

  it("counts several", () => {
    expect(forwardSummaryText(result({ forwarded: 4 }), "Nhóm dự án")).toBe(
      "Đã chuyển tiếp 4 tin đến Nhóm dự án.",
    );
  });

  it("says out loud when files could not travel", () => {
    // Reporting only the success would let someone believe a document arrived when it did not.
    expect(forwardSummaryText(result({ forwarded: 2, filesBlocked: 3 }), "Minh")).toBe(
      "Đã chuyển tiếp 2 tin đến Minh · 3 tệp không được phép chuyển tiếp.",
    );
  });

  it("does not claim success when nothing went", () => {
    expect(forwardSummaryText(result({ forwarded: 0 }), "Minh")).toBe(
      "Không có tin nào được chuyển tiếp.",
    );
  });
});

describe("deleteSummaryText", () => {
  it("counts what was actually removed", () => {
    expect(deleteSummaryText(1)).toBe("Đã xoá 1 ghi chú.");
    expect(deleteSummaryText(5)).toBe("Đã xoá 5 ghi chú.");
  });

  it("does not claim a deletion that did not happen", () => {
    expect(deleteSummaryText(0)).toBe("Không có ghi chú nào được xoá.");
  });
});

describe("toggleSelected", () => {
  it("adds a message that was not picked", () => {
    expect(toggleSelected([], "m-1")).toEqual(["m-1"]);
    expect(toggleSelected(["m-1"], "m-2")).toEqual(["m-1", "m-2"]);
  });

  it("removes one that already was, rather than counting it twice", () => {
    expect(toggleSelected(["m-1", "m-2"], "m-1")).toEqual(["m-2"]);
  });

  it("empties down to nothing", () => {
    expect(toggleSelected(["m-1"], "m-1")).toEqual([]);
  });

  it("does not mutate the list it was given", () => {
    const original = ["m-1"];
    toggleSelected(original, "m-2");
    expect(original).toEqual(["m-1"]);
  });
});
