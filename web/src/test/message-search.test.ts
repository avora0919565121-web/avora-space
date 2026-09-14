import { describe, expect, it } from "vitest";

// Pure helpers, so the Supabase client is never involved.
import {
  isSearchable,
  matchExcerpt,
  MESSAGE_SEARCH_MIN_LENGTH,
} from "@/lib/chat-cache";

describe("when a query is worth sending", () => {
  /** One character matches most of a thread, which is not a search result, it is the thread. */
  it("waits for at least two characters", () => {
    expect(MESSAGE_SEARCH_MIN_LENGTH).toBe(2);
    expect(isSearchable("")).toBe(false);
    expect(isSearchable("a")).toBe(false);
    expect(isSearchable("ab")).toBe(true);
  });

  it("does not count whitespace as typing", () => {
    expect(isSearchable("   ")).toBe(false);
    expect(isSearchable(" a ")).toBe(false);
    expect(isSearchable(" ab ")).toBe(true);
  });
});

describe("showing why a result matched", () => {
  it("reports where the match sits so it can be highlighted", () => {
    const result = matchExcerpt("Hẹn gặp lúc ba giờ chiều nhé", "ba giờ");
    expect(result.text).toContain("ba giờ");
    expect(result.matchLength).toBe("ba giờ".length);
    expect(result.text.slice(result.matchStart, result.matchStart + result.matchLength)).toBe(
      "ba giờ",
    );
  });

  /** Vietnamese is case-insensitive to a searcher; the excerpt keeps the original casing. */
  it("finds a match regardless of case, and quotes the text as written", () => {
    const result = matchExcerpt("Gửi Báo Cáo tháng 8", "báo cáo");
    expect(result.text.slice(result.matchStart, result.matchStart + result.matchLength)).toBe(
      "Báo Cáo",
    );
  });

  /**
   * The reason this exists rather than a plain `slice(0, 80)`: in a long message the words
   * someone searched for are usually not in the first 80 characters, so a naive preview shows
   * a row of results that all look unrelated to the query.
   */
  it("keeps a window around the match instead of quoting from the start", () => {
    const content = `${"x".repeat(300)} điều quan trọng ${"y".repeat(300)}`;
    const result = matchExcerpt(content, "điều quan trọng");
    expect(result.text).toContain("điều quan trọng");
    expect(result.text.length).toBeLessThan(120);
    expect(result.text.startsWith("…")).toBe(true);
    expect(result.text.endsWith("…")).toBe(true);
  });

  it("does not add an ellipsis when the match is already at the edge", () => {
    const result = matchExcerpt("điều quan trọng nằm ở đầu câu", "điều");
    expect(result.text.startsWith("…")).toBe(false);
  });

  it("flattens line breaks so a result stays one readable line", () => {
    const result = matchExcerpt("dòng một\n\ndòng hai", "dòng hai");
    expect(result.text).toBe("dòng một dòng hai");
  });

  it("returns the message unmarked when nothing matches", () => {
    const result = matchExcerpt("không có gì ở đây", "vắng mặt");
    expect(result.matchStart).toBe(-1);
    expect(result.matchLength).toBe(0);
  });

  it("treats an empty query as no match rather than matching everything", () => {
    const result = matchExcerpt("một nội dung nào đó", "   ");
    expect(result.matchStart).toBe(-1);
  });
});
