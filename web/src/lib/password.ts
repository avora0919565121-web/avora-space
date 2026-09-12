/** Password rules and recovery-link parsing. Pure functions so they can be tested directly. */

/** Matches the minimum Supabase enforces server-side, so the client never promises less. */
export const MIN_PASSWORD_LENGTH = 6;

/**
 * Checks a new password and its confirmation before any network call.
 * Returns a Vietnamese message describing the problem, or null when the pair is usable.
 */
export function validateNewPassword(password: string, confirmation: string): string | null {
  if (password.length === 0) return "Vui lòng nhập mật khẩu mới.";
  if (password.length < MIN_PASSWORD_LENGTH) return `Mật khẩu cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
  if (confirmation.length === 0) return "Vui lòng nhập lại mật khẩu mới.";
  if (password !== confirmation) return "Hai mật khẩu chưa khớp.";
  return null;
}

/**
 * Supabase reports a bad recovery link by redirecting back with error params — in the URL
 * fragment for the implicit flow, in the query string for PKCE. Returns a Vietnamese
 * message when the link failed, or null when it looks usable.
 */
export function readRecoveryLinkError(hash: string, search: string): string | null {
  const fromHash = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const fromSearch = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  const errorCode: string | null =
    fromHash.get("error_code") ??
    fromSearch.get("error_code") ??
    fromHash.get("error") ??
    fromSearch.get("error");
  if (errorCode === null) return null;

  const normalized = errorCode.toLowerCase();
  if (normalized.includes("expired"))
    return "Liên kết đã hết hạn. Hãy yêu cầu gửi lại email đặt lại mật khẩu.";
  if (normalized.includes("access_denied") || normalized.includes("invalid"))
    return "Liên kết không hợp lệ hoặc đã được dùng. Hãy yêu cầu gửi lại email.";
  return "Không mở được liên kết đặt lại mật khẩu. Hãy yêu cầu gửi lại email.";
}
