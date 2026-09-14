import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  canPinForGroup,
  isQuotaFull,
  orderedPins,
  pinChoicesFor,
  pinFor,
  pinScopeLabel,
  PIN_LIMIT,
  usedPins,
  type MessagePin,
} from "@/lib/pins";

const OWNER = "u-owner";
const ADMIN = "u-admin";
const MEMBER = "u-member";
const OTHER = "u-other";
const CONV = "c-1";

function pin(overrides: Partial<MessagePin> = {}): MessagePin {
  return {
    id: `pin-${Math.random().toString(36).slice(2)}`,
    messageId: "m1",
    conversationId: CONV,
    pinnedBy: OWNER,
    scope: "group",
    pinnedAt: "2026-09-14T10:00:00Z",
    ...overrides,
  };
}

describe("who may pin for the room", () => {
  /** A shared pin speaks for the room, so it belongs to the seats that answer for it. */
  it("allows the seats that answer for the group, and nobody else", () => {
    expect(canPinForGroup("owner")).toBe(true);
    expect(canPinForGroup("admin")).toBe(true);
    expect(canPinForGroup("member")).toBe(false);
    expect(canPinForGroup(undefined)).toBe(false);
  });

  /**
   * An officer is offered both, and asked which they mean. Assuming "group" would publish a
   * private bookmark to the whole room, which is the wrong default in the more damaging
   * direction.
   */
  it("offers an officer both audiences in a group", () => {
    expect(pinChoicesFor("owner", true)).toEqual(["group", "personal"]);
    expect(pinChoicesFor("admin", true)).toEqual(["group", "personal"]);
  });

  it("leaves an ordinary member only their own shelf", () => {
    expect(pinChoicesFor("member", true)).toEqual(["personal"]);
  });

  /** A 1-1 and a journal have no room to speak for, so every pin there is personal. */
  it("offers only a personal pin outside a group", () => {
    expect(pinChoicesFor("owner", false)).toEqual(["personal"]);
    expect(pinChoicesFor(undefined, false)).toEqual(["personal"]);
  });
});

describe("the shared allowance", () => {
  /**
   * The rule the trigger encodes: group pins count against ONE number for the whole room,
   * whoever added them. Three pins by three different admins is still three pins on the wall.
   */
  it("counts every officer's group pins against the same number", () => {
    const pins = [
      pin({ pinnedBy: OWNER, messageId: "m1" }),
      pin({ pinnedBy: OWNER, messageId: "m2" }),
      pin({ pinnedBy: ADMIN, messageId: "m3" }),
    ];
    expect(usedPins(pins, "group", OWNER)).toBe(3);
    // The same total from the other officer's point of view — it is not per person.
    expect(usedPins(pins, "group", ADMIN)).toBe(3);
    expect(isQuotaFull(pins, "group", OWNER)).toBe(true);
    expect(isQuotaFull(pins, "group", ADMIN)).toBe(true);
  });

  it("is not full below the limit", () => {
    const pins = [pin({ messageId: "m1" }), pin({ messageId: "m2" })];
    expect(usedPins(pins, "group", OWNER)).toBe(2);
    expect(isQuotaFull(pins, "group", OWNER)).toBe(false);
  });

  it("ships with three slots", () => {
    expect(PIN_LIMIT).toBe(3);
  });
});

describe("the personal allowance", () => {
  const pins = [
    pin({ scope: "personal", pinnedBy: MEMBER, messageId: "m1" }),
    pin({ scope: "personal", pinnedBy: MEMBER, messageId: "m2" }),
    pin({ scope: "personal", pinnedBy: MEMBER, messageId: "m3" }),
    pin({ scope: "personal", pinnedBy: OTHER, messageId: "m4" }),
  ];

  /** One person filling their own shelf must leave everyone else's untouched. */
  it("counts each person's own pins separately", () => {
    expect(usedPins(pins, "personal", MEMBER)).toBe(3);
    expect(usedPins(pins, "personal", OTHER)).toBe(1);
    expect(isQuotaFull(pins, "personal", MEMBER)).toBe(true);
    expect(isQuotaFull(pins, "personal", OTHER)).toBe(false);
  });

  /** The two allowances are separate budgets, not one pool of six. */
  it("keeps the shared and personal counts apart", () => {
    const mixed = [
      pin({ scope: "group", messageId: "m1" }),
      pin({ scope: "group", messageId: "m2" }),
      pin({ scope: "group", messageId: "m3" }),
      pin({ scope: "personal", pinnedBy: MEMBER, messageId: "m1" }),
    ];
    expect(isQuotaFull(mixed, "group", MEMBER)).toBe(true);
    // The room's wall being full says nothing about this person's own shelf.
    expect(isQuotaFull(mixed, "personal", MEMBER)).toBe(false);
  });
});

describe("finding the pin on a message", () => {
  const pins = [
    pin({ id: "shared", scope: "group", messageId: "m1", pinnedBy: OWNER }),
    pin({ id: "mine", scope: "personal", messageId: "m1", pinnedBy: MEMBER }),
    pin({ id: "theirs", scope: "personal", messageId: "m1", pinnedBy: OTHER }),
  ];

  it("finds the room's pin for anyone in the room", () => {
    expect(pinFor(pins, "m1", "group", MEMBER)?.id).toBe("shared");
  });

  /** A personal lookup is only ever about the reader, never about someone else's bookmark. */
  it("finds only the reader's own personal pin", () => {
    expect(pinFor(pins, "m1", "personal", MEMBER)?.id).toBe("mine");
    expect(pinFor(pins, "m1", "personal", OTHER)?.id).toBe("theirs");
    expect(pinFor(pins, "m1", "personal", OWNER)).toBeNull();
  });

  it("returns null for a message nobody pinned", () => {
    expect(pinFor(pins, "m-unpinned", "group", MEMBER)).toBeNull();
  });
});

describe("the order of the strip", () => {
  /**
   * Both kinds share one strip: someone hunting for "that thing we pinned" does not remember
   * which shelf they used, and two separate lists would make them check both.
   */
  it("puts the room's pins before personal ones, newest first inside each", () => {
    const pins = [
      pin({ id: "p-old", scope: "personal", pinnedAt: "2026-09-10T10:00:00Z" }),
      pin({ id: "g-old", scope: "group", pinnedAt: "2026-09-11T10:00:00Z" }),
      pin({ id: "p-new", scope: "personal", pinnedAt: "2026-09-13T10:00:00Z" }),
      pin({ id: "g-new", scope: "group", pinnedAt: "2026-09-12T10:00:00Z" }),
    ];
    expect(orderedPins(pins).map((entry) => entry.id)).toEqual([
      "g-new",
      "g-old",
      "p-new",
      "p-old",
    ]);
  });

  it("never mutates the list it was given", () => {
    const pins = [pin({ id: "a", scope: "personal" }), pin({ id: "b", scope: "group" })];
    orderedPins(pins);
    expect(pins.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});

describe("labelling a pin", () => {
  /** A private bookmark must never look like something the room agreed to. */
  it("says plainly whose pin it is", () => {
    expect(pinScopeLabel("group")).toBe("Ghim của nhóm");
    expect(pinScopeLabel("personal")).toBe("Ghim riêng của bạn");
  });
});
