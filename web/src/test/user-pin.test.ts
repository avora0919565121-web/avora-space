import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { returnPathFrom } from "@/lib/navigation";
import generated200 from "./fixtures/pin-generated-200.json";
import samples from "./fixtures/pin-samples.json";
import { mulberry32, PIN_SEED, PIN_SEEDED_COUNT } from "./pin-seeded";
import {
  fail,
  generatePinBody,
  PIN_DIGITS,
  PIN_LETTERS,
  pinBody,
  pinDaysLeft,
  pinErrorCode,
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
    expect(pinProblem("ABCD0EFG")).toBe("confusing");
    expect(pinProblem("ABCDIEFG")).toBe("confusing");
  });

  it("keeps the upper-case L (VMT 12/10)", () => {
    expect(PIN_LETTERS).toHaveLength(24);
    expect(PIN_LETTERS).toContain("L");
    expect(PIN_DIGITS).toBe("23456789");
    for (const char of "01OI") expect(PIN_LETTERS + PIN_DIGITS).not.toContain(char);
    expect(pinProblem("ABCLEFGH")).toBeNull();
    expect(pinProblem("LMNPQ23L")).toBeNull();
  });

  it("turns typed lower case into upper case: l becomes L, o and i are still refused", () => {
    expect(pinProblem(pinBody("a-lmnpq23l"))).toBeNull();
    expect(pinProblem(pinBody("a-abcdefgo"))).toBe("confusing");
    expect(pinProblem(pinBody("a-abcdiefg"))).toBe("confusing");
  });

  it("matches private.user_pin_problem on the shared samples (supabase/tests/pin_alphabet.sql)", () => {
    for (const [body, expected] of samples as [string, string | null][]) {
      expect([body, pinProblem(body)]).toEqual([body, expected]);
    }
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
      expect(body).not.toMatch(/[01OI]/);
    }
  });
});

// The table constraint `user_pins_format` mirrors the same alphabet; AVORA-113 was that copy lagging behind.
const TABLE_FORMAT = /^A-[ABCDEFGHJKLMNPQRSTUVWXYZ][ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{6}[ABCDEFGHJKLMNPQRSTUVWXYZ]$/;

describe("AVORA-113 · PIN that the app accepts is one the table accepts", () => {
  it("the 200 seeded PINs in the SQL test are exactly what the app's generator draws", () => {
    const random = mulberry32(PIN_SEED);
    const drawn = Array.from({ length: PIN_SEEDED_COUNT }, () => toPin(generatePinBody(random)));
    expect(generated200).toEqual(drawn);
    expect(generated200.filter((pin) => pin.slice(2).includes("L")).length).toBeGreaterThan(20);
  });

  it("every body pinProblem accepts also matches the table constraint", () => {
    for (const pin of generated200) expect(pin).toMatch(TABLE_FORMAT);
    for (const [body, expected] of samples as [string, string | null][]) {
      if (expected === null) expect(toPin(body)).toMatch(TABLE_FORMAT);
    }
    for (const body of ["LBCDEFGH", "ABCLEFGH", "ABCDEFGL"]) {
      expect(pinProblem(body)).toBeNull();
      expect(toPin(body)).toMatch(TABLE_FORMAT);
    }
  });

  it("an unknown database refusal says which one, in a short code", () => {
    const message = 'new row for relation "user_pins" violates check constraint "user_pins_format"';
    expect(pinErrorCode("23514", message)).toBe("P-23514-FORMAT");
    expect(fail("23514", message).message).toBe("Không lưu được PIN (mã P-23514-FORMAT). Thử PIN khác hoặc báo cho Avora.");
    expect(fail("XX000", "boom").message).toBe("Không lưu được PIN (mã P-XX000). Thử PIN khác hoặc báo cho Avora.");
    expect(fail(undefined, "boom").message).toContain("(mã P-X)");
    expect(fail("P0001", "avora_pin_taken").message).toBe("PIN này đã có người dùng. Thử một biến thể khác nhé.");
  });

  it("logs the code and the constraint, never the message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fail("23514", 'new row for relation "user_pins" violates check constraint "user_pins_format" A-LBCDEFGH');
    expect(spy).toHaveBeenCalledWith("[user-pin] 23514.user_pins_format");
    spy.mockRestore();
  });
});
