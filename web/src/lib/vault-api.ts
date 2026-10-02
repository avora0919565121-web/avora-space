import { supabase } from "@/integrations/supabase/client";
import { thisDeviceId } from "@/lib/device";
import { rememberShare } from "@/lib/vault-keys";
import { logError } from "@/lib/log";
import { parseVaultAttempt, parseVaultStatus, vaultErrorMessage, type VaultAttempt, type VaultStatus } from "@/lib/vault-lock";

/** AVORA-51 · the Két sắt lock RPCs. Codes never get logged; only error codes do. */

export const vaultKeys = {
  status: (userId: string | undefined) => ["vault", "status", userId ?? "none"] as const,
};

/** Fired by the finance layer when the server refuses because the Két sắt is locked. */
export const VAULT_LOCKED_EVENT = "avora:vault-locked";

export function announceVaultLocked(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(VAULT_LOCKED_EVENT));
}

function fail(error: { code?: string; message: string }): Error {
  logError("vault", { code: error.code, message: error.message.slice(0, 80) });
  return new Error(vaultErrorMessage(error.message));
}

export async function fetchVaultStatus(): Promise<VaultStatus> {
  const { data, error } = await supabase.rpc("vault_status");
  if (error) throw fail(error);
  return parseVaultStatus(data);
}

export async function lockVault(): Promise<void> {
  const { error } = await supabase.rpc("vault_lock");
  if (error) throw fail(error);
}

/** Keeps an open Két sắt open while it is in use; says whether it still is. */
export async function touchVault(): Promise<boolean> {
  const { data, error } = await supabase.rpc("vault_touch");
  if (error) throw fail(error);
  return (data as { unlocked?: unknown } | null)?.unlocked === true;
}

export async function setVaultCode(code: string): Promise<void> {
  const { error } = await supabase.rpc("vault_set_code", { p_code: code });
  if (error) throw fail(error);
}

/** S10: the device id rides along so the server can check the rank (67) and hand back the device share (68). */
export async function unlockVault(code: string): Promise<VaultAttempt> {
  const deviceId = await thisDeviceId().catch(() => null);
  const { data, error } = await supabase.rpc("vault_unlock" as never, { p_code: code, p_device_id: deviceId } as never);
  if (error) throw fail(error);
  // AVORA-68 · 2.3: the server share comes back only on a right code, only for this bound device.
  const share = (data as { share?: unknown } | null)?.share;
  rememberShare(typeof share === "string" ? share : null);
  return parseVaultAttempt(data);
}

export async function changeVaultCode(oldCode: string, newCode: string): Promise<VaultAttempt> {
  const { data, error } = await supabase.rpc("vault_change_code", { p_old: oldCode, p_new: newCode });
  if (error) throw fail(error);
  return parseVaultAttempt(data);
}

export async function requestVaultReset(): Promise<void> {
  const { error } = await supabase.rpc("vault_request_reset");
  if (error) throw fail(error);
}

export async function confirmVaultReset(emailCode: string, newCode: string): Promise<VaultAttempt> {
  const { data, error } = await supabase.rpc("vault_confirm_reset", { p_email_code: emailCode, p_new_code: newCode });
  if (error) throw fail(error);
  return parseVaultAttempt(data);
}

/** Hồ sơ › Hiện đầy đủ: the account password, checked on the server without a new sign-in. */
export async function verifyAccountPassword(password: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("verify_account_password", { p_password: password });
  if (error) {
    if (error.message.includes("avora_password_check_rate")) throw new Error("Bạn đã thử 5 lần. Chờ 15 phút rồi thử lại nhé.");
    throw fail(error);
  }
  return data === true;
}
