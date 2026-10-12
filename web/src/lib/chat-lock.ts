/**
 * AVORA-109 · A — Khoá Kết nối: a screen cover for the Kết nối tab on this device.
 *
 * It is not encryption and must never be called that: messages are stored exactly as before. The
 * lock only stops someone holding an unlocked phone from reading chats. Everything lives on this
 * device — nothing is sent to the server:
 *  - the settings (method, when to lock, locked or not) in localStorage, one key per account;
 *  - the code's salted PBKDF2 hash and the failed-attempt counter in IndexedDB.
 * Signing out forgets all of it, which is how a forgotten code is reset (signing in again needs
 * the account password).
 */

export type ChatLockMethod = "device" | "code";
export type ChatAutoLock = "manual" | "leave" | "1" | "5" | "15";

export type ChatLockConfig = {
  method: ChatLockMethod;
  autoLock: ChatAutoLock;
  /** WebAuthn credential id (base64url) for `device`. */
  credentialId: string | null;
};

export const AUTO_LOCK_OPTIONS: readonly { id: ChatAutoLock; label: string }[] = [
  { id: "manual", label: "Chỉ khi tôi bấm nút" },
  { id: "leave", label: "Khi tôi rời app" },
  { id: "1", label: "Sau 1 phút không dùng" },
  { id: "5", label: "Sau 5 phút không dùng" },
  { id: "15", label: "Sau 15 phút không dùng" },
];

export const CODE_MIN = 4;
export const CODE_MAX = 6;
export const PBKDF2_ITERATIONS = 600_000;

const CONFIG_PREFIX = "avora.chat-lock:";
const LOCKED_PREFIX = "avora.chat-lock-locked:";
const HINT_PREFIX = "avora.chat-lock-hint:";
const DB_NAME = "avora-chat-lock";
const STORE = "kv";

/**
 * Truthful line for the setup sheet (AVORA-109 · A4). The merge rule (no word for encryption anywhere in
 * N1–N2's interface, ADR-020/034/040) wins over A4's quoted wording, so the same fact is said plainly.
 */
export const LOCK_TRUTH = "Khoá này chỉ che Kết nối trên máy này. Tin nhắn vẫn được lưu như cũ, không thay đổi gì.";

export function isValidCode(code: string): boolean {
  return new RegExp(`^\\d{${CODE_MIN},${CODE_MAX}}$`).test(code);
}

/** Minutes of idleness after which the lock closes, or null when it does not close on its own timer. */
export function idleMinutes(autoLock: ChatAutoLock): number | null {
  return autoLock === "1" || autoLock === "5" || autoLock === "15" ? Number(autoLock) : null;
}

/** Whether a fresh start of the app opens locked: every choice except "only when I press it" does. */
export function startsLocked(config: ChatLockConfig | null, wasLocked: boolean): boolean {
  if (config === null) return false;
  return config.autoLock !== "manual" || wasLocked;
}

/** How long to wait after `fails` wrong codes in a row: from the 5th → 1 minute each, from the 10th → 15 minutes each. */
export function lockoutMs(fails: number): number {
  if (fails >= 10) return 15 * 60_000;
  if (fails >= 5) return 60_000;
  return 0;
}

/** Whether the idle timer has run out. */
export function idleExpired(autoLock: ChatAutoLock, lastActiveAt: number, now: number): boolean {
  const minutes = idleMinutes(autoLock);
  return minutes !== null && now - lastActiveAt >= minutes * 60_000;
}

function isAutoLock(value: unknown): value is ChatAutoLock {
  return AUTO_LOCK_OPTIONS.some((option) => option.id === value);
}

export function readConfig(userId: string): ChatLockConfig | null {
  try {
    const raw = window.localStorage.getItem(`${CONFIG_PREFIX}${userId}`);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<ChatLockConfig>;
    if (parsed.method !== "device" && parsed.method !== "code") return null;
    return {
      method: parsed.method,
      autoLock: isAutoLock(parsed.autoLock) ? parsed.autoLock : "manual",
      credentialId: typeof parsed.credentialId === "string" ? parsed.credentialId : null,
    };
  } catch {
    return null;
  }
}

export function writeConfig(userId: string, config: ChatLockConfig | null): void {
  try {
    if (config === null) window.localStorage.removeItem(`${CONFIG_PREFIX}${userId}`);
    else window.localStorage.setItem(`${CONFIG_PREFIX}${userId}`, JSON.stringify(config));
  } catch {
    // Private mode: the lock lasts for this visit only.
  }
}

export function readLocked(userId: string): boolean {
  try {
    return window.localStorage.getItem(`${LOCKED_PREFIX}${userId}`) === "1";
  } catch {
    return false;
  }
}

export function writeLocked(userId: string, locked: boolean): void {
  try {
    if (locked) window.localStorage.setItem(`${LOCKED_PREFIX}${userId}`, "1");
    else window.localStorage.removeItem(`${LOCKED_PREFIX}${userId}`);
  } catch {
    // See writeConfig.
  }
}

