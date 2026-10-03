import { vi } from "vitest";

/*
 * AVORA-77 · 77.9 — a book opened once reads again with no network (real IndexedDB in Chromium);
 * a book never opened on this device says so plainly.
 */
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    rpc: async () => ({ data: null, error: null }),
    from: () => ({}),
  },
}));

import { BookTextError, loadBookText } from "@/lib/reading-state";

const BOOK = {
  source: "gutenberg",
  sourceId: "77009",
  title: "Offline Test",
  authors: null,
  language: "en",
  sourceUrl: "",
  epubUrl: null,
  license: ["Public domain"],
  chapters: [
    { title: "One", blocks: [{ k: "p", t: "First chapter." }] },
    { title: "Two", blocks: [{ k: "p", t: "Second chapter." }] },
  ],
  fetchedAt: "2026-10-03T00:00:00Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

test("77.9 · sách đã mở một lần: mất mạng vẫn mở được, đủ mọi chương", async () => {
  const online = vi.fn(async () => new Response(JSON.stringify(BOOK), { status: 200 }));
  vi.stubGlobal("fetch", online);
  await loadBookText("gutenberg", "77009");
  expect(online).toHaveBeenCalledTimes(1);

  const offline = vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", offline);
  const again = await loadBookText("gutenberg", "77009");
  expect(offline).not.toHaveBeenCalled();
  expect(again.chapters.map((chapter) => chapter.blocks?.[0])).toEqual([
    { k: "p", t: "First chapter." },
    { k: "p", t: "Second chapter." },
  ]);
});

test("77.9 · sách chưa từng mở trên máy này: báo cần mạng", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  const error = await loadBookText("gutenberg", "77010").catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BookTextError);
  expect((error as BookTextError).code).toBe("offline");
});

test("79.16 · Tải về → tắt mạng → mở: đọc được cả cuốn, mọi chương", async () => {
  const { downloadBook, isOnDevice } = await import("@/lib/reading-state");
  const index = { ...BOOK, source: "wikisource", sourceId: "Probe 79", chapters: [{ title: "Một", blocks: [{ k: "p", t: "Chương một." }] }, { title: "Hai", blocks: null }, { title: "Ba", blocks: null }] };
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { part?: number };
    if (body.part === undefined) return new Response(JSON.stringify(index), { status: 200 });
    return new Response(JSON.stringify({ part: body.part, blocks: [{ k: "p", t: `Chương ${body.part + 1}.` }] }), { status: 200 });
  });
  expect(await isOnDevice("wikisource", "Probe 79")).toBe(false);
  await downloadBook("wikisource", "Probe 79");
  expect(await isOnDevice("wikisource", "Probe 79")).toBe(true);
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  const offline = await loadBookText("wikisource", "Probe 79");
  expect(offline.chapters.map((c) => c.blocks?.[0])).toEqual([{ k: "p", t: "Chương một." }, { k: "p", t: "Chương 2." }, { k: "p", t: "Chương 3." }]);
});
