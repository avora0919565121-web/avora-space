import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/lib/log";
import { currentSubscription } from "@/lib/push";

/**
 * 111-A (ADR-092) · Xoá tài khoản.
 *
 * Asking is three steps on the server: prove it is you (account password, or a 6-digit code by
 * email when the password is forgotten — never the PIN or the Két sắt code), then ask. The proof
 * lasts 5 minutes and is spent by the request. The account is then deleted after the grace period
 * (14 days) unless `Giữ tài khoản` is pressed; signing in alone never cancels it.
 */

export type DeletionState = "none" | "pending" | "cancelled" | "done";

export type DeletionStatus = {
  status: DeletionState;
  graceDays: number;
  requestedAt: string | null;
  executeAfter: string | null;
  method: "password" | "otp" | null;
};

export const accountDeletionKeys = {
  status: (userId: string) => ["account-deletion", userId] as const,
};

/** The word typed in the last step. Letters only, so no Vietnamese keyboard trouble. */
export const CONFIRM_WORD = "XOA";

/** `xoa`, ` XOA ` → yes; `XOÁ`, `XO A`, `DELETE` → no. Case is forgiven, the word is not. */
export function isConfirmWord(input: string): boolean {
  return input.trim().toUpperCase() === CONFIRM_WORD;
}

/** What goes, said plainly — the list on the confirmation screen (ADR-020: nothing beyond what is true). */
export const DELETION_LOSES: readonly string[] = [
  "Hồ sơ, ảnh đại diện, email đăng nhập và mọi phiên đăng nhập.",
  "Nhật ký, ghi chú, nhiệm vụ riêng, thói quen, Kế hoạch, Sách, Tài chính và tệp bạn đã tải lên.",
  "Két sắt mất vĩnh viễn, kể cả khi bạn nhớ mật khẩu Két sắt.",
  "Mã PIN của bạn không bao giờ được cấp lại cho ai — kể cả bạn nếu tạo tài khoản mới.",
  "Danh bạ, kết nối và nhóm bạn đang tham gia. Nhóm do bạn làm chủ được giao cho thành viên lâu nhất.",
];

/** What stays with other people. */
export const DELETION_KEEPS: readonly string[] = [
  "Tin nhắn chữ bạn đã gửi trong cuộc trò chuyện chung vẫn còn với người kia, hiện tên “Người dùng đã xoá”. Muốn xoá hẳn tin nào, hãy thu hồi nó trước khi xoá tài khoản.",
  "Tệp đính kèm trong tin của bạn bị xoá cùng tài khoản.",
];

export function parseDeletionStatus(raw: unknown): DeletionStatus {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const status: DeletionState =
    r.status === "pending" || r.status === "cancelled" || r.status === "done" ? r.status : "none";
  return {
    status,
    graceDays: typeof r.grace_days === "number" ? r.grace_days : 14,
    requestedAt: typeof r.requested_at === "string" ? r.requested_at : null,
    executeAfter: typeof r.execute_after === "string" ? r.execute_after : null,
    method: r.method === "password" || r.method === "otp" ? r.method : null,
  };
}

/** `25/11/2026` in the viewer's own zone. */
export function formatDeletionDate(iso: string | null, timeZone?: string): string {
  if (iso === null) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone }).format(date);
}

/** Whole days left, rounded up (a request made today reads 14, the last day reads 1). */
export function daysUntil(iso: string | null, now: number = Date.now()): number {
  if (iso === null) return 0;
  const ms = new Date(iso).getTime() - now;
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** Vietnamese for the deletion RPC errors; codes only reach the log. */
export function deletionErrorMessage(message: string): string {
  if (message.includes("avora_password_check_rate")) return "Thử sai nhiều lần. Đợi 15 phút rồi thử lại.";
  if (message.includes("avora_account_otp_rate")) return "Đã gửi mã 3 lần trong một giờ. Đợi một lúc rồi thử lại.";
  if (message.includes("avora_account_reauth_required")) return "Phần xác nhận đã quá 5 phút. Nhập lại mật khẩu hoặc mã nhé.";
  if (message.includes("avora_account_no_email")) return "Tài khoản chưa có email để nhận mã.";
  if (message.includes("avora_feature_off")) return "Tạm thời chưa xoá tài khoản được. Thử lại sau nhé.";
  if (message.includes("avora_session_not_allowed")) return "Phiên này không còn được dùng.";
  return "Chưa làm được. Thử lại nhé.";
}

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) {
    logError("account-deletion", { code: error.code, message: error.message.slice(0, 80) });
    throw new Error(deletionErrorMessage(error.message));
  }
  return data as T;
}

export type OtpResult = { ok: true } | { ok: false; reason: "wrong" | "expired" };

export const accountDeletionApi = {
  status: async (): Promise<DeletionStatus> => parseDeletionStatus(await call<unknown>("account_deletion_status")),
  /** true = the password was right; the proof now lasts 5 minutes. */
  reauthPassword: (password: string) => call<boolean>("account_reauth_password", { p_password: password }),
  /** Sends the code; returns the masked address it went to. */
  requestOtp: async (): Promise<{ to: string }> => {
    const r = await call<{ to?: unknown }>("account_request_otp");
    return { to: typeof r?.to === "string" ? r.to : "email của bạn" };
  },
  verifyOtp: async (code: string): Promise<OtpResult> => {
    const r = await call<{ ok?: unknown; reason?: unknown }>("account_verify_otp", { p_code: code.trim() });
    if (r?.ok === true) return { ok: true };
    return { ok: false, reason: r?.reason === "expired" ? "expired" : "wrong" };
  },
  /** This device already knows; the push goes to every other one. */
  request: async (): Promise<{ executeAfter: string | null; repeated: boolean }> => {
    const here = await currentSubscription().catch(() => null);
    const r = await call<{ execute_after?: unknown; repeated?: unknown }>("request_account_deletion", {
      p_except_endpoint: here?.endpoint ?? null,
    });
    return { executeAfter: typeof r?.execute_after === "string" ? r.execute_after : null, repeated: r?.repeated === true };
  },
  cancel: async (): Promise<boolean> => {
    const r = await call<{ status?: unknown }>("cancel_account_deletion");
    return r?.status === "cancelled";
  },
};

/**
 * The full-screen notice shows once per sign-in: `Tiếp tục xoá` puts it away until the next sign-in
 * (a new `last_sign_in_at`), not forever and not just until the next screen.
 */
export function gateAckKey(userId: string, lastSignInAt: string | null | undefined): string {
  return `avora.account-deletion.ack.${userId}.${lastSignInAt ?? "?"}`;
}

export function readGateAck(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "1" || localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeGateAck(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* private mode: the notice simply shows again */
  }
}