/** The one-time "hide notification content?" suggestion (A4). */
export function hintShown(userId: string): boolean {
  try {
    return window.localStorage.getItem(`${HINT_PREFIX}${userId}`) === "1";
  } catch {
    return true;
  }
}

export function markHintShown(userId: string): void {
  try {
    window.localStorage.setItem(`${HINT_PREFIX}${userId}`, "1");
  } catch {
    // Harmless: worst case the suggestion shows once more.
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest | null): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request === null ? undefined : (request.result as T | undefined));
      tx.onerror = () => reject(tx.error ?? new Error("indexeddb"));
      tx.onabort = () => reject(tx.error ?? new Error("indexeddb"));
    });
  } finally {
    // Never keep a connection open: another tab (or a sign-out) must be able to clear the store.
    db.close();
  }
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  return withStore<T>("readonly", (store) => store.get(key));
}

async function idbPut(key: string, value: unknown): Promise<void> {
  await withStore("readwrite", (store) => (value === undefined ? store.delete(key) : store.put(value, key)));
}

type StoredCode = { salt: string; hash: string; iterations: number };
type StoredAttempts = { fails: number; until: number };

function toB64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64(value: string): Uint8Array {
  const text = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index);
  return out;
}

/** PBKDF2-SHA-256 over the code. Exported so a test can check the iteration count is honoured. */
export async function hashCode(code: string, salt: Uint8Array, iterations: number = PBKDF2_ITERATIONS): Promise<string> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    256,
  );
  return toB64(new Uint8Array(bits));
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

export async function saveCode(userId: string, code: string, iterations: number = PBKDF2_ITERATIONS): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashCode(code, salt, iterations);
  await idbPut(`code:${userId}`, { salt: toB64(salt), hash, iterations } satisfies StoredCode);
  await idbPut(`attempts:${userId}`, undefined);
}

export async function readAttempts(userId: string): Promise<StoredAttempts> {
  try {
    return (await idbGet<StoredAttempts>(`attempts:${userId}`)) ?? { fails: 0, until: 0 };
  } catch {
    return { fails: 0, until: 0 };
  }
}

export type CodeCheck = { ok: true } | { ok: false; waitUntil: number; fails: number };

/** Checks a code against the stored hash, counting failures and enforcing the growing wait. */
export async function checkCode(userId: string, code: string, now: number = Date.now()): Promise<CodeCheck> {
  const attempts = await readAttempts(userId);
  if (attempts.until > now) return { ok: false, waitUntil: attempts.until, fails: attempts.fails };
  const stored = await idbGet<StoredCode>(`code:${userId}`);
  if (stored === undefined) return { ok: false, waitUntil: 0, fails: attempts.fails };
  const hash = await hashCode(code, fromB64(stored.salt), stored.iterations);
  if (sameText(hash, stored.hash)) {
    await idbPut(`attempts:${userId}`, undefined);
    return { ok: true };
  }
  const fails = attempts.fails + 1;
  const wait = lockoutMs(fails);
  const until = wait > 0 ? now + wait : 0;
  await idbPut(`attempts:${userId}`, { fails, until } satisfies StoredAttempts);
  return { ok: false, waitUntil: until, fails };
}

/** Whether this device can unlock with its own screen lock / biometrics. */
export async function deviceUnlockAvailable(): Promise<boolean> {
  try {
    if (typeof window.PublicKeyCredential === "undefined") return false;
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Creates a platform credential that needs the device's own screen lock to use. */
export async function registerDevice(userId: string): Promise<string> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "AVORA" },
      user: { id: new TextEncoder().encode(userId.slice(0, 64)), name: "Khoá Kết nối", displayName: "Khoá Kết nối" },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60_000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;
  if (credential === null) throw new Error("Máy chưa tạo được cách mở này.");
  return toB64(new Uint8Array(credential.rawId));
}

/** Asks the device to confirm it is its owner. Resolves true only when the user was verified. */
export async function verifyDevice(credentialId: string): Promise<boolean> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: fromB64(credentialId) as BufferSource }],
      userVerification: "required",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (assertion === null) return false;
  const data = new Uint8Array((assertion.response as AuthenticatorAssertionResponse).authenticatorData);
  // Flags byte (offset 32): bit 2 = user verified.
  return data.length > 32 && (data[32] & 0x04) !== 0;
}

/** Forgets this account's lock on this device (sign-out, or "turn off"). */
export async function clearChatLock(userId: string | null): Promise<void> {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key !== null && (key.startsWith(CONFIG_PREFIX) || key.startsWith(LOCKED_PREFIX))) {
        if (userId === null || key.endsWith(userId)) keys.push(key);
      }
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Nothing stored.
  }
  try {
    if (userId === null) {
      await withStore("readwrite", (store) => store.clear());
    } else {
      await idbPut(`code:${userId}`, undefined);
      await idbPut(`attempts:${userId}`, undefined);
    }
  } catch {
    // Nothing stored.
  }
}
