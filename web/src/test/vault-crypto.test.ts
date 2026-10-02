import { describe, expect, it } from "vitest";

import {
  aadFor,
  createKeyring,
  entropyToWords,
  hkdf,
  importAesKey,
  newDeviceKey,
  newRecoveryEntropy,
  open,
  openFile,
  openItem,
  passphraseStrength,
  pickCheckPositions,
  randomBytes,
  recProofFor,
  rewrapForPassphrase,
  rewrapForRecovery,
  seal,
  sealFile,
  sealItem,
  sectionKey,
  toB64,
  unwrapFromDevice,
  unwrapWithPassphrase,
  unwrapWithRecovery,
  wordsToEntropy,
  wrapForDevice,
  type KdfParams,
} from "@/lib/vault-crypto";

/** Small Argon2 cost so the suite stays fast; the real cost is stored per keyring. */
const FAST: KdfParams = { alg: "argon2id", v: 19, m: 256, t: 1, p: 1 };
const USER = "be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d";
const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("68.1 vault-crypto", () => {
  it("round-trips, refuses a wrong key and a changed AAD", async () => {
    const key = await importAesKey(randomBytes(32));
    const other = await importAesKey(randomBytes(32));
    const aad = aadFor(USER, "item", "a");
    const sealed = await seal(key, new TextEncoder().encode("CCCD-TEST-7781"), aad);
    expect(new TextDecoder().decode(await open(key, sealed, aad))).toBe("CCCD-TEST-7781");
    await expect(open(other, sealed, aad)).rejects.toThrow("vault_decrypt_failed");
    await expect(open(key, sealed, aadFor(USER, "item", "b"))).rejects.toThrow("vault_decrypt_failed");
  });

  it("never repeats an IV in 10,000 seals", async () => {
    const key = await importAesKey(randomBytes(32));
    const seen = new Set<string>();
    const aad = aadFor(USER, "x", "y");
    for (let i = 0; i < 10_000; i += 1) seen.add(toB64((await seal(key, new Uint8Array([i & 255]), aad)).iv));
    expect(seen.size).toBe(10_000);
  });

  it("HKDF-SHA256 matches RFC 5869 test case 1", async () => {
    const ikm = new Uint8Array(22).fill(0x0b);
    const salt = Uint8Array.from({ length: 13 }, (_, i) => i);
    const info = String.fromCharCode(...Array.from({ length: 10 }, (_, i) => 0xf0 + i));
    // info bytes are 0xf0..0xf9; encode them raw through latin1 → use the bytes directly.
    const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: Uint8Array.from(info, (c) => c.charCodeAt(0)) }, base, 42 * 8));
    expect(hex(bits)).toBe("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865");
    expect((await hkdf(ikm, salt, "avora")).length).toBe(32);
  });

  // RFC 9106's vector needs associated data, which hash-wasm does not expose; this is the PHC
  // reference implementation's argon2id vector (test.c: "password" / "somesalt", m=2^16, t=2, p=1).
  it("Argon2id matches the reference implementation vector", async () => {
    const { argon2id } = await import("hash-wasm");
    const out = await argon2id({
      password: "password",
      salt: "somesalt",
      parallelism: 1,
      iterations: 2,
      memorySize: 65536,
      hashLength: 32,
      outputType: "hex",
    });
    expect(out).toBe("09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7");
  });
});

describe("68.2 Bộ khôi phục", () => {
  it("round-trips 24 words; a bad checksum is refused", () => {
    const entropy = newRecoveryEntropy();
    const words = entropyToWords(entropy);
    expect(words).toHaveLength(24);
    expect(hex(wordsToEntropy(words) as Uint8Array)).toBe(hex(entropy));
    const swapped = [...words];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(swapped.join(" ") === words.join(" ") || wordsToEntropy(swapped) === null || hex(wordsToEntropy(swapped) as Uint8Array) !== hex(entropy)).toBe(true);
    expect(wordsToEntropy([...words.slice(0, 23), words[23] === "abandon" ? "zoo" : "abandon"])).toBeNull();
    expect(wordsToEntropy(words.slice(0, 12))).toBeNull();
  });

  it("rec_check tells another kit apart", async () => {
    const a = newRecoveryEntropy();
    const b = newRecoveryEntropy();
    const salt = toB64(randomBytes(16));
    expect((await recProofFor(a, salt)).check).not.toBe((await recProofFor(b, salt)).check);
    expect((await recProofFor(a, salt)).check).toBe((await recProofFor(a, salt)).check);
  });

  it("asks back three distinct positions", () => {
    const picks = pickCheckPositions();
    expect(new Set(picks).size).toBe(3);
    picks.forEach((p) => expect(p >= 0 && p < 24).toBe(true));
  });
});

