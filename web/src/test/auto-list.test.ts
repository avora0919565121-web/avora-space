import { describe, expect, it } from "vitest";

import { continueList, isEmptyItem, readMarker } from "@/lib/auto-list";

describe("readMarker", () => {
  it("recognises the two shapes people actually type", () => {
    expect(readMarker("- mua vé")).toEqual({ kind: "bullet", indent: "", marker: "-" });
    expect(readMarker("1. chốt ngân sách")).toEqual({
      kind: "number",
      indent: "",
      value: 1,
      separator: ".",
    });
    expect(readMarker("2) gửi báo giá")).toEqual({
      kind: "number",
      indent: "",
      value: 2,
      separator: ")",
    });
  });

  it("keeps the indentation a line already carries", () => {
    expect(readMarker("  - việc con")).toEqual({ kind: "bullet", indent: "  ", marker: "-" });
  });

  it("leaves ordinary prose completely alone", () => {
    expect(readMarker("Hôm nay nhóm thống nhất")).toBeNull();
    // A dash inside a sentence is punctuation, not a list.
    expect(readMarker("Chi phí — đã duyệt")).toBeNull();
    // A date is not an ordered list either.
    expect(readMarker("2026 là năm bản lề")).toBeNull();
  });
});

describe("isEmptyItem", () => {
  it("is true only for a marker with nothing written after it", () => {
    expect(isEmptyItem("- ")).toBe(true);
    expect(isEmptyItem("3. ")).toBe(true);
    expect(isEmptyItem("- mua vé")).toBe(false);
    expect(isEmptyItem("nothing")).toBe(false);
  });
});

describe("continueList", () => {
  it("opens the next line with the same bullet", () => {
    const value = "- mua vé";
    const result = continueList(value, value.length);
    expect(result).not.toBeNull();
    expect(result?.value).toBe("- mua vé\n- ");
    // The caret sits after the new marker, ready for the next word.
    expect(result?.caret).toBe("- mua vé\n- ".length);
  });

  it("counts numbered lines on rather than repeating the number", () => {
    const value = "1. chốt ngân sách";
    const result = continueList(value, value.length);
    expect(result?.value).toBe("1. chốt ngân sách\n2. ");
  });

  it("keeps the separator the person chose", () => {
    const value = "1) việc đầu";
    expect(continueList(value, value.length)?.value).toBe("1) việc đầu\n2) ");
  });

  it("carries the indentation down to the next line", () => {
    const value = "  - việc con";
    expect(continueList(value, value.length)?.value).toBe("  - việc con\n  - ");
  });

  /**
   * The behaviour that makes a list escapable. Without it the only way out of a list is
   * deleting the marker by hand, every single time.
   */
  it("ends the list when Enter lands on an empty item", () => {
    const value = "- mua vé\n- ";
    const result = continueList(value, value.length);
    expect(result?.value).toBe("- mua vé\n\n");
    expect(result?.caret).toBe("- mua vé\n".length + 1);
  });

  it("says no on an ordinary line, so prose keeps its normal Enter", () => {
    const value = "Nhóm đã thống nhất";
    expect(continueList(value, value.length)).toBeNull();
  });

  it("continues from the middle of a document, not just the end", () => {
    const value = "- một\n- hai\nphần sau";
    const caret = "- một\n- hai".length;
    const result = continueList(value, caret);
    expect(result?.value).toBe("- một\n- hai\n- \nphần sau");
  });

  it("splits the text it is given rather than appending to the end", () => {
    const value = "- một cái gì đó";
    const caret = "- một".length;
    const result = continueList(value, caret);
    expect(result?.value).toBe("- một\n-  cái gì đó");
  });

  it("counts past nine without losing the number", () => {
    const value = "10. mười";
    expect(continueList(value, value.length)?.value).toBe("10. mười\n11. ");
  });
});
