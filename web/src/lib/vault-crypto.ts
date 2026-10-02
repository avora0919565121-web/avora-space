/**
 * AVORA-68 (ADR-041) — the Két sắt key tree, all on the device. Pure functions over WebCrypto
 * (AES-256-GCM, HKDF-SHA256) + hash-wasm (Argon2id) + @scure/bip39 (24 words). No algorithm is
 * written here by hand.
 *
 *   MK (32 random bytes)
 *    ├─ wrapped by KEK_pass = Argon2id(Mật khẩu Két sắt, salt_pass, params)     → server
 *    ├─ wrapped by KEK_rec  = HKDF(entropy of 24 words, salt_rec, recovery-v1)  → server
 *    └─ wrapped by KEK_dev (HKDF of the server share) and then by KD (device)   → this device only
 *   SK[section] wrapped by MK · IK[item] / FK[file] wrapped by SK[section]
 *
 * Every wrap is AES-GCM with a fresh 96-bit IV and AAD = user_id ‖ key kind ‖ id, so a wrap cannot be
 * pasted onto another item.
 */
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export const ALGORITHM_VERSION = 1;
export const KEY_VERSION = 1;

export type KdfParams = { alg: "argon2id"; v: 19; m: number; t: number; p: 1 };

/** S7 (VMT 02/10): no iPhone numbers in argon_bench yet → 32 MB / 4. Stored with every keyring. */
export const DEFAULT_KDF: KdfParams = { alg: "argon2id", v: 19, m: 32768, t: 4, p: 1 };

export type Sealed = { iv: Uint8Array; ct: Uint8Array };

export type VaultSection = "certificates" | "documents" | "assets";
export const VAULT_SECTIONS: readonly VaultSection[] = ["certificates", "documents", "assets"];

const enc = new TextEncoder();
const dec = new TextDecoder();

// ------------------------------------------------------------------ bytes

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function fromB64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** `iv ‖ ct` in one base64 string — how a wrap travels and is stored. */
export function packSealed(sealed: Sealed): string {
  const out = new Uint8Array(sealed.iv.length + sealed.ct.length);
  out.set(sealed.iv, 0);
  out.set(sealed.ct, sealed.iv.length);
  return toB64(out);
}

export function unpackSealed(packed: string): Sealed {
  const all = fromB64(packed);
  return { iv: all.slice(0, 12), ct: all.slice(12) };
}

export function wipe(bytes: Uint8Array | null | undefined): void {
  bytes?.fill(0);
}

/** The AAD every wrap is bound to. */
export function aadFor(userId: string, kind: string, id: string): Uint8Array {
  return enc.encode(`avora-vault-v1|${userId}|${kind}|${id}`);
}

// ------------------------------------------------------------------ AES-GCM

const buf = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

export async function importAesKey(raw: Uint8Array, extractable = false): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error("vault_key_length");
  return crypto.subtle.importKey("raw", buf(raw), { name: "AES-GCM" }, extractable, ["encrypt", "decrypt"]);
}

export async function seal(key: CryptoKey, plaintext: Uint8Array, aad: Uint8Array): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv), additionalData: buf(aad) }, key, buf(plaintext)));
  return { iv, ct };
}

export async function open(key: CryptoKey, sealed: Sealed, aad: Uint8Array): Promise<Uint8Array> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(sealed.iv), additionalData: buf(aad) }, key, buf(sealed.ct)));
  } catch {
    throw new Error("vault_decrypt_failed");
  }
}

// ------------------------------------------------------------------ KDFs

export async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string, length = 32): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(enc.encode(info)) }, base, length * 8);
  return new Uint8Array(bits);
}

/** Argon2id over the passphrase (NFC, trimmed) — 32 bytes. Lazy-loaded WASM. */
export async function argon2(passphrase: string, salt: Uint8Array, params: KdfParams): Promise<Uint8Array> {
  const { argon2id } = await import("hash-wasm");
  return argon2id({
    password: passphrase.normalize("NFC").trim(),
    salt,
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: 32,
    outputType: "binary",
  });
}

