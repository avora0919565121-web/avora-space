/**
 * AVORA-51 · B3 — the signed-in account's own email and phone, shown only by their ends.
 * One place for the rule so every screen hides the same way. Not for Liên hệ: those are the
 * person's address book and must stay readable to call or write.
 */

const DOTS = "•••";

/** `vo.thanh@outlook.com` → `vo•••h@o•••k.com`. Short parts keep only their first character. */
export function maskEmail(email: string | null | undefined): string {
  const value = (email ?? "").trim();
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return value === "" ? "" : `${value.slice(0, 1)}${DOTS}`;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);

  const maskedLocal = local.length <= 3 ? `${local.slice(0, 1)}${DOTS}` : `${local.slice(0, 2)}${DOTS}${local.slice(-1)}`;

  const dot = domain.indexOf(".");
  const name = dot > 0 ? domain.slice(0, dot) : domain;
  const rest = dot > 0 ? domain.slice(dot) : "";
  const maskedName = name.length <= 2 ? `${name.slice(0, 1)}${DOTS}` : `${name.slice(0, 1)}${DOTS}${name.slice(-1)}`;

  return `${maskedLocal}@${maskedName}${rest}`;
}

/** `0912345121` → `091•••121`; a leading `+` counts as part of the first three characters. */
export function maskPhone(phone: string | null | undefined): string {
  const compact = (phone ?? "").replace(/[^\d+]/g, "");
  if (compact === "") return "";
  const digits = compact.replace(/\D/g, "");
  if (digits.length < 7) return `${compact.slice(0, 1)}${DOTS}`;
  return `${compact.slice(0, 3)}${DOTS}${compact.slice(-3)}`;
}