describe("68 keyring", () => {
  it("opens by passphrase, by recovery and by the device wrap; items and files round-trip", async () => {
    const entropy = newRecoveryEntropy();
    const ring = await createKeyring(USER, "mot hai ba bon nam", entropy, FAST);
    const w = ring.wire;
    expect(JSON.stringify(w)).not.toContain("mot hai ba");
    const byPass = await unwrapWithPassphrase(USER, "mot hai ba bon nam", w.salt_pass, w.kdf_params, w.mk_wrapped_pass);
    expect(hex(byPass)).toBe(hex(ring.mk));
    await expect(unwrapWithPassphrase(USER, "sai mat khau", w.salt_pass, w.kdf_params, w.mk_wrapped_pass)).rejects.toThrow();
    expect(hex(await unwrapWithRecovery(USER, entropy, w.salt_rec, w.mk_wrapped_rec))).toBe(hex(ring.mk));

    const kd = await newDeviceKey();
    const share = randomBytes(32);
    const deviceWrap = await wrapForDevice(USER, "dev-1", ring.mk, share, kd);
    expect(hex(await unwrapFromDevice(USER, "dev-1", deviceWrap, share, kd))).toBe(hex(ring.mk));
    // 68.5 / 68.6: without the right share the device wrap is useless.
    await expect(unwrapFromDevice(USER, "dev-1", deviceWrap, randomBytes(32), kd)).rejects.toThrow();
    await expect(unwrapFromDevice(USER, "dev-2", deviceWrap, share, kd)).rejects.toThrow();

    const mkKey = await importAesKey(ring.mk);
    const sk = await sectionKey(USER, mkKey, "certificates", w.section_keys.certificates);
    const item = await sealItem(USER, sk, "item-1", { title: "CCCD-TEST-7781", fields: { number: "079123456789" } });
    expect(item.ciphertext).not.toContain("CCCD");
    expect(await openItem<{ title: string }>(USER, sk, "item-1", item)).toMatchObject({ title: "CCCD-TEST-7781" });
    await expect(openItem(USER, sk, "item-2", item)).rejects.toThrow();
    const file = await sealFile(USER, sk, "file-1", new TextEncoder().encode("PDF-BYTES"));
    expect(new TextDecoder().decode(await openFile(USER, sk, "file-1", file.blob, file.wrappedFileKey))).toBe("PDF-BYTES");
  });

  it("68.9 / 68.10: a new passphrase replaces the old; a new kit replaces the old kit", async () => {
    const entropy = newRecoveryEntropy();
    const ring = await createKeyring(USER, "cu cu cu cu cu", entropy, FAST);
    const next = await rewrapForPassphrase(USER, ring.mk, "moi moi moi moi", FAST);
    expect(hex(await unwrapWithPassphrase(USER, "moi moi moi moi", next.salt, next.params, next.wrapped))).toBe(hex(ring.mk));
    await expect(unwrapWithPassphrase(USER, "cu cu cu cu cu", next.salt, next.params, next.wrapped)).rejects.toThrow();
    const newKit = newRecoveryEntropy();
    const rec = await rewrapForRecovery(USER, ring.mk, newKit);
    await expect(unwrapWithRecovery(USER, entropy, rec.salt, rec.wrapped)).rejects.toThrow();
    expect(hex(await unwrapWithRecovery(USER, newKit, rec.salt, rec.wrapped))).toBe(hex(ring.mk));
  });

  it("passphrase rule: ≥ 12 characters or ≥ 4 words", () => {
    expect(passphraseStrength("ngan").ok).toBe(false);
    expect(passphraseStrength("mot hai ba bon").ok).toBe(true);
    expect(passphraseStrength("abcdefghijkl").ok).toBe(true);
  });
});
