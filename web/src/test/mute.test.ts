import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  allowsCustomDuration,
  describeMuteDecision,
  endOfLocalDay,
  isMuteActive,
  isScopeMuted,
  MAX_CUSTOM_MUTE_HOURS,
  muteDurationOptions,
  mutedUntilFor,
  MUTE_SCOPE_LABELS,
  parseCustomHours,
  QUICK_MUTE_DURATIONS,
  remainingMuteLabel,
  shouldBlockNotification,
  toMuteIndex,
  type MuteIndex,
  type MuteScope,
  type MuteSetting,
  type NotificationEvent,
} from "@/lib/mute";

const NOW = new Date("2026-09-14T12:00:00Z");
const LATER = new Date("2026-09-14T16:00:00Z").toISOString();
const EARLIER = new Date("2026-09-14T08:00:00Z").toISOString();

/** A mute index built straight from scopes, so each test states only what it is about. */
function muting(...scopes: MuteScope[]): MuteIndex {
  return toMuteIndex(
    scopes.map((scope) => ({ scope, mutedUntil: LATER })),
    NOW,
  );
}

function event(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return { surface: "group", isFromFamily: false, mentionsRecipient: false, ...overrides };
}

describe("a mute has to be in force to count", () => {
  it("ignores one whose time has run out", () => {
    const expired: MuteSetting = { scope: "group", mutedUntil: EARLIER };
    const live: MuteSetting = { scope: "group", mutedUntil: LATER };
    expect(isMuteActive(expired, NOW)).toBe(false);
    expect(isMuteActive(live, NOW)).toBe(true);
  });

  /**
   * The whole point of storing a moment rather than a flag: silence lapses on its own, so
   * nobody has to remember to come back and undo it.
   */
  it("drops expired layers when building the index", () => {
    const index = toMuteIndex(
      [
        { scope: "avora", mutedUntil: EARLIER },
        { scope: "group", mutedUntil: LATER },
      ],
      NOW,
    );
    expect(isScopeMuted(index, "avora", NOW)).toBe(false);
    expect(isScopeMuted(index, "group", NOW)).toBe(true);
  });
});

describe("nothing muted", () => {
  it("lets everything through", () => {
    const decision = shouldBlockNotification(muting(), event(), NOW);
    expect(decision.blocked).toBe(false);
    expect(decision.decidedBy).toBeNull();
  });
});

describe("muting the whole app is absolute", () => {
  /**
   * The rule with no exceptions. Someone who silences AVORA has said "not now" about
   * everything, and an app that decided some of its own notifications were too important to
   * obey that would make the switch untrustworthy — so nobody would use it.
   */
  it("blocks even a message from family", () => {
    const decision = shouldBlockNotification(muting("avora"), event({ isFromFamily: true }), NOW);
    expect(decision.blocked).toBe(true);
    expect(decision.decidedBy).toBe("avora");
    expect(decision.exception).toBeNull();
  });

  it("blocks even a message that names the recipient", () => {
    const decision = shouldBlockNotification(
      muting("avora"),
      event({ mentionsRecipient: true }),
      NOW,
    );
    expect(decision.blocked).toBe(true);
    expect(decision.decidedBy).toBe("avora");
  });

  it("blocks family AND a mention together", () => {
    const decision = shouldBlockNotification(
      muting("avora"),
      event({ isFromFamily: true, mentionsRecipient: true }),
      NOW,
    );
    expect(decision.blocked).toBe(true);
  });

  it("overrides every layer below it, on every surface", () => {
    for (const surface of ["direct", "group", "project"] as const) {
      const decision = shouldBlockNotification(muting("avora"), event({ surface }), NOW);
      expect(decision.decidedBy).toBe("avora");
    }
  });
});

describe("muting all messages", () => {
  it("blocks an ordinary message", () => {
    const decision = shouldBlockNotification(muting("messages"), event(), NOW);
    expect(decision.blocked).toBe(true);
    expect(decision.decidedBy).toBe("messages");
  });

  /** The people you carry lasting responsibility for are exactly who this must not cut off. */
  it("still lets family through", () => {
    const decision = shouldBlockNotification(
      muting("messages"),
      event({ isFromFamily: true }),
      NOW,
    );
    expect(decision.blocked).toBe(false);
    expect(decision.exception).toBe("family");
  });

  /** Being named is a group-level exception; it does not reach up to the Tin nhắn layer. */
  it("does not let a mere mention through", () => {
    const decision = shouldBlockNotification(
      muting("messages"),
      event({ mentionsRecipient: true }),
      NOW,
    );
    expect(decision.blocked).toBe(true);
    expect(decision.decidedBy).toBe("messages");
  });

  it("applies to every surface, not just groups", () => {
    for (const surface of ["direct", "group", "project"] as const) {
      expect(shouldBlockNotification(muting("messages"), event({ surface }), NOW).blocked).toBe(
        true,
      );
    }
  });
});

