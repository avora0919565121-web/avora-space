import { describe, expect, it } from "vitest";

import { isActionableResendError, isEmailNotConfirmed, toVietnameseError } from "@/lib/auth-errors";

/**
 * Every string below was captured from the live Supabase project, not invented — so these
 * tests fail if the app ever stops recognising what the server actually says.
 */
describe("toVietnameseError", () => {
  it("explains a wrong password", () => {
    expect(toVietnameseError("Invalid login credentials")).toBe("Email hoặc mật khẩu không đúng.");
  });

  it("explains an account that has not confirmed its email", () => {
    expect(toVietnameseError("Email not confirmed")).toBe(
      "Email chưa được xác nhận. Kiểm tra hộp thư của bạn.",
    );
  });

  it("explains a rejected address", () => {
    // Real response: {"error_code":"email_address_invalid","msg":"Email address \"x@y.test\" is invalid"}
    expect(toVietnameseError('Email address "avora-probe@inbox-probe.test" is invalid')).toBe(
      "Địa chỉ email không hợp lệ.",
    );
  });

  it("does not blame the person when the project's mail quota is exhausted", () => {
    // Real response: {"error_code":"over_email_send_rate_limit","msg":"email rate limit exceeded"}
    expect(toVietnameseError("email rate limit exceeded")).toBe(
      "Hệ thống chưa gửi được email lúc này. Vui lòng thử lại sau khoảng một giờ.",
    );
  });

  it("asks for a short wait on the per-address cooldown", () => {
    expect(toVietnameseError("For security purposes, you can only request this after 51 seconds.")).toBe(
      "Vui lòng đợi một lát rồi thử lại.",
    );
  });

  it("still handles a generic too-many-requests failure", () => {
    expect(toVietnameseError("Too many requests")).toBe(
      "Bạn thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.",
    );
  });

  it("explains an expired or reused reset link", () => {
    expect(toVietnameseError("Email link is invalid or has expired")).toBe(
      "Liên kết đã hết hạn hoặc đã được dùng. Hãy yêu cầu gửi lại email.",
    );
  });

  it("explains a reused password", () => {
    expect(toVietnameseError("New password should be different from the old password.")).toBe(
      "Mật khẩu mới phải khác mật khẩu cũ.",
    );
  });

  it("explains a lost connection", () => {
    expect(toVietnameseError("Failed to fetch")).toBe(
      "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.",
    );
  });

  it("falls back to a plain message for anything unrecognised", () => {
    // Real response seen while probing: a server-side failure with no user-facing cause.
    expect(toVietnameseError("Database error querying schema")).toBe("Có lỗi xảy ra. Vui lòng thử lại.");
  });
});

describe("isEmailNotConfirmed", () => {
  it("recognises the unconfirmed sign-in failure so the resend button can appear", () => {
    expect(isEmailNotConfirmed("Email not confirmed")).toBe(true);
  });

  it("does not fire on a wrong password", () => {
    expect(isEmailNotConfirmed("Invalid login credentials")).toBe(false);
  });
});

describe("isActionableResendError", () => {
  it("surfaces the mail quota failure", () => {
    expect(isActionableResendError("email rate limit exceeded")).toBe(true);
  });

  it("surfaces a lost connection", () => {
    expect(isActionableResendError("Failed to fetch")).toBe(true);
  });

  it("stays silent on anything that would reveal whether an account exists", () => {
    expect(isActionableResendError("User not found")).toBe(false);
    expect(isActionableResendError("Email address already confirmed")).toBe(false);
  });
});
