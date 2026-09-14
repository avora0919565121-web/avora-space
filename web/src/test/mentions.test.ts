import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  activeMentionQuery,
  applyMention,
  extractMentionedIds,
  filterMentionCandidates,
  mentionCandidates,
  mentionsViewer,
  splitMentions,
  type MentionCandidate,
} from "@/lib/mentions";
import type { GroupMember } from "@/lib/groups";

const ME = "u-me";
const MINH = "u-minh";
const AN = "u-an";
const AN_NHIEN = "u-an-nhien";

function member(userId: string, displayName: string): GroupMember {
  return {
    userId,
    displayName,
    email: `${userId}@example.com`,
    role: "member",
    joinedAt: "2026-09-01T00:00:00Z",
  } as GroupMember;
}

const CANDIDATES: MentionCandidate[] = [
  { userId: MINH, name: "Nguyễn Văn Minh" },
  { userId: AN, name: "An" },
  { userId: AN_NHIEN, name: "An Nhiên" },
];

describe("who can be named", () => {
  /** Naming yourself says nothing, so you are never in your own picker. */
  it("leaves the person writing out of the list", () => {
    const members = [member(ME, "Tôi"), member(MINH, "Minh")];
    const list = mentionCandidates(members, ME);
    expect(list.map((entry) => entry.userId)).toEqual([MINH]);
  });

  it("sorts the list so the same names appear in the same order every time", () => {
    const members = [member(MINH, "Minh"), member(AN, "An")];
    expect(mentionCandidates(members, ME).map((entry) => entry.name)).toEqual(["An", "Minh"]);
  });
});

describe("spotting the @ being typed", () => {
  it("finds an @ at the caret", () => {
    const found = activeMentionQuery("chào @mi", 8);
    expect(found?.query).toBe("mi");
    // "chào " is five characters, so the "@" itself sits at index 5.
    expect(found?.start).toBe(5);
  });

  it("finds an @ that starts the message", () => {
    expect(activeMentionQuery("@an", 3)?.query).toBe("an");
  });

  /** Otherwise typing an email address would open the picker halfway through. */
  it("ignores an @ in the middle of a word", () => {
    expect(activeMentionQuery("minh@example.com", 16)).toBeNull();
  });

  /**
   * A space ends the mention. Without this the picker would keep matching across the rest of
   * the sentence and fight whatever the person was writing.
   */
  it("stops once a space is typed", () => {
    expect(activeMentionQuery("@an rồi thì", 11)).toBeNull();
  });

  it("says nothing when there is no @ at all", () => {
    expect(activeMentionQuery("không có gì", 11)).toBeNull();
  });

  it("looks only behind the caret, not at text typed after it", () => {
    // Caret sits before the "@", so nothing is being mentioned yet.
    expect(activeMentionQuery("xin chào @an", 5)).toBeNull();
  });
});

describe("narrowing the suggestions", () => {
  it("offers everyone while nothing is typed yet", () => {
    expect(filterMentionCandidates(CANDIDATES, "")).toHaveLength(3);
  });

  /** People type the part of the name they remember, which is often not the first word. */
  it("matches any word of a name, not just the first", () => {
    const found = filterMentionCandidates(CANDIDATES, "minh");
    expect(found.map((entry) => entry.userId)).toEqual([MINH]);
  });

  it("ignores case, because nobody capitalises mid-sentence", () => {
    expect(filterMentionCandidates(CANDIDATES, "NGUYỄN")).toHaveLength(1);
  });

  it("returns nothing when the query matches nobody", () => {
    expect(filterMentionCandidates(CANDIDATES, "zzz")).toHaveLength(0);
  });
});

describe("inserting a chosen name", () => {
  it("replaces the @… that was typed and leaves a trailing space", () => {
    const result = applyMention("chào @mi", { start: 5, caret: 8 }, CANDIDATES[0] as MentionCandidate);
    expect(result.text).toBe("chào @Nguyễn Văn Minh ");
    expect(result.caret).toBe(result.text.length);
  });

  /** The caret has to land after the name, or the next keystroke goes in the wrong place. */
  it("keeps whatever was written after the caret", () => {
    const result = applyMention(
      "chào @mi nhé",
      { start: 5, caret: 8 },
      CANDIDATES[1] as MentionCandidate,
    );
    expect(result.text).toBe("chào @An  nhé");
    expect(result.text.slice(result.caret)).toBe(" nhé");
  });
});

