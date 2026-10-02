import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { maskEmail, maskPhone } from "@/lib/mask";
import {
  VAULT_ABOUT,
  VAULT_IDLE_MS,
  cleanVaultCode,
  isVaultCode,
  leftTooLong,
  parseVaultAttempt,
  parseVaultStatus,
  vaultErrorMessage,
  waitLeft,
  wrongCodeLine,
} from "@/lib/vault-lock";
import { reminderTitle } from "@/lib/finance";

describe("AVORA-51 · mask (B3)", () => {
  it("shows only the ends of an email, domain middle hidden", () => {
    expect(maskEmail("vo.thanh@outlook.com")).toBe("vo•••h@o•••k.com");
    expect(maskEmail("vothanhn@outlook.com")).toBe("vo•••n@o•••k.com");
    expect(maskEmail("abc@gmail.com")).toBe("a•••@g•••l.com");
    expect(maskEmail("me@ab.vn")).toBe("m•••@a•••.vn");
  });

  it("never returns the full address and survives junk", () => {
    expect(maskEmail("someone.long@company.co.uk")).not.toContain("someone");
    expect(maskEmail(null)).toBe("");
    expect(maskEmail("no-at-sign")).toBe("n•••");
  });

  it("shows 3 first and 3 last digits of a phone", () => {
    expect(maskPhone("0912345121")).toBe("091•••121");
    expect(maskPhone("+84 912 345 121")).toBe("+84•••121");
    expect(maskPhone("")).toBe("");
    expect(maskPhone("12345")).toBe("1•••");
  });
});

describe("AVORA-51 · vault lock helpers", () => {
  it("reads a malformed status as locked", () => {
    expect(parseVaultStatus(null)).toMatchObject({ hasCode: false, unlocked: false, remaining: 5 });
    expect(parseVaultStatus({ has_code: true, unlocked: "yes" }).unlocked).toBe(false);
    expect(parseVaultStatus({ has_code: true, has_data: true, unlocked: true, remaining: 3 })).toMatchObject({
      hasCode: true,
      hasData: true,
      unlocked: true,
      remaining: 3,
    });
  });

  it("parses each attempt answer", () => {
    expect(parseVaultAttempt({ ok: true })).toEqual({ ok: true });
    expect(parseVaultAttempt({ ok: false, reason: "wrong", remaining: 2 })).toEqual({ ok: false, reason: "wrong", remaining: 2 });
    expect(parseVaultAttempt({ ok: false, reason: "wait", locked_until: "2026-10-01T10:05:00Z" })).toEqual({
      ok: false,
      reason: "wait",
      lockedUntil: "2026-10-01T10:05:00Z",
    });
    expect(parseVaultAttempt({ ok: false, reason: "expired" })).toEqual({ ok: false, reason: "expired" });
  });

  it("keeps six digits only", () => {
    expect(cleanVaultCode("12 34-56 78")).toBe("123456");
    expect(isVaultCode("123456")).toBe(true);
    expect(isVaultCode("12345a")).toBe(false);
  });

  it("counts the wait down as mm:ss", () => {
    const now = Date.parse("2026-10-01T10:00:00Z");
    expect(waitLeft("2026-10-01T10:04:30Z", now)).toBe("04:30");
    expect(waitLeft("2026-10-01T09:00:00Z", now)).toBe("00:00");
  });

  it("asks again only after more than 5 minutes away (51.2 / 51.3)", () => {
    const now = 10_000_000;
    expect(leftTooLong(null, now)).toBe(false);
    expect(leftTooLong(now - 2 * 60_000, now)).toBe(false);
    expect(leftTooLong(now - 6 * 60_000, now)).toBe(true);
    expect(VAULT_IDLE_MS).toBe(5 * 60_000);
  });

  it("says how many tries are left", () => {
    expect(wrongCodeLine(3)).toBe("Mã chưa đúng. Còn 3 lần thử.");
    expect(vaultErrorMessage("avora_vault_reset_rate")).toContain("3 lần");
  });

  it("loan reminder names carry no amount (decision 4)", () => {
    expect(reminderTitle("Vay anh Nam")).toBe("Đến hạn: Vay anh Nam");
  });
});

/** 51.12 — "mã hoá" appears in Két sắt only inside the B2 note, which promises nothing. */
describe("AVORA-51 · 51.12 no encryption promise", () => {
  const root = join(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "test") walk(full);
      } else if (/\.(tsx?|ts)$/.test(name)) files.push(full);
    }
  };
  walk(root);
  // Két sắt surfaces only: the vault frame, its finance screens, the lock and its words.
  const vaultFiles = files.filter((file) =>
    /pages\/(Vault|Finance)|components\/(finance|vault)\/|lib\/(vault|finance|use-vault)/.test(file),
  );

  it("B2 says exactly what is encrypted and what is not (ADR-041 replaces the 51 wording)", () => {
    expect(VAULT_ABOUT.title).toBe("Mã 6 số là khoá cửa của Két sắt.");
    expect(VAULT_ABOUT.lines).toContain("Chứng chỉ · Tài liệu · Tài sản: đã mã hoá ngay trên máy bạn.");
    expect(VAULT_ABOUT.lines).toContain("Tài chính: đang bảo vệ bằng khoá Két sắt; mã hoá sắp có.");
    expect(VAULT_ABOUT.lines).toContain("Mật khẩu: sắp có.");
  });

  it("68.15: encryption is only claimed for the three paper compartments", () => {
    // The encrypted compartments (AVORA-68) may say so; everywhere else only "sắp có" or the crypto
    // money account type ("Tiền mã hoá") may carry the word.
    const e2eeFiles = /components\/vault\/(VaultSetup|VaultCompartment|VaultForgot)\.tsx$|lib\/(vault-crypto|vault-keys|use-vault-e2ee|vault-templates|recovery-kit-pdf|vault-image)\.ts$/;
    const allowed = ["Tiền mã hoá", "mã hoá sắp có", "Chứng chỉ · Tài liệu · Tài sản: đã mã hoá"];
    const offenders: string[] = [];
    expect(vaultFiles.length).toBeGreaterThan(10);
    for (const file of vaultFiles) {
      const source = readFileSync(file, "utf8");
      const code = source.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
      if (/an toàn tuyệt đối|bảo mật cấp ngân hàng/i.test(code)) offenders.push(`${file}: overclaim`);
      if (e2eeFiles.test(file)) continue;
      const literals = source.match(/(["'`])(?:(?!\1)[^\\]|\\.)*?mã hoá(?:(?!\1)[^\\]|\\.)*?\1/g) ?? [];
      for (const literal of literals) {
        if (!allowed.some((ok) => literal.includes(ok))) offenders.push(`${file}: ${literal}`);
      }
      if (/chỉ bạn đọc được/i.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