describe("muting one tab", () => {
  it("blocks a message from that tab and no other", () => {
    const index = muting("group");
    expect(shouldBlockNotification(index, event({ surface: "group" }), NOW).blocked).toBe(true);
    expect(shouldBlockNotification(index, event({ surface: "direct" }), NOW).blocked).toBe(false);
    expect(shouldBlockNotification(index, event({ surface: "project" }), NOW).blocked).toBe(false);
  });

  /** ACCEPTANCE: group muted, but the sender is family → still notified. */
  it("lets family through a muted group", () => {
    const decision = shouldBlockNotification(
      muting("group"),
      event({ surface: "group", isFromFamily: true }),
      NOW,
    );
    expect(decision.blocked).toBe(false);
    expect(decision.exception).toBe("family");
  });

  /**
   * ACCEPTANCE: group muted, sender is not family, but the recipient was named → still
   * notified. A mention is someone asking you specifically, which is a different thing from
   * the room being busy.
   */
  it("lets a mention through a muted group", () => {
    const decision = shouldBlockNotification(
      muting("group"),
      event({ surface: "group", isFromFamily: false, mentionsRecipient: true }),
      NOW,
    );
    expect(decision.blocked).toBe(false);
    expect(decision.exception).toBe("mention");
  });

  /** ACCEPTANCE: group muted, not family, not named → not notified. */
  it("blocks an ordinary group message", () => {
    const decision = shouldBlockNotification(
      muting("group"),
      event({ surface: "group", isFromFamily: false, mentionsRecipient: false }),
      NOW,
    );
    expect(decision.blocked).toBe(true);
    expect(decision.decidedBy).toBe("group");
    expect(decision.exception).toBeNull();
  });

  /**
   * The mention exception belongs to rooms, where a conversation can be busy around you. In a
   * 1-1 every message is already addressed to you, so "@" would exempt everything and the
   * mute would mean nothing.
   */
  it("does not apply the mention exception to a 1-1", () => {
    const decision = shouldBlockNotification(
      muting("direct"),
      event({ surface: "direct", mentionsRecipient: true }),
      NOW,
    );
    expect(decision.blocked).toBe(true);
    expect(decision.decidedBy).toBe("direct");
  });

  it("does not apply the mention exception to a project", () => {
    const decision = shouldBlockNotification(
      muting("project"),
      event({ surface: "project", mentionsRecipient: true }),
      NOW,
    );
    expect(decision.blocked).toBe(true);
  });

  it("still lets family through a muted 1-1 or project", () => {
    expect(
      shouldBlockNotification(
        muting("direct"),
        event({ surface: "direct", isFromFamily: true }),
        NOW,
      ).blocked,
    ).toBe(false);
    expect(
      shouldBlockNotification(
        muting("project"),
        event({ surface: "project", isFromFamily: true }),
        NOW,
      ).blocked,
    ).toBe(false);
  });
});

describe("layers stacked together", () => {
  /** Family is the broader exception, so in a group where both apply it is the reason given. */
  it("credits family over a mention when both would save the message", () => {
    const decision = shouldBlockNotification(
      muting("group"),
      event({ surface: "group", isFromFamily: true, mentionsRecipient: true }),
      NOW,
    );
    expect(decision.blocked).toBe(false);
    expect(decision.exception).toBe("family");
  });

  it("reads the outer layer first when both Tin nhắn and a tab are muted", () => {
    const decision = shouldBlockNotification(
      muting("messages", "group"),
      event({ surface: "group" }),
      NOW,
    );
    expect(decision.decidedBy).toBe("messages");
  });

  /** Family clears Tin nhắn, then has to clear the tab as well — and does. */
  it("lets family through both the message layer and the tab layer", () => {
    const decision = shouldBlockNotification(
      muting("messages", "group"),
      event({ surface: "group", isFromFamily: true }),
      NOW,
    );
    expect(decision.blocked).toBe(false);
  });

  /**
   * A mention cannot clear Tin nhắn, so it never gets as far as the tab exception that would
   * have saved it. The outer layer is the one that decides.
   */
  it("stops a mention at the message layer even though the tab would have allowed it", () => {
    const decision = shouldBlockNotification(
      muting("messages", "group"),
      event({ surface: "group", mentionsRecipient: true }),
      NOW,
    );
    expect(decision.blocked).toBe(true);
    expect(decision.decidedBy).toBe("messages");
  });
});