describe("reading who was named off the finished text", () => {
  it("records a named member", () => {
    expect(extractMentionedIds("chào @An nhé", CANDIDATES)).toEqual([AN]);
  });

  /**
   * The reason longer names are matched first: "@An" is a prefix of "@An Nhiên", so a naive
   * scan would credit the wrong person for a message naming the other one.
   */
  it("prefers the longer name when one is a prefix of another", () => {
    const found = extractMentionedIds("nhờ @An Nhiên xem lại", CANDIDATES);
    expect(found).toEqual([AN_NHIEN]);
  });

  it("records several people named in one message", () => {
    const found = extractMentionedIds("@An và @Nguyễn Văn Minh cùng xem", CANDIDATES);
    expect(found.sort()).toEqual([AN, MINH].sort());
  });

  /**
   * The ids follow the words. Deleting part of a mention un-names that person, which is what
   * someone editing the sentence expects — the alternative is a message that still rings a
   * notification for a name no longer in it.
   */
  it("stops naming someone once their name is broken up", () => {
    expect(extractMentionedIds("chào @A nhé", CANDIDATES)).toEqual([]);
  });

  it("does not count an @ inside a word", () => {
    expect(extractMentionedIds("gửi tới an@example.com", CANDIDATES)).toEqual([]);
  });

  it("records nothing in a message that names nobody", () => {
    expect(extractMentionedIds("không nhắc ai cả", CANDIDATES)).toEqual([]);
  });
});

describe("rendering a message with mentions", () => {
  const nameOf = (id: string): string =>
    id === AN ? "An" : id === MINH ? "Nguyễn Văn Minh" : "";

  it("leaves a message with no mentions in one piece", () => {
    const parts = splitMentions("chỉ là tin nhắn", [], nameOf, ME);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.mentionedUserId).toBeNull();
  });

  it("splits the named part away from the words around it", () => {
    const parts = splitMentions("chào @An nhé", [AN], nameOf, ME);
    expect(parts.map((part) => part.text)).toEqual(["chào ", "@An", " nhé"]);
    expect(parts[1]?.mentionedUserId).toBe(AN);
  });

  /** Being named yourself is the one case worth making unmissable. */
  it("marks the run where the reader themselves was named", () => {
    const parts = splitMentions("chào @An", [AN], nameOf, AN);
    expect(parts.find((part) => part.mentionedUserId === AN)?.isViewer).toBe(true);
    const otherReader = splitMentions("chào @An", [AN], nameOf, ME);
    expect(otherReader.find((part) => part.mentionedUserId === AN)?.isViewer).toBe(false);
  });

  /**
   * Driven by the stored ids, not by scanning for "@" — so writing "@nobody" cannot fake the
   * appearance of having named someone.
   */
  it("never lights up a name that was not recorded as a mention", () => {
    const parts = splitMentions("chào @An nhé", [], nameOf, ME);
    expect(parts.every((part) => part.mentionedUserId === null)).toBe(true);
  });

  it("handles several mentions in one message", () => {
    const parts = splitMentions("@An và @Nguyễn Văn Minh", [AN, MINH], nameOf, ME);
    const named = parts.filter((part) => part.mentionedUserId !== null);
    expect(named).toHaveLength(2);
  });
});

describe("was the reader named", () => {
  it("answers the question the mute rules will ask", () => {
    expect(mentionsViewer([AN, MINH], AN)).toBe(true);
    expect(mentionsViewer([MINH], AN)).toBe(false);
  });

  it("treats an empty or missing list as nobody named", () => {
    expect(mentionsViewer([], AN)).toBe(false);
    expect(mentionsViewer(null, AN)).toBe(false);
    expect(mentionsViewer(undefined, AN)).toBe(false);
  });

  it("is false when nobody is signed in", () => {
    expect(mentionsViewer([AN], undefined)).toBe(false);
  });
});
