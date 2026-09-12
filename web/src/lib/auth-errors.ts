/**
 * Maps Supabase auth error messages to short Vietnamese messages.
 *
 * The matched fragments are the exact wording GoTrue returns, captured from the live
 * project rather than guessed — see the sibling tests for the recorded responses.
 */
export function toVietnameseError(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) return "Email hoặc mật khẩu không đúng.";
  if (normalized.includes("email not confirmed")) return "Email chưa được xác nhận. Kiểm tra hộp thư của bạn.";
  if (normalized.includes("user already registered") || normalized.includes("already been registered"))
    return "Email này đã được đăng ký. Hãy đăng nhập.";
  if (normalized.includes("password should be at least")) return "Mật khẩu cần ít nhất 6 ký tự.";

  // A rejected address comes back as: Email address "x@y.test" is invalid
  if (
    normalized.includes("unable to validate email") ||
    normalized.includes("invalid email") ||
    (normalized.includes("email address") && normalized.includes("invalid"))
  )
    return "Địa chỉ email không hợp lệ.";

  // The mail quota belongs to the whole project, so blaming this person for "trying too
  // often" would be wrong — someone else's signup can exhaust it.
  if (normalized.includes("email rate limit") || normalized.includes("email_send_rate_limit"))
    return "Hệ thống chưa gửi được email lúc này. Vui lòng thử lại sau khoảng một giờ.";
  // Per-address cooldown: "For security purposes, you can only request this after 51 seconds."
  if (normalized.includes("for security purposes")) return "Vui lòng đợi một lát rồi thử lại.";
  if (normalized.includes("rate limit") || normalized.includes("too many"))
    return "Bạn thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.";

  // Reset-link specific failures.
  if (normalized.includes("new password should be different") || normalized.includes("same password"))
    return "Mật khẩu mới phải khác mật khẩu cũ.";
  if (
    normalized.includes("token has expired") ||
    normalized.includes("invalid or has expired") ||
    normalized.includes("auth session missing") ||
    normalized.includes("session_not_found")
  )
    return "Liên kết đã hết hạn hoặc đã được dùng. Hãy yêu cầu gửi lại email.";

  if (normalized.includes("failed to fetch")) return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

/** True when the failure means the account exists but has not confirmed its email yet. */
export function isEmailNotConfirmed(message: string): boolean {
  return message.toLowerCase().includes("email not confirmed");
}

/**
 * True when a failed resend is worth showing to the person.
 *
 * Anything else (unknown address, already-confirmed account) stays silent, otherwise the
 * resend button would become a way to check who has an account.
 */
export function isActionableResendError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("rate limit") ||
    normalized.includes("email_send_rate_limit") ||
    normalized.includes("too many") ||
    normalized.includes("for security purposes") ||
    normalized.includes("failed to fetch")
  );
}
