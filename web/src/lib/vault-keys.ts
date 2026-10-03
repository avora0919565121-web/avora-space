import { supabase } from "@/integrations/supabase/client";
import { deviceStoreGet, deviceStorePut, onDeviceRevoked, thisDeviceId } from "@/lib/device";
import { logError } from "@/lib/log";
import {
  createKeyring,
  DEFAULT_KDF,
  fromB64,
  hkdf,
  importAesKey,
  newDeviceKey,
  passProofFor,
  recProofFor,
  rewrapForPassphrase,
  rewrapForRecovery,
  sectionKey,
  unwrapFromDevice,
  unwrapWithPassphrase,
  unwrapWithRecovery,
  wipe,
  wrapForDevice,
  type KdfParams,
  type KeyringWire,
  type VaultSection,
} from "@/lib/vault-crypto";

/**
 * AVORA-68 · the master key in memory only (never storage, logs, React Query or the service worker),
 * plus the double-wrapped copy kept on this device (2.3). Dropped on lock, 5 minutes away, reload,
 * sign-out and onDeviceRevoked.
 */

export type Keyring = KeyringWire & { kit_confirmed_at: string | null };

let mk: Uint8Array | null = null;
let mkKey: CryptoKey | null = null;
const sectionKeys = new Map<VaultSection, CryptoKey>();
const listeners = new Set<() => void>();
/** The server share handed back by the last right code — held only until the device wrap is opened. */
let pendingShare: Uint8Array | null = null;

const WRAP_RECORD = (userId: string): string => `vault-wrap:${userId}`;
const KD_RECORD = (userId: string): string => `vault-kd:${userId}`;

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeVaultKeys(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasMasterKey(): boolean {
  return mk !== null;
}

export function clearVaultKeys(): void {
  wipe(mk);
  wipe(pendingShare);
  mk = null;
  mkKey = null;
  pendingShare = null;
  sectionKeys.clear();
  emit();
}

/** Set by vault_unlock (right code on a bound device). */
export function rememberShare(shareB64: string | null): void {
  wipe(pendingShare);
  pendingShare = shareB64 === null ? null : fromB64(shareB64);
}

async function holdMasterKey(raw: Uint8Array): Promise<void> {
  wipe(mk);
  mk = raw;
  mkKey = await importAesKey(raw);
  sectionKeys.clear();
  emit();
}

function vaultError(message: string): Error {
  if (message.includes("avora_vault_proof_rate")) return new Error("Thử sai nhiều lần. Đợi 15 phút rồi thử lại.");
  if (message.includes("avora_vault_pass_required")) return new Error("Nhập Mật khẩu Két sắt trước.");
  if (message.includes("avora_vault_locked")) return new Error("Két sắt đã khoá. Mở lại để tiếp tục.");
  if (message.includes("avora_device_password")) return new Error("Mật khẩu tài khoản chưa đúng.");
  if (message.includes("avora_device_code")) return new Error("Mã email chưa đúng hoặc đã hết hạn.");
  if (message.includes("avora_vault_ring_exists")) return new Error("Két sắt đã được mã hoá trên tài khoản này.");
  return new Error("Chưa làm được. Thử lại nhé.");
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) {
    logError("vault-e2ee", { code: error.code, message: error.message.slice(0, 80) });
    throw vaultError(error.message);
  }
  return data as T;
}

export async function fetchKeyring(): Promise<Keyring | null> {
  return rpc<Keyring | null>("vault_keyring_get");
}

/** Keeps the device wrap: KD (non-exportable, IndexedDB) + MK wrapped by KEK_dev then KD. */
async function registerThisDevice(userId: string): Promise<void> {
  if (mk === null) return;
  const deviceId = await thisDeviceId();
  const shareB64 = await rpc<string>("vault_register_device_share", { p_device_id: deviceId });
  const share = fromB64(shareB64);
  let kd = await deviceStoreGet<CryptoKey>(KD_RECORD(userId)).catch(() => undefined);
  if (kd === undefined) {
    kd = await newDeviceKey();
    await deviceStorePut(KD_RECORD(userId), kd);
  }
  await deviceStorePut(WRAP_RECORD(userId), await wrapForDevice(userId, deviceId, mk, share, kd));
  wipe(share);
}

/** After a right 6-digit code: opens MK from the device wrap with the share the server just handed back. */
export async function openWithDeviceShare(userId: string): Promise<boolean> {
  if (mk !== null) return true;
  if (pendingShare === null) return false;
  try {
    const [wrap, kd, deviceId] = await Promise.all([
      deviceStoreGet<string>(WRAP_RECORD(userId)),
      deviceStoreGet<CryptoKey>(KD_RECORD(userId)),
      thisDeviceId(),
    ]);
    if (wrap === undefined || kd === undefined) return false;
    await holdMasterKey(await unwrapFromDevice(userId, deviceId, wrap, pendingShare, kd));
    return true;
  } catch {
    return false;
  } finally {
    wipe(pendingShare);
    pendingShare = null;
  }
}

export async function hasDeviceWrap(userId: string): Promise<boolean> {
  return (await deviceStoreGet<string>(WRAP_RECORD(userId)).catch(() => undefined)) !== undefined;
}