/** From the Argon2 output: the key that wraps MK, and a proof the server can compare (never the passphrase). */
export async function passKeys(argonOut: Uint8Array): Promise<{ kek: CryptoKey; proof: string }> {
  const kekRaw = await hkdf(argonOut, new Uint8Array(0), "avora-vault-pass-kek-v1");
  const proof = await hkdf(argonOut, new Uint8Array(0), "avora-vault-pass-proof-v1");
  const kek = await importAesKey(kekRaw);
  wipe(kekRaw);
  return { kek, proof: toB64(proof) };
}

/** From the 24-word entropy: the wrapping key, an 8-byte check that spots another kit, and a proof. */
export async function recoveryKeys(entropy: Uint8Array, salt: Uint8Array): Promise<{ kek: CryptoKey; check: string; proof: string }> {
  const kekRaw = await hkdf(entropy, salt, "avora-vault-recovery-v1");
  const check = await hkdf(entropy, salt, "avora-vault-recovery-check-v1", 8);
  const proof = await hkdf(entropy, salt, "avora-vault-recovery-proof-v1");
  const kek = await importAesKey(kekRaw);
  wipe(kekRaw);
  return { kek, check: toB64(check), proof: toB64(proof) };
}

/** KEK_dev = HKDF(server share, salt = device id, "avora-vault-device-v1"). */
export async function deviceKek(share: Uint8Array, deviceId: string): Promise<CryptoKey> {
  const raw = await hkdf(share, enc.encode(deviceId), "avora-vault-device-v1");
  const key = await importAesKey(raw);
  wipe(raw);
  return key;
}

// ------------------------------------------------------------------ Bộ khôi phục (24 words)

export function newRecoveryEntropy(): Uint8Array {
  return randomBytes(32);
}

export function entropyToWords(entropy: Uint8Array): string[] {
  return entropyToMnemonic(entropy, wordlist).split(" ");
}

/** Null when the words are not a valid kit (wrong word, wrong order, bad checksum). */
export function wordsToEntropy(words: readonly string[] | string): Uint8Array | null {
  const phrase = (typeof words === "string" ? words : words.join(" ")).toLowerCase().trim().split(/\s+/).join(" ");
  if (phrase.split(" ").length !== 24 || !validateMnemonic(phrase, wordlist)) return null;
  return mnemonicToEntropy(phrase, wordlist);
}

export function isKitWord(word: string): boolean {
  return wordlist.includes(word.toLowerCase().trim());
}

/** Three distinct positions to ask back after `Tôi đã cất`. */
export function pickCheckPositions(count = 3, total = 24): number[] {
  const picks = new Set<number>();
  while (picks.size < count) picks.add(crypto.getRandomValues(new Uint32Array(1))[0] % total);
  return [...picks].sort((a, b) => a - b);
}

// ------------------------------------------------------------------ the keyring

export type KeyringWire = {
  mk_wrapped_pass: string;
  salt_pass: string;
  kdf_params: KdfParams;
  mk_wrapped_rec: string;
  salt_rec: string;
  rec_check: string;
  section_keys: Record<string, string>;
  key_version: number;
};

export type NewKeyring = { wire: KeyringWire; passProof: string; recProof: string; mk: Uint8Array };

