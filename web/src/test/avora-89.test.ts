import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { activeTrigger, applyRef, refsInText, removeTrigger, foldVi } from "@/lib/context-refs";
import { ADULT_BOOK_IDS, withoutAdultInBrowse } from "@/lib/book-catalog";

const migration = (name: string): string => readFileSync(path.resolve(__dirname, "../../../supabase/migrations", name), "utf8");

describe("AVORA-89 · PHẦN 1 · 80.x — @ / # / @@ in the composer", () => {
  it("80.7 · triggers only at the start of a word; @@ beats @; email is not a trigger", () => {
    expect(activeTrigger("@", 1)?.kind).toBe("at");
    expect(activeTrigger("xem @@Mi", 8)).toEqual({ kind: "atat", query: "Mi", start: 4 });
    expect(activeTrigger("gửi #bao", 8)).toEqual({ kind: "hash", query: "bao", start: 4 });
    expect(activeTrigger("a@b.com", 7)).toBeNull();
    expect(activeTrigger("@Lan ", 5)).toBeNull();
  });

  it("80.9 · a chosen # is written as #label; deleting the words un-refs it", () => {
    const t = activeTrigger("xem #ba", 7)!;
    const out = applyRef("xem #ba", t, 7, "ban-ve.pdf");
    expect(out.text).toBe("xem #ban-ve.pdf ");
    const ref = { kind: "file" as const, id: "f1", label: "ban-ve.pdf" };
    expect(refsInText(out.text, [ref, ref])).toEqual([ref]);
    expect(refsInText("xem nhé", [ref])).toEqual([]);
    expect(removeTrigger("hi @@Mi", activeTrigger("hi @@Mi", 7)!, 7).text).toBe("hi ");
    expect(foldVi("Kiêu Hãnh Đẹp")).toBe("kieu hanh dep");
  });

  it("ADR-052 · the server gates: suggestions, saves, @@ cards", () => {
    const sql = migration("20261006083000_avora89_mentions_refs.sql");
    expect(sql).toContain("raise exception 'avora_ref_out_of_scope'");
    expect(sql).toContain("raise exception 'avora_contact_card_not_allowed'");
    expect(sql).toContain("create trigger messages_enforce_refs before insert or update on public.messages");
    // contact card never insertable directly — only `refs` gets a column grant.
    expect(sql).toContain("grant insert (refs) on public.messages to authenticated;");
    expect(sql).not.toMatch(/grant insert \([^)]*contact_card_user_id/);
    expect(sql).toMatch(/revoke all on function public\.%s from public, anon/);
    // Comments may say "no phone, email"; no query ever reads those columns.
    expect(sql).not.toMatch(/\.(phone|email)\b/);
  });
});

describe("AVORA-89 · PHẦN 1 · 1.2 – 1.5", () => {
  it("1.2 · adult titles leave a browse but stay findable by name", () => {
    const books = [{ source: "gutenberg" as const, sourceId: "27827" }, { source: "gutenberg" as const, sourceId: "1342" }];
    expect(ADULT_BOOK_IDS.has("gutenberg:27827")).toBe(true);
    expect(withoutAdultInBrowse(books, "").map((b) => b.sourceId)).toEqual(["1342"]);
    expect(withoutAdultInBrowse(books, "kama").length).toBe(2);
  });

  it("87.3 · review file: every row has the catalogue title; 34380 is gone", () => {
    const rows = readFileSync(path.resolve(__dirname, "../../../docs/book_title_vi_review.csv"), "utf8").trim().split("\n");
    expect(rows[0]).toBe("source_id,title,authors,language,title_vi,title_vi_kind");
    expect(rows.some((row) => row.startsWith("34380,"))).toBe(false);
    expect(rows.find((row) => row.startsWith("17989,"))).toContain("Tập 1");
  });

  it("87.4 · enqueue_message_push has an empty search_path", () => {
    const sql = migration("20261006080000_avora89_push_search_path.sql");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("public.push_outbox");
  });

  it("87.6 · board opened: mine only, session_allowed, 10 minutes", () => {
    const sql = migration("20261006082000_avora89_board_opened.sql");
    expect(sql).toContain("as restrictive for all");
    expect(sql).toContain("interval '10 minutes'");
    expect(sql).toContain("revoke all on public.think_hub_board_opened from public, anon, authenticated;");
  });
});

describe("AVORA-89 · PHẦN 2 · room + templates (logic only)", async () => {
  const { neighbour, adjacentShelves, roomFromParams, swipeDirection } = await import("@/lib/room");
  const { libraryTemplates } = await import("@/lib/think-hub-shelf");

  it("88.2 · no wrap-around: 1/4 have no left, 3/6 no right; 2↕5", () => {
    expect([neighbour(1, "left"), neighbour(4, "left"), neighbour(3, "right"), neighbour(6, "right")]).toEqual([null, null, null, null]);
    expect([neighbour(2, "down"), neighbour(5, "up"), neighbour(5, "down")]).toEqual([5, 2, null]);
    expect(adjacentShelves(6).map((a) => a.to)).toEqual([5, 3]);
  });

  it("88.11 · old addresses open the right shelf", () => {
    const at = (q: string) => roomFromParams(new URLSearchParams(q))?.shelf;
    expect([at("bay=tien-trinh"), at("bay=noi"), at("ke=ke-sach"), at("ngan=avora"), at("ke=mac-dinh"), at("ke=khac"), at("ke=4")]).toEqual([3, 3, 5, 4, 4, 3, 4]);
    expect(roomFromParams(new URLSearchParams(""))).toBeNull();
    expect([swipeDirection(-80, 10), swipeDirection(80, 5), swipeDirection(30, 0), swipeDirection(60, 70)]).toEqual(["right", "left", null, null]);
  });

  it("88.15 · Quyết định × Học sinh → Chọn trường; used / mine first", () => {
    const t = (id: string, type: "weigh" | "learn", audiences: ("hoc_sinh" | "sales" | "moi_nguoi")[], sortOrder: number) =>
      ({ id, source: "system", name: id, thinkingType: type, guidingQuestion: null, description: null, scopes: ["journal"], columns: [{ label: "x", type: "text" }], statuses: [], titleLabel: "", subTemplateName: null, sortOrder, audiences, whenToUse: null, exampleRows: [] }) as never;
    const all = [t("weigh_options", "weigh", ["moi_nguoi"], 60), t("choose_school", "weigh", ["hoc_sinh"], 240), t("objections", "learn", ["sales"], 340)];
    expect(libraryTemplates(all, { type: "weigh", audiences: ["hoc_sinh"] }, [], new Map()).map((x: { id: string }) => x.id)).toEqual(["choose_school"]);
    expect(libraryTemplates(all, { type: null, audiences: [] }, ["sales"], new Map()).map((x: { id: string }) => x.id)[0]).toBe("objections");
    expect(libraryTemplates(all, { type: null, audiences: [] }, ["sales"], new Map([["choose_school", "2026-10-01"]])).map((x: { id: string }) => x.id)[0]).toBe("choose_school");
  });
});
