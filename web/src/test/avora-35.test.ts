import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { findJournal } from "@/hooks/use-paste-task";
import type { ConversationSummary } from "@/lib/chat-cache";
import { hasUnseenMessageIds, reactionKeys } from "@/lib/reactions";
import { PERSONAL_PLACE, tablePlaces } from "@/lib/table-places";

function conversation(overrides: Partial<ConversationSummary> & Pick<ConversationSummary, "conversationId" | "kind">): ConversationSummary {
  return {
    peerId: null,
    peerName: "",
    groupName: null,
    ...overrides,
  } as ConversationSummary;
}

const journal = conversation({ conversationId: "j", kind: "personal" });
const withAn = conversation({ conversationId: "d1", kind: "direct", peerName: "An" });
const withBinh = conversation({ conversationId: "d2", kind: "direct", peerName: "Bình" });
const team = conversation({ conversationId: "g1", kind: "group", groupName: "Kho" });
const all = [journal, withAn, team, withBinh];

describe("reaction cache key (AVORA-35 / B)", () => {
  it("is the conversation alone, so new messages never reset it", () => {
    expect(reactionKeys.thread("c1")).toEqual(["message-reactions", "c1"]);
    expect(reactionKeys.thread("c1")).toHaveLength(2);
  });

  it("asks for a refetch only when an id the last fetch did not cover appears", () => {
    const fetched = new Set<string>(["m1", "m2"]);
    expect(hasUnseenMessageIds(fetched, ["m1", "m2"])).toBe(false);
    expect(hasUnseenMessageIds(fetched, ["m2"])).toBe(false);
    expect(hasUnseenMessageIds(fetched, ["m1", "m2", "m3"])).toBe(true);
    expect(hasUnseenMessageIds(fetched, ["m0", "m1"])).toBe(true);
  });
});

describe("\"Ở đâu\" for a new table (AVORA-35 / D)", () => {
  it("offers only the Diary and the originating 1-1", () => {
    expect(tablePlaces(all, "d1")).toEqual([PERSONAL_PLACE, { conversationId: "d1", label: "1-1 với An" }]);
  });

  it("offers only the Diary and the originating group", () => {
    expect(tablePlaces(all, "g1")).toEqual([PERSONAL_PLACE, { conversationId: "g1", label: "Nhóm Kho" }]);
  });

  it("lists every 1-1 then every group from Kế hoạch's \"+\"", () => {
    expect(tablePlaces(all, null).map((place) => place.conversationId)).toEqual([null, "d1", "d2", "g1"]);
  });

  it("falls back to the full list for an origin that is not one of the viewer's conversations", () => {
    expect(tablePlaces(all, "gone")).toHaveLength(4);
    expect(tablePlaces(all, "j")).toHaveLength(4);
  });
});

describe("paste-task hook (AVORA-35 / F)", () => {
  it("finds the Diary from the shared conversations cache", () => {
    expect(findJournal(all)?.conversationId).toBe("j");
  });

  it("finds nothing before the conversations have loaded", () => {
    expect(findJournal(undefined)).toBeUndefined();
    expect(findJournal([withAn, team])).toBeUndefined();
  });
});
