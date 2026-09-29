import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { highlightParts, resultHref, splitResults, type SearchResult } from "@/lib/search";

function result(over: Partial<SearchResult> & { id: string }): SearchResult {
  return {
    kind: "message", title: null, snippet: "", placeKind: "group", placeId: null, placeName: "Nhóm PBA",
    conversationId: "c1", at: "2026-09-01T00:00:00Z", inHere: false, scope: "group", ...over,
  };
}

describe("ADR-032 · where you stand comes first", () => {
  it("splits here / elsewhere, each newest first, without duplicates", () => {
    const split = splitResults([
      result({ id: "a", inHere: false, at: "2026-09-03" }),
      result({ id: "b", inHere: true, at: "2026-09-01" }),
      result({ id: "c", inHere: true, at: "2026-09-02" }),
      result({ id: "c", inHere: true, at: "2026-09-02" }),
    ]);
    expect(split.here.map((item) => item.id)).toEqual(["c", "b"]);
    expect(split.elsewhere.map((item) => item.id)).toEqual(["a"]);
  });
  it("bolds the accented words when typed without accents (44.11)", () => {
    const parts = highlightParts("Gửi báo giá nhà ở", "bao gia");
    expect(parts.filter((part) => part.match).map((part) => part.text).join("|")).toBe("báo|giá");
    expect(parts.map((part) => part.text).join("")).toBe("Gửi báo giá nhà ở");
  });
  it("each kind opens its own place: a message jumps to the message", () => {
    expect(resultHref(result({ id: "m1" }), "j")).toBe("/tin-nhan/c1?toi=m1");
    expect(resultHref(result({ id: "n1", kind: "note" }), "j")).toBe("/tin-nhan/j?xem=ghi-chep&ghi-chep=n1");
    expect(resultHref(result({ id: "r1", kind: "record", placeId: "t1" }), "j")).toBe("/ke-hoach?bang=t1&hang-muc=r1");
    expect(resultHref(result({ id: "k1", kind: "task" }), "j")).toBe("/nhiem-vu?muc=viec&mo=k1");
  });
});
