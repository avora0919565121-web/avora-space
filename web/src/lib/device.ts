import { supabase } from "@/integrations/supabase/client";
import { isGuestMachine } from "@/lib/guest-machine";
import { logError } from "@/lib/log";

/**
 * AVORA-67 (ADR-042) — this browser as a device. A device id plus a non-exportable ECDSA P-256 key
 * kept in IndexedDB; a guest machine (ADR-035) keeps its key in memory only, so it is a new device
 * on every reload and never holds a rank. The server ties the device to the session after checking a
 * signature over its nonce (Edge `device-prove`).
 */

export type DeviceKind = "phone" | "tablet" | "computer" | "unknown";
export type BlockReason = "lost" | "revoked" | "locked";

export type DeviceStatus = {
  allowed: boolean;
  reason: BlockReason | "unbound" | null;
  device: string | null;
  myRank: 1 | 2 | 3 | null;
  guest: boolean;
  lostBy: string | null;
  lostAt: string | null;
  lock: { rank: 1 | 2; at: string; mine: boolean; byLabel: string | null; escapeAt: string | null } | null;
  rankTaken: { 1: boolean; 2: boolean };
  vaultOtherAllowed: boolean;
};

export type MyDevice = {
  id: string;
  label: string;
  kind: DeviceKind;
  rank: 1 | 2 | 3;
  guest: boolean;
  lastSeenAt: string;
  isMe: boolean;
  lostStatus: "pending" | "rejected" | "found" | null;
  lostDeadline: string | null;
  canRevoke: boolean;
  canReportLost: boolean;
  /** AVORA-68: this device holds a Két sắt share. */
  canOpenVault: boolean;
};

const DB_NAME = "avora-device";
const STORE = "keys";
const RECORD = "self";

type StoredDevice = { deviceId: string; privateKey: CryptoKey; publicJwk: JsonWebKey };

let memoryDevice: StoredDevice | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb"));
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error("indexeddb"));
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb"));
  });
}

/** Everything AVORA keeps in this IndexedDB except the device key itself (AVORA-68 adds the vault wrap). */
export async function idbDeleteExcept(keep: readonly string[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const store = db.transaction(STORE, "readwrite").objectStore(STORE);
      const request = store.getAllKeys();
      request.onsuccess = () => {
        for (const key of request.result) if (!keep.includes(String(key))) store.delete(key);
        resolve();
      };
      request.onerror = () => resolve();
    });
  } catch {
    // Nothing stored, nothing to clear.
  }
}

export { idbGet as deviceStoreGet, idbPut as deviceStorePut };

async function newDevice(): Promise<StoredDevice> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { deviceId: crypto.randomUUID(), privateKey: pair.privateKey, publicJwk };
}

/** This browser's device — created once, never exported. */
export async function thisDevice(): Promise<StoredDevice> {
  if (memoryDevice !== null) return memoryDevice;
  if (isGuestMachine()) {
    memoryDevice = await newDevice();
    return memoryDevice;
  }
  try {
    const stored = await idbGet<StoredDevice>(RECORD);
    if (stored !== undefined) {
      memoryDevice = stored;
      return stored;
    }
    const created = await newDevice();
    await idbPut(RECORD, created);
    memoryDevice = created;
    return created;
  } catch {
    // Private browsing without IndexedDB: a device for this tab only.
    memoryDevice = await newDevice();
    return memoryDevice;
  }
}

/** The device id only, for callers that pass it to the server (vault_unlock). */
export async function thisDeviceId(): Promise<string> {
  return (await thisDevice()).deviceId;
}

/** `iPhone · Safari`, `Windows · Chrome` — what the device is called until renamed. */
export function deviceLabelOf(ua: string, maxTouchPoints: number): { label: string; kind: DeviceKind } {
  const isIpad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  const os = /iPhone/i.test(ua) ? "iPhone" : isIpad ? "iPad" : /Android/i.test(ua) ? "Android" : /Mac OS X|Macintosh/i.test(ua) ? "Mac" : /Windows/i.test(ua) ? "Windows" : /Linux/i.test(ua) ? "Linux" : "Máy";
  const browser = /EdgiOS|Edg\//i.test(ua) ? "Edge" : /CriOS|Chrome\//i.test(ua) ? "Chrome" : /FxiOS|Firefox\//i.test(ua) ? "Firefox" : /Safari\//i.test(ua) ? "Safari" : "Trình duyệt";
  const kind: DeviceKind = /iPhone/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua)) ? "phone" : isIpad || /Android/i.test(ua) ? "tablet" : os === "Máy" ? "unknown" : "computer";
  return { label: `${os} · ${browser}`, kind };
}