describe("how long a layer may be silenced", () => {
  /**
   * The asymmetry is deliberate. Quieting the whole app is a decision about your own day;
   * quieting one group is a decision about the people in it, who are left believing their
   * messages arrive. So the per-tab layers get four fixed answers and no free-text box.
   */
  it("allows a typed number of hours only on the two upper layers", () => {
    expect(allowsCustomDuration("avora")).toBe(true);
    expect(allowsCustomDuration("messages")).toBe(true);
    expect(allowsCustomDuration("direct")).toBe(false);
    expect(allowsCustomDuration("group")).toBe(false);
    expect(allowsCustomDuration("project")).toBe(false);
  });

  it("offers a tab exactly four choices, the longest ending today", () => {
    for (const scope of ["direct", "group", "project"] as const) {
      const options = muteDurationOptions(scope);
      expect(options).toHaveLength(4);
      expect(options.map((option) => option.label)).toEqual(["1 giờ", "4 giờ", "8 giờ", "Cả ngày"]);
    }
  });

  it("offers the upper layers the three quick answers, without an end-of-day option", () => {
    for (const scope of ["avora", "messages"] as const) {
      const options = muteDurationOptions(scope);
      expect(options).toHaveLength(3);
      expect(options.map((option) => option.id)).toEqual(["1h", "4h", "8h"]);
    }
  });

  it("ships 1, 4 and 8 hours as the quick answers everywhere", () => {
    expect(QUICK_MUTE_DURATIONS.map((option) => option.hours)).toEqual([1, 4, 8]);
  });
});

describe("working out when silence ends", () => {
  it("adds the chosen hours to now", () => {
    const until = mutedUntilFor({ id: "4h", label: "4 giờ", hours: 4 }, NOW);
    expect(until.getTime() - NOW.getTime()).toBe(4 * 60 * 60 * 1000);
  });

  /** "Cả ngày" means the end of the reader's own day, in their own timezone. */
  it("takes the end-of-day option to local midnight, not a fixed offset", () => {
    const until = mutedUntilFor({ id: "today", label: "Cả ngày", hours: null }, NOW);
    expect(until.getHours()).toBe(23);
    expect(until.getMinutes()).toBe(59);
    expect(until.getTime()).toBe(endOfLocalDay(NOW).getTime());
  });

  it("never returns a moment already in the past", () => {
    for (const option of muteDurationOptions("group")) {
      expect(mutedUntilFor(option, NOW).getTime()).toBeGreaterThan(NOW.getTime());
    }
  });
});

describe("the custom hours box", () => {
  it("rejects anything that is not a usable number of hours", () => {
    expect(parseCustomHours("")).toBeNull();
    expect(parseCustomHours("  ")).toBeNull();
    expect(parseCustomHours("abc")).toBeNull();
    expect(parseCustomHours("0")).toBeNull();
    expect(parseCustomHours("-3")).toBeNull();
  });

  it("accepts a plain number of hours", () => {
    expect(parseCustomHours("12")).toBe(12);
  });

  /** Even the free-text box has a ceiling: past a week it is a decision worth re-making. */
  it("caps a very long request rather than honouring it", () => {
    expect(parseCustomHours("100000")).toBe(MAX_CUSTOM_MUTE_HOURS);
    expect(MAX_CUSTOM_MUTE_HOURS).toBe(168);
  });
});

describe("saying how much silence is left", () => {
  it("counts in minutes under an hour and hours above it", () => {
    expect(remainingMuteLabel(new Date(NOW.getTime() + 20 * 60_000).toISOString(), NOW)).toContain(
      "phút",
    );
    expect(remainingMuteLabel(new Date(NOW.getTime() + 3 * 3_600_000).toISOString(), NOW)).toContain(
      "giờ",
    );
    expect(remainingMuteLabel(new Date(NOW.getTime() + 50 * 3_600_000).toISOString(), NOW)).toContain(
      "ngày",
    );
  });

  it("says plainly when a mute has already lapsed", () => {
    expect(remainingMuteLabel(EARLIER, NOW)).toBe("đã hết");
  });
});

describe("explaining a decision", () => {
  it("names the exception that let a message through", () => {
    expect(
      describeMuteDecision({ blocked: false, decidedBy: "group", exception: "family" }),
    ).toContain("Gia đình");
    expect(
      describeMuteDecision({ blocked: false, decidedBy: "group", exception: "mention" }),
    ).toContain("nhắc tên");
  });

  it("says out loud that the top layer has no exceptions", () => {
    expect(describeMuteDecision({ blocked: true, decidedBy: "avora", exception: null })).toContain(
      "không có ngoại lệ",
    );
  });
});

describe("there is no mute for Tasks", () => {
  /**
   * A task is a promise someone is waiting on. Letting it be silenced would let a person opt
   * out of being asked while the other side still believes the request landed — so no scope
   * for it exists anywhere, and the database refuses the value outright.
   */
  it("offers no task scope among the layers", () => {
    const scopes = Object.keys(MUTE_SCOPE_LABELS);
    expect(scopes).toEqual(["avora", "messages", "direct", "group", "project"]);
    expect(scopes).not.toContain("task");
  });

  it("has no surface a task event could even be filed under", () => {
    const surfaces: NotificationEvent["surface"][] = ["direct", "group", "project"];
    expect(surfaces).not.toContain("task" as never);
  });
});
