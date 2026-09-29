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