function b64(bytes: ArrayBuffer): string {
  let bin = "";
  for (const byte of new Uint8Array(bytes)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

const proveOnce = new Map<string, Promise<void>>();

/** Signs the server's nonce and binds this device to the current session. Once per session. */
export async function proveDevice(userId: string, accessToken: string, sessionKey: string): Promise<void> {
  const existing = proveOnce.get(sessionKey);
  if (existing !== undefined) return existing;
  const run = (async () => {
    const device = await thisDevice();
    const { data: nonce, error } = await supabase.rpc("device_challenge" as never, { p_device_id: device.deviceId } as never);
    if (error) throw new Error(error.message);
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      device.privateKey,
      new TextEncoder().encode(`avora-device-v1:${userId}:${device.deviceId}:${String(nonce)}`),
    );
    const { label, kind } = deviceLabelOf(navigator.userAgent, navigator.maxTouchPoints ?? 0);
    const res = await fetch(`${import.meta.env.EXPO_PUBLIC_SUPABASE_URL as string}/functions/v1/device-prove`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, apikey: import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string, "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: device.deviceId, public_key: device.publicJwk, nonce: String(nonce), signature: b64(signature), label, kind, guest: isGuestMachine() }),
    });
    if (!res.ok) throw new Error(`device-prove ${res.status}`);
  })();
  proveOnce.set(sessionKey, run);
  run.catch(() => proveOnce.delete(sessionKey));
  return run;
}

export function parseDeviceStatus(raw: unknown): DeviceStatus {
  const r = (raw ?? {}) as Record<string, unknown>;
  const lock = r.lock as Record<string, unknown> | null | undefined;
  const taken = (r.rank_taken ?? {}) as Record<string, unknown>;
  const rank = r.my_rank === 1 || r.my_rank === 2 || r.my_rank === 3 ? r.my_rank : null;
  const reason = r.reason === "lost" || r.reason === "revoked" || r.reason === "locked" ? r.reason : null;
  return {
    allowed: r.allowed !== false,
    reason,
    device: typeof r.device === "string" ? r.device : null,
    myRank: rank,
    guest: r.guest === true,
    lostBy: typeof r.lost_by === "string" ? r.lost_by : null,
    lostAt: typeof r.lost_at === "string" ? r.lost_at : null,
    lock:
      lock === null || lock === undefined
        ? null
        : {
            rank: lock.rank === 1 ? 1 : 2,
            at: String(lock.at ?? ""),
            mine: lock.mine === true,
            byLabel: typeof lock.by_label === "string" ? lock.by_label : null,
            escapeAt: typeof lock.escape_at === "string" ? lock.escape_at : null,
          },
    rankTaken: { 1: taken["1"] === true, 2: taken["2"] === true },
    vaultOtherAllowed: r.vault_other_allowed === true,
  };
}

export function parseMyDevices(raw: unknown): MyDevice[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const r = item as Record<string, unknown>;
    return {
      id: String(r.id),
      label: String(r.label ?? "Thiết bị"),
      kind: (["phone", "tablet", "computer"].includes(String(r.kind)) ? r.kind : "unknown") as DeviceKind,
      rank: r.rank === 1 ? 1 : r.rank === 2 ? 2 : 3,
      guest: r.guest === true,
      lastSeenAt: String(r.last_seen_at ?? ""),
      isMe: r.is_me === true,
      lostStatus: r.lost_status === "pending" || r.lost_status === "rejected" || r.lost_status === "found" ? r.lost_status : null,
      lostDeadline: typeof r.lost_deadline === "string" ? r.lost_deadline : null,
      canRevoke: r.can_revoke === true,
      canReportLost: r.can_report_lost === true,
      canOpenVault: r.can_open_vault === true,
    };
  });
}

