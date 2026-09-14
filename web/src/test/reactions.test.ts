import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  describeReactors,
  groupReactions,
  hasReacted,
  MORE_REACTIONS,
  QUICK_REACTIONS,
  type MessageReaction,
} from "@/lib/reactions";
import { typingText, TYPING_TTL_MS } from "@/lib/use-thread-presence";

const ME = "u-me";
const THEM = "u-them";
const THIRD = "u-third";
const MSG = "m1";

function reaction(overrides: Partial<MessageReaction> = {}): MessageReaction {
  return { messageId: MSG, userId: ME, emoji: "❤️", ...overrides };
}

describe("one person, several feelings", () => {
  /**
   * The rule the table's primary key encodes: something can be both funny and sad, so one
   * person may leave different emoji — but never the same one twice.
   */
  it("lets one person hold two different reactions on the same message", () => {
    const rows = [reaction({ emoji: "❤️" }), reaction({ emoji: "😂" })];
    const groups = groupReactions(rows, MSG, ME);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.count === 1)).toBe(true);
    expect(groups.every((group) => group.mine)).toBe(true);
  });

  it("counts each distinct emoji separately, naming everyone who left it", () => {
    const rows = [
      reaction({ userId: ME, emoji: "❤️" }),
      reaction({ userId: THEM, emoji: "❤️" }),
      reaction({ userId: THEM, emoji: "😂" }),
    ];
    const groups = groupReactions(rows, MSG, ME);
    const hearts = groups.find((group) => group.emoji === "❤️");
    expect(hearts?.count).toBe(2);
    expect(hearts?.userIds).toContain(ME);
    expect(hearts?.userIds).toContain(THEM);
    expect(groups.find((group) => group.emoji === "😂")?.count).toBe(1);
  });
});

describe("whose reactions are shown", () => {
  it("ignores reactions belonging to other messages", () => {
    const rows = [reaction({ messageId: "other", emoji: "🔥" }), reaction({ emoji: "❤️" })];
    const groups = groupReactions(rows, MSG, ME);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.emoji).toBe("❤️");
  });

  /** `mine` is what makes a chip a toggle rather than a counter. */
  it("marks which chips the viewer is part of", () => {
    const rows = [reaction({ userId: THEM, emoji: "❤️" }), reaction({ userId: ME, emoji: "😂" })];
    const groups = groupReactions(rows, MSG, ME);
    expect(groups.find((group) => group.emoji === "❤️")?.mine).toBe(false);
    expect(groups.find((group) => group.emoji === "😂")?.mine).toBe(true);
  });

  it("marks nothing as mine when nobody is signed in", () => {
    const groups = groupReactions([reaction()], MSG, undefined);
    expect(groups[0]?.mine).toBe(false);
  });
});

describe("chip order", () => {
  it("puts the most-used reaction first", () => {
    const rows = [
      reaction({ userId: ME, emoji: "😂" }),
      reaction({ userId: THEM, emoji: "❤️" }),
      reaction({ userId: THIRD, emoji: "❤️" }),
    ];
    expect(groupReactions(rows, MSG, ME).map((group) => group.emoji)).toEqual(["❤️", "😂"]);
  });

  /**
   * Ties have to settle deterministically: a row of chips that reshuffles between renders is
   * unreadable, so equal counts fall back to the fixed order of the quick bar.
   */
  it("settles ties by the quick bar's own order, so chips never reshuffle", () => {
    const rows = [reaction({ userId: ME, emoji: "😂" }), reaction({ userId: THEM, emoji: "❤️" })];
    const first = groupReactions(rows, MSG, ME).map((group) => group.emoji);
    const second = groupReactions([...rows].reverse(), MSG, ME).map((group) => group.emoji);
    expect(first).toEqual(second);
    // ❤️ sits before 😂 in QUICK_REACTIONS, so it leads on a tie.
    expect(first[0]).toBe("❤️");
  });
});

describe("hasReacted", () => {
  const rows = [reaction({ userId: ME, emoji: "❤️" }), reaction({ userId: THEM, emoji: "😂" })];

  it("knows which reaction the viewer already left", () => {
    expect(hasReacted(rows, MSG, ME, "❤️")).toBe(true);
    expect(hasReacted(rows, MSG, ME, "😂")).toBe(false);
  });

  it("never mistakes someone else's reaction for the viewer's", () => {
    expect(hasReacted(rows, MSG, THEM, "❤️")).toBe(false);
    expect(hasReacted(rows, MSG, THEM, "😂")).toBe(true);
  });

  it("is false when nobody is signed in", () => {
    expect(hasReacted(rows, MSG, undefined, "❤️")).toBe(false);
  });
});

describe("naming who reacted", () => {
  const nameOf = (id: string): string => (id === THEM ? "Người kia" : "Người thứ ba");

  it("calls the viewer 'Bạn' rather than by name", () => {
    const group = { emoji: "❤️", count: 2, mine: true, userIds: [ME, THEM] };
    expect(describeReactors(group, nameOf, ME)).toBe("Bạn, Người kia");
  });

  it("stops naming people past three and counts the rest", () => {
    const group = {
      emoji: "❤️",
      count: 5,
      mine: false,
      userIds: [THEM, THIRD, "u-4", "u-5", "u-6"],
    };
    expect(describeReactors(group, nameOf, ME)).toContain("và 2 người khác");
  });
});

describe("the quick bar", () => {
  /**
   * Deliberately not all positive. Sadness, sympathy and surprise belong in a real
   * conversation as much as approval — a set that can only agree turns every reaction into
   * applause, and people stop using it to say anything true.
   */
  it("offers eight feelings, including ones that are not agreement", () => {
    expect(QUICK_REACTIONS).toHaveLength(8);
    const emojis = QUICK_REACTIONS.map((entry) => entry.emoji);
    expect(emojis).toContain("😢");
    expect(emojis).toContain("😮");
    expect(emojis).toContain("🙏");
  });

  it("gives every quick reaction a Vietnamese label for its tooltip", () => {
    expect(QUICK_REACTIONS.every((entry) => entry.label.trim().length > 0)).toBe(true);
  });

  it("keeps the fuller set free of duplicates of itself", () => {
    expect(new Set(MORE_REACTIONS).size).toBe(MORE_REACTIONS.length);
  });
});

describe("the typing line", () => {
  const nameOf = (id: string): string =>
    id === THEM ? "Người kia" : id === THIRD ? "Người thứ ba" : "Ai đó";

  it("says nothing when nobody is typing", () => {
    expect(typingText([], nameOf)).toBeNull();
  });

  it("names one person", () => {
    expect(typingText([THEM], nameOf)).toBe("Người kia đang nhập…");
  });

  it("names two", () => {
    expect(typingText([THEM, THIRD], nameOf)).toBe("Người kia và Người thứ ba đang nhập…");
  });

  /** Past two, names stop being information and become noise. */
  it("counts rather than lists once there are three or more", () => {
    expect(typingText([THEM, THIRD, "u-4"], nameOf)).toBe("3 người đang nhập…");
  });

  /**
   * A signal has to be able to expire on its own. Someone who starts typing and then shuts
   * their laptop must not appear to be typing forever.
   */
  it("believes a signal for a few seconds, not indefinitely", () => {
    expect(TYPING_TTL_MS).toBeGreaterThan(0);
    expect(TYPING_TTL_MS).toBeLessThanOrEqual(10_000);
  });
});
