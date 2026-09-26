import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { generatePinBody, PIN_LETTERS, pinBody, pinProblem, toPin } from "@/lib/user-pin";

describe("PIN format (AVORA 32)", () => {
  it("accepts a body that meets every rule", () => {
    expect(pinProblem("MNPQ23RS")).toBeNull();
    expect(pinProblem("MNPQ23R")).toBe("format");
    expect(pinProblem("MINHNAM8")).toBe("confusing");
  });

  it("refuses confusable characters", () => {
    expect(pinProblem("ABCDEFGO")).toBe("confusing");
    expect(pinProblem("ABCDEF1H")).toBe("confusing");
    expect(pinProblem("ABCLEFGH")).toBe("confusing");
  });

  it("needs letters at both ends and at least four letters", () => {
    expect(pinProblem("2BCDEFGH")).toBe("edges");
    expect(pinProblem("ABCDEFG2")).toBe("edges");
    expect(pinProblem("A234567B")).toBe("letters");
    expect(pinProblem("AB23456C")).toBe("letters");
    expect(pinProblem("ABC2345D")).toBeNull();
  });

  it("filters offensive words and brand names", () => {
    expect(pinProblem("GRABXYZW")).toBe("blocked");
    expect(pinProblem("ASEXABCD")).toBe("blocked");
  });

  it("reads what was typed, with or without the prefix", () => {
    expect(pinBody("a-mnpq23rs")).toBe("MNPQ23RS");
    expect(pinBody("mnpq 23rs")).toBe("MNPQ23RS");
    expect(toPin("MNPQ23RS")).toBe("A-MNPQ23RS");
  });
});

describe("the generator meets the same rules", () => {
  it("always produces a valid body", () => {
    for (let run = 0; run < 2000; run += 1) {
      const body = generatePinBody();
      expect(pinProblem(body)).toBeNull();
      expect(PIN_LETTERS.includes(body[0])).toBe(true);
      expect(PIN_LETTERS.includes(body[7])).toBe(true);
    }
  });
});
