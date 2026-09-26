import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { returnPathFrom } from "@/lib/navigation";
import {
  generatePinBody,
  PIN_LETTERS,
  pinBody,
  pinDaysLeft,
  pinPhase,
  pinProblem,
  toPin,
} from "@/lib/user-pin";

describe("PIN phases (AVORA 33)", () => {
  const now = new Date("2026-09-26T10:00:00Z");

  it("lets anyone with a PIN through", () => {
    expect(pinPhase({ pin: "A-MNPQ23RS", requiredAt: "2026-01-01T00:00:00Z" }, now)).toBe("has-pin");
  });

  it("does not block inside the 30-day window", () => {
    expect(pinPhase({ pin: null, requiredAt: "2026-10-20T00:00:00Z" }, now)).toBe("grace");
    expect(pinPhase({ pin: null, requiredAt: null }, now)).toBe("grace");
  });

  it("blocks once the deadline has passed", () => {
    expect(pinPhase({ pin: null, requiredAt: "2026-09-26T10:00:00Z" }, now)).toBe("overdue");
    expect(pinPhase({ pin: null, requiredAt: "2026-09-01T00:00:00Z" }, now)).toBe("overdue");
  });

  it("counts whole days left, never zero while still open", () => {
    expect(pinDaysLeft("2026-10-26T10:00:00Z", now)).toBe(30);
    expect(pinDaysLeft("2026-09-26T11:00:00Z", now)).toBe(1);
    expect(pinDaysLeft("2026-09-25T00:00:00Z", now)).toBe(0);
    expect(pinDaysLeft(null, now)).toBeNull();
  });
});

describe("return path after sign-in (AVORA 33)", () => {
  it("goes back to the invite that sent the person to sign in", () => {
    expect(returnPathFrom({ from: "/loi-moi/abc" })).toBe("/loi-moi/abc");
    expect(returnPathFrom({ from: "/loi-moi-lien-he/xyz?a=1" })).toBe("/loi-moi-lien-he/xyz?a=1");
  });

  it("falls back to Avora Space for anything else", () => {
    expect(returnPathFrom(null)).toBe("/tong-quan");
    expect(returnPathFrom({ from: "https://evil.example" })).toBe("/tong-quan");
    expect(returnPathFrom({ from: "//evil.example" })).toBe("/tong-quan");
    expect(returnPathFrom({ from: "/dang-nhap" })).toBe("/tong-quan");
  });
});

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
