import { describe, expect, it, vi } from "vitest";

// The helpers live in the module that owns the Supabase client.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  hasAsked,
  recallRequestNote,
  requestsFor,
  type RecallRequest,
} from "@/lib/recall-requests";

function ask(overrides: Partial<RecallRequest> & { id: string }): RecallRequest {
  return {
    messageId: "m-1",
    requestedBy: "u-hoa",
    createdAt: "2026-09-17T00:00:00Z",
    ...overrides,
  };
}

describe("requestsFor", () => {
  it("keeps only the asks against the message in question", () => {
    const all = [ask({ id: "a" }), ask({ id: "b", messageId: "m-2" }), ask({ id: "c" })];
    expect(requestsFor(all, "m-1").map((entry) => entry.id)).toEqual(["a", "c"]);
  });

  it("answers an untouched message with nothing", () => {
    expect(requestsFor([ask({ id: "a" })], "m-999")).toEqual([]);
  });
});

describe("hasAsked", () => {
  const all = [ask({ id: "a", requestedBy: "u-hoa" }), ask({ id: "b", requestedBy: "u-dung" })];

  it("is true once this person has already asked about this message", () => {
    expect(hasAsked(all, "m-1", "u-hoa")).toBe(true);
  });

  it("is false for somebody who has not asked, even when others have", () => {
    expect(hasAsked(all, "m-1", "u-minh")).toBe(false);
  });

  it("does not carry an ask across to a different message", () => {
    expect(hasAsked(all, "m-2", "u-hoa")).toBe(false);
  });

  it("is false when nobody is signed in, rather than throwing", () => {
    expect(hasAsked(all, "m-1", undefined)).toBe(false);
  });
});

describe("recallRequestNote", () => {
  it("names one person outright", () => {
    expect(recallRequestNote(["Hoà"])).toBe("Hoà đề nghị bạn thu hồi tin nhắn này.");
  });

  it("names two people, because a pair is still a sentence", () => {
    expect(recallRequestNote(["Hoà", "Dũng"])).toBe(
      "Hoà và Dũng đề nghị bạn thu hồi tin nhắn này.",
    );
  });

  it("counts past two, where a list of names stops being readable", () => {
    expect(recallRequestNote(["Hoà", "Dũng", "Minh"])).toBe(
      "Hoà và 2 người khác đề nghị bạn thu hồi tin nhắn này.",
    );
  });

  it("says nothing at all when nobody has asked", () => {
    expect(recallRequestNote([])).toBe("");
  });
});
