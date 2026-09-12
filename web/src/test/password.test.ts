import { describe, expect, it } from "vitest";

import { readRecoveryLinkError, validateNewPassword } from "@/lib/password";

describe("validateNewPassword", () => {
  it("accepts a long enough matching pair", () => {
    expect(validateNewPassword("matkhaumoi", "matkhaumoi")).toBeNull();
  });

  it("rejects an empty password", () => {
    expect(validateNewPassword("", "")).toBe("Vui lòng nhập mật khẩu mới.");
  });

  it("rejects a password below the server minimum", () => {
    expect(validateNewPassword("abc", "abc")).toBe("Mật khẩu cần ít nhất 6 ký tự.");
  });

  it("asks for the confirmation before comparing", () => {
    expect(validateNewPassword("matkhaumoi", "")).toBe("Vui lòng nhập lại mật khẩu mới.");
  });

  it("rejects a mismatched confirmation", () => {
    expect(validateNewPassword("matkhaumoi", "matkhaucu")).toBe("Hai mật khẩu chưa khớp.");
  });

  it("treats whitespace as a real character instead of trimming it away", () => {
    // Trimming here would save a password the user could never type back.
    expect(validateNewPassword(" matkhau ", " matkhau ")).toBeNull();
    expect(validateNewPassword(" matkhau ", "matkhau")).not.toBeNull();
  });
});

describe("readRecoveryLinkError", () => {
  it("returns null for a link with no error params", () => {
    expect(readRecoveryLinkError("#access_token=abc&type=recovery", "")).toBeNull();
    expect(readRecoveryLinkError("", "")).toBeNull();
  });

  it("explains an expired link from the URL fragment", () => {
    const message = readRecoveryLinkError(
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      "",
    );
    expect(message).toBe("Liên kết đã hết hạn. Hãy yêu cầu gửi lại email đặt lại mật khẩu.");
  });

  it("reads the same failure from the query string (PKCE flow)", () => {
    const message = readRecoveryLinkError("", "?error=access_denied&error_code=otp_expired");
    expect(message).toBe("Liên kết đã hết hạn. Hãy yêu cầu gửi lại email đặt lại mật khẩu.");
  });

  it("reports an already-used or invalid link", () => {
    expect(readRecoveryLinkError("#error=access_denied", "")).toBe(
      "Liên kết không hợp lệ hoặc đã được dùng. Hãy yêu cầu gửi lại email.",
    );
  });

  it("falls back to a generic message for an unknown error code", () => {
    expect(readRecoveryLinkError("#error_code=server_error", "")).toBe(
      "Không mở được liên kết đặt lại mật khẩu. Hãy yêu cầu gửi lại email.",
    );
  });

  it("tolerates fragments and queries without their leading marker", () => {
    expect(readRecoveryLinkError("error_code=otp_expired", "")).not.toBeNull();
    expect(readRecoveryLinkError("", "error_code=otp_expired")).not.toBeNull();
  });
});
