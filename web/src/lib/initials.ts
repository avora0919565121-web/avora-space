/** Two-letter initials used by the avatar component. */
export function initialsOf(nameOrEmail: string): string {
  const trimmed = nameOrEmail.trim();
  if (trimmed.length === 0) return "?";
  if (trimmed.includes("@")) return trimmed.slice(0, 2).toUpperCase();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** The neutral name shown when someone has not set one. Never derived from their email. */
export const FALLBACK_PEER_NAME = "Người dùng AVORA";

/** A person's display name, or the neutral label — an email address is never used as a name. */
export function peerLabel(displayName: string | null): string {
  const name = displayName?.trim();
  if (name && name.length > 0) return name;
  return FALLBACK_PEER_NAME;
}

/**
 * 111-A (ADR-092): a sender whose account was deleted. The server sets `messages.sender_id` to
 * null; the client maps that to this one id so every `senderId === me` check stays a plain string
 * comparison, and every place that names a person says the same thing — never "Người dùng AVORA"
 * (someone who has not set a name) and never "Thành viên" (a role).
 */
export const DELETED_USER_ID = "00000000-0000-0000-0000-000000000000";
export const DELETED_USER_NAME = "Người dùng đã xoá";

export function isDeletedUser(userId: string | null | undefined): boolean {
  return userId === null || userId === undefined || userId === DELETED_USER_ID;
}

/** A sender id as the server sends it (null once the account is gone) → the id the client keeps. */
export function senderIdOf(raw: string | null | undefined): string {
  return raw === null || raw === undefined || raw === "" ? DELETED_USER_ID : raw;
}

/** The name for someone in a shared room: their known name, the deleted label, or the neutral fallback. */
export function memberNameOf(names: ReadonlyMap<string, string>, userId: string | null | undefined, fallback: string = FALLBACK_PEER_NAME): string {
  if (isDeletedUser(userId)) return DELETED_USER_NAME;
  return names.get(userId as string) ?? fallback;
}

/**
 * QA01-09: your own name as the app shows it. While the profile is still on its way the answer is
 * "" (the screens hold its place quietly) — never "Bạn" first and the real name a moment later,
 * which made the greeting and the avatar's letters ("BẠ" → "NM") flicker on every cold start.
 * Once the profile is known: its name, or "Bạn" when none is set (never the email — AVORA-51 · B3).
 */
export function ownDisplayName(displayName: string | null | undefined, isProfileLoading: boolean): string {
  const name = displayName?.trim();
  if (name && name.length > 0) return name;
  return isProfileLoading ? "" : "Bạn";
}
