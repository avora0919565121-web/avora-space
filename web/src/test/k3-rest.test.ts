import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as unknown as { window: unknown }).window = { localStorage, addEventListener: () => undefined };
  (globalThis as unknown as { document: unknown }).document = { addEventListener: () => undefined, visibilityState: "visible" };
});

import { readDraft } from "@/lib/chat-drafts";
import {
  DRAFT_SAVE_DELAY_MS,
  flushComposerDrafts,
  getComposerDraft,
  resetComposerDrafts,
  setComposerDraft,
} from "@/lib/composer-draft";
import { thumbnailPathOf } from "@/lib/attachments";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

describe("K3 · N3 composer draft store", () => {
  afterEach(() => {
    resetComposerDrafts();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("keeps the words in memory at once and saves them 400 ms after the last key", () => {
    vi.useFakeTimers();
    setComposerDraft("u1", "c1", "xin");
    setComposerDraft("u1", "c1", (current) => `${current} chào`);
    expect(getComposerDraft("u1", "c1")).toBe("xin chào");
    expect(readDraft("u1", "c1")).toBe("");
    vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS);
    expect(readDraft("u1", "c1")).toBe("xin chào");
  });

  it("an empty box (a send) is saved at once, and hiding the page flushes", () => {
    vi.useFakeTimers();
    setComposerDraft("u1", "c1", "đang gõ");
    flushComposerDrafts();
    expect(readDraft("u1", "c1")).toBe("đang gõ");
    setComposerDraft("u1", "c1", "");
    expect(readDraft("u1", "c1")).toBe("");
  });

  it("each thread keeps its own words", () => {
    setComposerDraft("u1", "c1", "một");
    setComposerDraft("u1", "c2", "hai");
    expect(getComposerDraft("u1", "c1")).toBe("một");
    expect(getComposerDraft("u1", "c2")).toBe("hai");
  });
});

describe("K3 · N2 thumbnails", () => {
  it("sit beside the photo in the same upload folder", () => {
    expect(thumbnailPathOf("conv/abc/photo.jpg")).toBe("conv/abc/thumb-320.webp");
    expect(thumbnailPathOf("photo.jpg")).toBeNull();
  });
});

import { bubbleRuns } from "@/lib/chat-cache";
import { swipeIntent } from "@/lib/message-swipe";

describe("K4 · 3 bubble runs", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 10, 8, minutes)).toISOString();
  it("same sender within 5 minutes is one run; a gap, another sender or a system line breaks it", () => {
    const runs = bubbleRuns([
      { id: "a", senderId: "lan", createdAt: at(0), systemKind: null },
      { id: "b", senderId: "lan", createdAt: at(4), systemKind: null },
      { id: "c", senderId: "lan", createdAt: at(10), systemKind: null },
      { id: "d", senderId: "me", createdAt: at(11), systemKind: null },
      { id: "s", senderId: "me", createdAt: at(11), systemKind: "member_left_task" },
      { id: "e", senderId: "me", createdAt: at(12), systemKind: null },
    ]);
    expect(runs.get("a")).toEqual({ start: true, end: false });
    expect(runs.get("b")).toEqual({ start: false, end: true });
    expect(runs.get("c")).toEqual({ start: true, end: true });
    expect(runs.get("d")).toEqual({ start: true, end: true });
    expect(runs.has("s")).toBe(false);
    expect(runs.get("e")).toEqual({ start: true, end: true });
  });
});

describe("K4 · 4 swipe intent", () => {
  it("mostly vertical is a scroll, sideways is a swipe, tiny moves wait", () => {
    expect(swipeIntent(4, 3)).toBeNull();
    expect(swipeIntent(10, 30)).toBe("scroll");
    expect(swipeIntent(-40, 10)).toBe("swipe");
    expect(swipeIntent(40, 20)).toBe("swipe");
  });
});
