import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the modules pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  burstsFor,
  CELEBRATION_FRESH_DAYS,
  hasMilestone,
  isCelebrationFresh,
  MAX_BURSTS,
  type PendingCelebration,
} from "@/lib/task-celebrations";
import { burstCount, MAX_CELEBRATION_BURSTS, MILESTONE_BURSTS } from "@/lib/confetti";
import {
  emojiBounceClass,
  EMOJI_BOUNCE_CLASS,
  EMOJI_BOUNCE_MS,
  isBouncing,
} from "@/lib/emoji-bounce";

const NOW = new Date("2026-09-15T10:00:00Z");

function pending(overrides: Partial<PendingCelebration> = {}): PendingCelebration {
  return {
    taskId: `t-${Math.random().toString(36).slice(2)}`,
    conversationId: "c-1",
    burstCount: 1,
    triggeredAt: "2026-09-15T09:00:00Z",
    ...overrides,
  };
}

describe("a milestone is applause, not a bigger pop", () => {
  it("fires several waves, and ordinary work fires one", () => {
    expect(MILESTONE_BURSTS).toBeGreaterThanOrEqual(3);
    expect(MILESTONE_BURSTS).toBeLessThanOrEqual(5);
    expect(burstCount(1)).toBe(1);
  });

  it("never plays more waves than the screen can carry", () => {
    expect(burstCount(99)).toBe(MAX_CELEBRATION_BURSTS);
    expect(MAX_CELEBRATION_BURSTS).toBe(5);
  });

  it("treats a nonsensical request as a single wave rather than throwing", () => {
    expect(burstCount(0)).toBe(1);
    expect(burstCount(-4)).toBe(1);
    expect(burstCount(Number.NaN)).toBe(1);
  });
});

describe("what a returning person is owed", () => {
  it("plays one wave for one ordinary task", () => {
    expect(burstsFor([pending({ burstCount: 1 })])).toBe(1);
  });

  it("plays the milestone's full applause when a milestone is waiting", () => {
    expect(burstsFor([pending({ burstCount: 3 })])).toBe(3);
    expect(hasMilestone([pending({ burstCount: 3 })])).toBe(true);
    expect(hasMilestone([pending({ burstCount: 1 })])).toBe(false);
  });

  it("gives a week of finished work one generous celebration, not forty", () => {
    const week = Array.from({ length: 12 }, () => pending({ burstCount: 1 }));
    expect(burstsFor(week)).toBe(MAX_BURSTS);
  });

  it("never drops below the strongest single celebration waiting", () => {
    const mixed = [pending({ burstCount: 3 }), pending({ burstCount: 1 })];
    expect(burstsFor(mixed)).toBeGreaterThanOrEqual(3);
    expect(burstsFor(mixed)).toBeLessThanOrEqual(MAX_BURSTS);
  });

  it("celebrates nothing when nothing is waiting", () => {
    expect(burstsFor([])).toBe(0);
    expect(hasMilestone([])).toBe(false);
  });
});

describe("a celebration has a shelf life", () => {
  it("still plays for work finished while this person was away", () => {
    expect(isCelebrationFresh("2026-09-14T22:00:00Z", NOW)).toBe(true);
    expect(isCelebrationFresh("2026-09-09T10:00:00Z", NOW)).toBe(true);
  });

  it("stops playing confetti for something finished long ago", () => {
    expect(isCelebrationFresh("2026-08-01T10:00:00Z", NOW)).toBe(false);
    expect(CELEBRATION_FRESH_DAYS).toBeLessThanOrEqual(14);
  });

  it("refuses a timestamp from the future and unparseable input, rather than guessing", () => {
    expect(isCelebrationFresh("2026-09-20T10:00:00Z", NOW)).toBe(false);
    expect(isCelebrationFresh("not a date", NOW)).toBe(false);
  });
});

describe("the press of a feeling", () => {
  it("bounces whichever emoji was pressed — the heart is not special", () => {
    for (const emoji of ["❤️", "😢", "🙏", "🤝", "😮"]) {
      expect(emojiBounceClass(emoji, emoji)).toBe(EMOJI_BOUNCE_CLASS);
    }
  });

  it("bounces one at a time, so which one took the tap stays unambiguous", () => {
    expect(isBouncing("😂", "😂")).toBe(true);
    expect(isBouncing("😂", "❤️")).toBe(false);
    expect(isBouncing(null, "❤️")).toBe(false);
  });

  it("keeps the resting emoji transformable, since transforms do nothing on inline text", () => {
    expect(emojiBounceClass(null, "❤️")).toContain("inline-block");
    expect(EMOJI_BOUNCE_CLASS).toContain("inline-block");
  });

  it("stands down when the reader has asked for calmer motion", () => {
    expect(EMOJI_BOUNCE_CLASS).toContain("motion-reduce:animate-none");
  });

  it("is short enough that nobody waits on it", () => {
    expect(EMOJI_BOUNCE_MS).toBeGreaterThanOrEqual(200);
    expect(EMOJI_BOUNCE_MS).toBeLessThanOrEqual(300);
  });
});
