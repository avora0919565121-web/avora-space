/**
 * AVORA-51 · Khoá Két sắt (ADR-034) — the pure half: parsing what the server says, the words the
 * lock speaks, and the timings. The lock itself lives on the server (RLS + every Két sắt RPC);
 * nothing here decides access, it only explains it.
 */

/** A Két sắt code is exactly six digits. Called "mã Két sắt", never "PIN" (that is the user PIN `A-…`). */
export const VAULT_CODE_LENGTH = 6;

/** Leaving Két sắt for longer than this locks it again (the server lets an unlock lapse after the same). */
export const VAULT_IDLE_MS = 5 * 60 * 1000;

/** How often an open Két sắt tells the server it is still in use. Well under the 5 minutes. */
export const VAULT_TOUCH_MS = 60 * 1000;

export type VaultStatus = {
  hasCode: boolean;
  /** Whether the Két sắt already holds anything — decides if the "khoá cửa" note comes first. */
  hasData: boolean;
  unlocked: boolean;
  expiresAt: string | null;
  /** Set while too many wrong codes make the person wait. */
  lockedUntil: string | null;
  /** Tries left before the next wait. */
  remaining: number;
};

export type VaultAttempt =
  | { ok: true }
  | { ok: false; reason: "wrong"; remaining: number }
  | { ok: false; reason: "wait"; lockedUntil: string }
  | { ok: false; reason: "expired" };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Reads `vault_status()`; anything malformed reads as locked, never as open. */
export function parseVaultStatus(raw: unknown): VaultStatus {
  const row = record(raw);
  return {
    hasCode: row.has_code === true,
    hasData: row.has_data === true,
    unlocked: row.unlocked === true,
    expiresAt: text(row.expires_at),
    lockedUntil: text(row.locked_until),
    remaining: typeof row.remaining === "number" ? Math.max(0, row.remaining) : 5,
  };
}

/** Reads the answer of `vault_unlock`, `vault_change_code` and `vault_confirm_reset`. */
export function parseVaultAttempt(raw: unknown): VaultAttempt {
  const row = record(raw);
  if (row.ok === true) return { ok: true };
  if (row.reason === "wait") return { ok: false, reason: "wait", lockedUntil: text(row.locked_until) ?? new Date().toISOString() };
  if (row.reason === "expired") return { ok: false, reason: "expired" };
  return { ok: false, reason: "wrong", remaining: typeof row.remaining === "number" ? Math.max(0, row.remaining) : 0 };
}

export function isVaultCode(value: string): boolean {
  return new RegExp(`^[0-9]{${VAULT_CODE_LENGTH}}$`).test(value);
}

/** Keeps only digits, at most six — what the keypad and a pasted code both go through. */
export function cleanVaultCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, VAULT_CODE_LENGTH);
}

/** `mm:ss` until the wait is over; "00:00" once it is. */
export function waitLeft(lockedUntil: string, now: number): string {
  const ms = Math.max(0, new Date(lockedUntil).getTime() - now);
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Whether coming back to Két sắt after `leftAt` must ask for the code again. */
export function leftTooLong(leftAt: number | null, now: number): boolean {
  return leftAt !== null && now - leftAt > VAULT_IDLE_MS;
}

export function wrongCodeLine(remaining: number): string {
  return remaining > 0 ? `Mã chưa đúng. Còn ${remaining} lần thử.` : "Mã chưa đúng.";
}

export function waitLine(lockedUntil: string, now: number): string {
  return `Thử lại sau ${waitLeft(lockedUntil, now)}.`;
}

/** Server errors of the lock, said plainly. */
export function vaultErrorMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("avora_vault_code_format")) return "Mã Két sắt gồm đúng 6 chữ số.";
  if (m.includes("avora_vault_code_exists")) return "Két sắt đã có mã. Mở bằng mã đó, hoặc chọn Quên mã?";
  if (m.includes("avora_vault_no_code")) return "Két sắt chưa có mã. Đặt mã trước nhé.";
  if (m.includes("avora_vault_reset_rate")) return "Bạn đã xin mã 3 lần trong một giờ qua. Thử lại sau nhé.";
  if (m.includes("avora_vault_no_email")) return "Tài khoản chưa có email để gửi mã xác nhận.";
  if (m.includes("avora_vault_no_session")) return "Phiên đăng nhập không hợp lệ. Đăng nhập lại nhé.";
  if (m.includes("avora_vault_locked")) return "Két sắt đã khoá. Mở lại để tiếp tục.";
  if (m.includes("failed to fetch") || m.includes("network")) return "Không kết nối được. Kiểm tra mạng rồi thử lại.";
  return "Chưa làm được. Thử lại nhé.";
}

/** The sentence under "Đặt mã Két sắt" (AVORA-51 · B). */
export const VAULT_SET_HINT = "Mã này khoá Két sắt trên máy này và mọi máy khác. Quên mã thì đặt lại được qua email.";

/**
 * AVORA-51 · B2 — said exactly as written, never shortened, never dressed up (ADR-020, ADR-034).
 * These are the only places the word "mã hoá" may appear in Két sắt.
 */
export const VAULT_ABOUT = {
  title: "Khoá Két sắt là khoá cửa, chưa phải két mã hoá.",
  lines: [
    "Mã này ngăn người cầm máy của bạn (hoặc một máy khác đang đăng nhập tài khoản của bạn) mở Két sắt.",
    "Nếu ai đó chiếm được cả tài khoản lẫn email của bạn, họ có thể đặt lại mã này.",
    "AVORA đang xây phần mã hoá thật cho Két sắt. Khi có, chúng tôi sẽ báo và cách đặt lại mã sẽ thay đổi.",
  ],
} as const;

/** Whether this person has already read the B2 note on this device (only asked once before setting a code). */
export function introKey(userId: string): string {
  return `avora.vault.intro.${userId}`;
}

export function readIntroSeen(userId: string): boolean {
  try {
    return window.localStorage.getItem(introKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function writeIntroSeen(userId: string): void {
  try {
    window.localStorage.setItem(introKey(userId), "1");
  } catch {
    // Private mode: the note simply shows again next time.
  }
}