/** Builds the whole keyring on the device; MK comes back for the caller to keep in memory only. */
export async function createKeyring(userId: string, passphrase: string, entropy: Uint8Array, params: KdfParams = DEFAULT_KDF): Promise<NewKeyring> {
  const mk = randomBytes(32);
  const saltPass = randomBytes(16);
  const saltRec = randomBytes(16);
  const argonOut = await argon2(passphrase, saltPass, params);
  const pass = await passKeys(argonOut);
  wipe(argonOut);
  const rec = await recoveryKeys(entropy, saltRec);
  const mkKey = await importAesKey(mk);
  const sectionKeys: Record<string, string> = {};
  for (const section of VAULT_SECTIONS) {
    const sk = randomBytes(32);
    sectionKeys[section] = packSealed(await seal(mkKey, sk, aadFor(userId, "section", section)));
    wipe(sk);
  }
  return {
    wire: {
      mk_wrapped_pass: packSealed(await seal(pass.kek, mk, aadFor(userId, "mk", "pass"))),
      salt_pass: toB64(saltPass),
      kdf_params: params,
      mk_wrapped_rec: packSealed(await seal(rec.kek, mk, aadFor(userId, "mk", "recovery"))),
      salt_rec: toB64(saltRec),
      rec_check: rec.check,
      section_keys: sectionKeys,
      key_version: KEY_VERSION,
    },
    passProof: pass.proof,
    recProof: rec.proof,
    mk,
  };
}

export async function unwrapWithPassphrase(userId: string, passphrase: string, saltPass: string, params: KdfParams, wrapped: string): Promise<Uint8Array> {
  const argonOut = await argon2(passphrase, fromB64(saltPass), params);
  const { kek } = await passKeys(argonOut);
  wipe(argonOut);
  return open(kek, unpackSealed(wrapped), aadFor(userId, "mk", "pass"));
}

export async function unwrapWithRecovery(userId: string, entropy: Uint8Array, saltRec: string, wrapped: string): Promise<Uint8Array> {
  const { kek } = await recoveryKeys(entropy, fromB64(saltRec));
  return open(kek, unpackSealed(wrapped), aadFor(userId, "mk", "recovery"));
}

/** Proof of the passphrase, computed without fetching any wrap (salt + params are not secret). */
export async function passProofFor(passphrase: string, saltPass: string, params: KdfParams): Promise<string> {
  const argonOut = await argon2(passphrase, fromB64(saltPass), params);
  const { proof } = await passKeys(argonOut);
  wipe(argonOut);
  return proof;
}

export async function recProofFor(entropy: Uint8Array, saltRec: string): Promise<{ proof: string; check: string }> {
  const { proof, check } = await recoveryKeys(entropy, fromB64(saltRec));
  return { proof, check };
}

/** New passphrase wrap of the same MK (Đổi Mật khẩu Két sắt). */
export async function rewrapForPassphrase(userId: string, mk: Uint8Array, passphrase: string, params: KdfParams = DEFAULT_KDF): Promise<{ wrapped: string; salt: string; params: KdfParams; proof: string }> {
  const salt = randomBytes(16);
  const argonOut = await argon2(passphrase, salt, params);
  const pass = await passKeys(argonOut);
  wipe(argonOut);
  return { wrapped: packSealed(await seal(pass.kek, mk, aadFor(userId, "mk", "pass"))), salt: toB64(salt), params, proof: pass.proof };
}

/** New recovery kit for the same MK — the old kit stops working once this is stored. */
export async function rewrapForRecovery(userId: string, mk: Uint8Array, entropy: Uint8Array): Promise<{ wrapped: string; salt: string; check: string; proof: string }> {
  const salt = randomBytes(16);
  const rec = await recoveryKeys(entropy, salt);
  return { wrapped: packSealed(await seal(rec.kek, mk, aadFor(userId, "mk", "recovery"))), salt: toB64(salt), check: rec.check, proof: rec.proof };
}

// ------------------------------------------------------------------ device wrap (2.3)

/** MK wrapped twice: inside by KEK_dev (needs the server share), outside by KD (never leaves the device). */
export async function wrapForDevice(userId: string, deviceId: string, mk: Uint8Array, share: Uint8Array, kd: CryptoKey): Promise<string> {
  const inner = await seal(await deviceKek(share, deviceId), mk, aadFor(userId, "mk", `device:${deviceId}`));
  const outer = await seal(kd, enc.encode(packSealed(inner)), aadFor(userId, "mk-outer", `device:${deviceId}`));
  return packSealed(outer);
}

