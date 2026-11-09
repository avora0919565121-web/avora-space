// LOI-14 · test accounts must never cause a real email. Mail to these domains is skipped (200,
// "skipped": "test_domain"): Resend counts every bounce against avorachat.com, and a bad bounce
// rate sends the real OTP mails to spam. One list, used by vault-mail; unit-tested in web/src/test.
export const TEST_MAIL_DOMAINS: readonly string[] = ["avora.com", "example.com", "example.net", "example.org"];
export const TEST_MAIL_SUFFIXES: readonly string[] = [".test", ".invalid", ".example", ".localhost"];

export function isTestMailAddress(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  if (domain === "") return false;
  if (TEST_MAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  return TEST_MAIL_SUFFIXES.some((suffix) => domain.endsWith(suffix) || domain === suffix.slice(1));
}