/** Vietnamese for the device RPC errors; codes only reach the log. */
export function deviceErrorMessage(message: string): string {
  if (message.includes("avora_device_password")) return "Mật khẩu tài khoản chưa đúng.";
  if (message.includes("avora_password_check_rate")) return "Thử sai nhiều lần. Đợi 15 phút rồi thử lại.";
  if (message.includes("avora_device_code")) return "Mã email chưa đúng hoặc đã hết hạn.";
  if (message.includes("avora_device_rate")) return "Đã gửi mã nhiều lần. Đợi một lúc rồi thử lại.";
  if (message.includes("avora_device_revoke_rank")) return "Máy này không có quyền ngắt máy kia.";
  if (message.includes("avora_device_lock_rank")) return "Chỉ máy Ưu tiên 1 hoặc 2 làm được việc này.";
  if (message.includes("avora_device_lock_owner")) return "Khoá do Ưu tiên 1 bật — chỉ Ưu tiên 1 tắt được.";
  if (message.includes("avora_device_guest")) return "Máy của người khác không đặt làm máy chính được.";
  if (message.includes("avora_device_unbound")) return "Máy này chưa xác nhận xong. Tải lại trang rồi thử lại.";
  if (message.includes("avora_device_lost_settled")) return "Báo mất này đã có kết quả.";
  if (message.includes("avora_device_label")) return "Tên máy dài 1–60 ký tự.";
  if (message.includes("avora_session_not_allowed")) return "Phiên này không còn được dùng.";
  return "Chưa làm được. Thử lại nhé.";
}

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) {
    logError("device", { code: error.code, message: error.message.slice(0, 80) });
    throw new Error(deviceErrorMessage(error.message));
  }
  return data as T;
}

const origin = (): string => window.location.origin;

export const deviceApi = {
  status: async (): Promise<DeviceStatus> => parseDeviceStatus(await call<unknown>("device_status")),
  list: async (): Promise<MyDevice[]> => parseMyDevices(await call<unknown>("list_my_devices")),
  requestRankCode: (rank: 1 | 2) => call<null>("request_rank_claim_code", { p_rank: rank }),
  setRank: (rank: 1 | 2, password: string, emailCode: string | null) =>
    call<{ rank: number; took_from: string | null }>("set_device_rank", { p_rank: rank, p_password: password, p_email_code: emailCode, p_origin: origin() }),
  rename: (id: string, label: string) => call<null>("rename_device", { p_device: id, p_label: label }),
  revoke: (id: string) => call<null>("revoke_device", { p_device: id }),
  reportLost: (id: string, days: 3 | 7, password: string) =>
    call<string>("report_device_lost", { p_device: id, p_days: days, p_password: password, p_origin: origin() }),
  dispute: (password: string) => call<null>("lost_device_dispute", { p_password: password }),
  setLock: (on: boolean, password: string) => call<null>("set_device_lock", { p_on: on, p_password: password }),
  requestEscape: (password: string) => call<string>("request_lock_escape", { p_password: password, p_origin: origin() }),
  cancelEscape: () => call<null>("cancel_lock_escape"),
  setVaultOther: (on: boolean, password: string) => call<null>("set_vault_other_devices_allowed", { p_on: on, p_password: password }),
  forgetGuest: async (): Promise<void> => {
    if (!isGuestMachine() || memoryDevice === null) return;
    await call<null>("forget_this_device", { p_device_id: memoryDevice.deviceId }).catch(() => undefined);
  },
};

/** Subscribers run when this device is removed or reported lost (AVORA-68 wipes its vault wrap here). */
const revokedHooks = new Set<() => Promise<void> | void>();
export function onDeviceRevoked(hook: () => Promise<void> | void): () => void {
  revokedHooks.add(hook);
  return () => revokedHooks.delete(hook);
}
export async function runDeviceRevokedHooks(): Promise<void> {
  for (const hook of revokedHooks) await Promise.resolve(hook()).catch(() => undefined);
}

/** S4: ask the browser not to evict AVORA's storage (keeps the device key on iPhone Safari longer). */
export async function askPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** S4: iPhone Safari in a normal tab (not added to the Home Screen) clears unused site data after 7 days. */
export function isIosSafariTab(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return /iPhone|iPad/i.test(navigator.userAgent) && nav.standalone !== true && !window.matchMedia("(display-mode: standalone)").matches;
}