export async function unwrapFromDevice(userId: string, deviceId: string, wrapped: string, share: Uint8Array, kd: CryptoKey): Promise<Uint8Array> {
  const innerPacked = dec.decode(await open(kd, unpackSealed(wrapped), aadFor(userId, "mk-outer", `device:${deviceId}`)));
  return open(await deviceKek(share, deviceId), unpackSealed(innerPacked), aadFor(userId, "mk", `device:${deviceId}`));
}

export async function newDeviceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// ------------------------------------------------------------------ items & files

export async function sectionKey(userId: string, mk: CryptoKey, section: VaultSection, wrapped: string): Promise<CryptoKey> {
  const raw = await open(mk, unpackSealed(wrapped), aadFor(userId, "section", section));
  const key = await importAesKey(raw);
  wipe(raw);
  return key;
}

export type SealedItem = { ciphertext: string; wrappedItemKey: string };

export async function sealItem(userId: string, sk: CryptoKey, itemId: string, payload: unknown): Promise<SealedItem> {
  const ik = randomBytes(32);
  const ikKey = await importAesKey(ik);
  const body = await seal(ikKey, enc.encode(JSON.stringify(payload)), aadFor(userId, "item-data", itemId));
  const wrapped = await seal(sk, ik, aadFor(userId, "item", itemId));
  wipe(ik);
  return { ciphertext: packSealed(body), wrappedItemKey: packSealed(wrapped) };
}

export async function openItem<T>(userId: string, sk: CryptoKey, itemId: string, item: SealedItem): Promise<T> {
  const ik = await open(sk, unpackSealed(item.wrappedItemKey), aadFor(userId, "item", itemId));
  const ikKey = await importAesKey(ik);
  wipe(ik);
  return JSON.parse(dec.decode(await open(ikKey, unpackSealed(item.ciphertext), aadFor(userId, "item-data", itemId)))) as T;
}

export async function sealFile(userId: string, sk: CryptoKey, fileId: string, bytes: Uint8Array): Promise<{ blob: Uint8Array; wrappedFileKey: string }> {
  const fk = randomBytes(32);
  const fkKey = await importAesKey(fk);
  const body = await seal(fkKey, bytes, aadFor(userId, "file-data", fileId));
  const wrapped = await seal(sk, fk, aadFor(userId, "file", fileId));
  wipe(fk);
  const blob = new Uint8Array(12 + body.ct.length);
  blob.set(body.iv, 0);
  blob.set(body.ct, 12);
  return { blob, wrappedFileKey: packSealed(wrapped) };
}

export async function openFile(userId: string, sk: CryptoKey, fileId: string, blob: Uint8Array, wrappedFileKey: string): Promise<Uint8Array> {
  const fk = await open(sk, unpackSealed(wrappedFileKey), aadFor(userId, "file", fileId));
  const fkKey = await importAesKey(fk);
  wipe(fk);
  return open(fkKey, { iv: blob.slice(0, 12), ct: blob.slice(12) }, aadFor(userId, "file-data", fileId));
}

// ------------------------------------------------------------------ passphrase strength

/** ≥ 12 characters or ≥ 4 words (4.1 · 2). Score 0–4 for the meter. */
export function passphraseStrength(value: string): { ok: boolean; score: 0 | 1 | 2 | 3 | 4 } {
  const text = value.normalize("NFC").trim();
  const words = text.split(/\s+/).filter((w) => w.length >= 2).length;
  const ok = text.length >= 12 || words >= 4;
  let score = 0;
  if (text.length >= 8) score += 1;
  if (text.length >= 12) score += 1;
  if (words >= 4 || text.length >= 18) score += 1;
  if (/[0-9]/.test(text) || /[^\p{L}\p{N}\s]/u.test(text) || words >= 5 || text.length >= 24) score += 1;
  return { ok, score: Math.min(4, ok ? Math.max(score, 2) : Math.min(score, 1)) as 0 | 1 | 2 | 3 | 4 };
}
