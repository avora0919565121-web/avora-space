import { describe, expect, it } from "vitest";

import { AUTO_LOCK_OPTIONS, hashCode, idleExpired, idleMinutes, isValidCode, LOCK_TRUTH, lockoutMs, PBKDF2_ITERATIONS, startsLocked } from "@/lib/chat-lock";

describe("AVORA-109 · A — Khoá Kết nối (pure rules)", () => {
  it("accepts 4–6 digits only", () => {
    expect(isValidCode("1234")).toBe(true);
    expect(isValidCode("123456")).toBe(true);
    expect(isValidCode("123")).toBe(false);
    expect(isValidCode("1234567")).toBe(false);
    expect(isValidCode("12a4")).toBe(false);
  });

  it("waits longer the more wrong codes: from 5 → 1 minute, from 10 → 15 minutes", () => {
    expect(lockoutMs(4)).toBe(0);
    expect(lockoutMs(5)).toBe(60_000);
    expect(lockoutMs(9)).toBe(60_000);
    expect(lockoutMs(10)).toBe(15 * 60_000);
    expect(lockoutMs(30)).toBe(15 * 60_000);
  });

  it("a fresh start asks again unless the choice is 'only when I press it'", () => {
    expect(startsLocked(null, true)).toBe(false);
    expect(startsLocked({ method: "code", autoLock: "manual", credentialId: null }, false)).toBe(false);
    expect(startsLocked({ method: "code", autoLock: "manual", credentialId: null }, true)).toBe(true);
    expect(startsLocked({ method: "code", autoLock: "leave", credentialId: null }, false)).toBe(true);
    expect(startsLocked({ method: "device", autoLock: "5", credentialId: "x" }, false)).toBe(true);
  });

  it("closes after 1 / 5 / 15 idle minutes, never on its own for manual or leave", () => {
    expect(AUTO_LOCK_OPTIONS.map((o) => o.id)).toEqual(["manual", "leave", "1", "5", "15"]);
    expect(idleMinutes("manual")).toBeNull();
    expect(idleMinutes("leave")).toBeNull();
    expect(idleExpired("5", 0, 4 * 60_000)).toBe(false);
    expect(idleExpired("5", 0, 5 * 60_000)).toBe(true);
    expect(idleExpired("manual", 0, 99 * 60_000)).toBe(false);
  });

  it("hashes with PBKDF2, salted, at least 600 000 rounds by default", async () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    const salt = new Uint8Array(16).fill(7);
    const a = await hashCode("1234", salt, 1000);
    expect(a).toBe(await hashCode("1234", salt, 1000));
    expect(a).not.toBe(await hashCode("1235", salt, 1000));
    expect(a).not.toBe(await hashCode("1234", new Uint8Array(16).fill(8), 1000));
  });

  it("never uses the word for encryption (merge rule 7)", () => {
    expect(LOCK_TRUTH).not.toMatch(/mã ho[áa]/i);
    expect(LOCK_TRUTH).toContain("chỉ che Kết nối trên máy này");
  });
});