/** Creates the keyring (after the kit was asked back) and binds this device. */
export async function setupVault(userId: string, passphrase: string, entropy: Uint8Array, params: KdfParams = DEFAULT_KDF): Promise<void> {
  const ring = await createKeyring(userId, passphrase, entropy, params);
  await rpc<null>("vault_setup", { p_ring: ring.wire, p_pass_proof: ring.passProof, p_rec_proof: ring.recProof });
  await holdMasterKey(ring.mk);
  await registerThisDevice(userId);
}

/** `Mở Két sắt trên máy này` with the passphrase. */
export async function openWithPassphrase(userId: string, ring: Keyring, passphrase: string): Promise<void> {
  const proof = await passProofFor(passphrase, ring.salt_pass, ring.kdf_params);
  const ok = await rpc<boolean>("vault_prove", { p_kind: "pass", p_proof: proof });
  if (!ok) throw new Error("Mật khẩu Két sắt chưa đúng.");
  await holdMasterKey(await unwrapWithPassphrase(userId, passphrase, ring.salt_pass, ring.kdf_params, ring.mk_wrapped_pass));
  await registerThisDevice(userId).catch((error: unknown) => logError("vault-e2ee", error));
}

/** The 24 words open MK; the caller then sets a new passphrase and a new kit (4.3). */
export async function openWithRecovery(userId: string, ring: Keyring, entropy: Uint8Array): Promise<void> {
  const { proof, check } = await recProofFor(entropy, ring.salt_rec);
  if (check !== ring.rec_check) throw new Error("Bộ khôi phục chưa đúng — đây là một bộ khác.");
  const ok = await rpc<boolean>("vault_prove", { p_kind: "rec", p_proof: proof });
  if (!ok) throw new Error("Bộ khôi phục chưa đúng.");
  await holdMasterKey(await unwrapWithRecovery(userId, entropy, ring.salt_rec, ring.mk_wrapped_rec));
}

/** Proves the passphrase only (Quên mã 6 số on an encrypted account). */
export async function provePassphrase(ring: Keyring, passphrase: string): Promise<void> {
  const ok = await rpc<boolean>("vault_prove", { p_kind: "pass", p_proof: await passProofFor(passphrase, ring.salt_pass, ring.kdf_params) });
  if (!ok) throw new Error("Mật khẩu Két sắt chưa đúng.");
}

export async function changePassphrase(userId: string, passphrase: string): Promise<void> {
  if (mk === null) throw new Error("Két sắt đã khoá. Mở lại để tiếp tục.");
  const next = await rewrapForPassphrase(userId, mk, passphrase);
  await rpc<null>("vault_change_passphrase", { p_wrapped: next.wrapped, p_salt: next.salt, p_params: next.params, p_proof: next.proof });
}

export async function rotateRecovery(userId: string, entropy: Uint8Array): Promise<void> {
  if (mk === null) throw new Error("Két sắt đã khoá. Mở lại để tiếp tục.");
  const next = await rewrapForRecovery(userId, mk, entropy);
  await rpc<null>("vault_rotate_recovery", { p_wrapped: next.wrapped, p_salt: next.salt, p_check: next.check, p_proof: next.proof });
  await registerThisDevice(userId).catch((error: unknown) => logError("vault-e2ee", error));
}

export async function resetCodeByPassphrase(code: string): Promise<void> {
  await rpc<null>("vault_reset_code_by_passphrase", { p_new_code: code });
}

export async function resetEverything(userId: string, password: string, emailCode: string): Promise<void> {
  await rpc<null>("vault_reset_everything", { p_password: password, p_email_code: emailCode });
  clearVaultKeys();
  await forgetDeviceWrap(userId);
}

export async function forgetDeviceWrap(userId: string): Promise<void> {
  await deviceStorePut(WRAP_RECORD(userId), undefined).catch(() => undefined);
}

/**
 * AVORA-81 · 78.8 — the key that seals my private notes on Két sắt view boards. Derived from the
 * master key (never stored); null while the vault is closed or never set up.
 */
export async function viewNoteKey(userId: string): Promise<CryptoKey | null> {
  if (mk === null) return null;
  const raw = await hkdf(mk, new TextEncoder().encode(`avora-view-note|${userId}`), "avora-view-note-v1");
  const key = await importAesKey(raw);
  wipe(raw);
  return key;
}

/** SK of one section, opened once per unlock. */
export async function keyForSection(userId: string, ring: Keyring, section: VaultSection): Promise<CryptoKey> {
  if (mkKey === null) throw new Error("Két sắt đã khoá. Mở lại để tiếp tục.");
  const cached = sectionKeys.get(section);
  if (cached !== undefined) return cached;
  const wrapped = ring.section_keys[section];
  if (wrapped === undefined) throw new Error("vault_section_missing");
  const key = await sectionKey(userId, mkKey, section, wrapped);
  sectionKeys.set(section, key);
  return key;
}

// A device removed or reported lost (67) forgets its vault wrap here.
onDeviceRevoked(async () => {
  clearVaultKeys();
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (userId !== undefined) {
      await deviceStorePut(WRAP_RECORD(userId), undefined);
      await deviceStorePut(KD_RECORD(userId), undefined);
    }
  } catch {
    // Already gone.
  }
});

// A reload drops everything in memory by itself; a page hide on iOS should too.
if (typeof window !== "undefined") window.addEventListener("pagehide", () => clearVaultKeys());
