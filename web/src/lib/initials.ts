/** Two-letter initials used by the avatar component. */
export function initialsOf(nameOrEmail: string): string {
  const trimmed = nameOrEmail.trim();
  if (trimmed.length === 0) return "?";
  if (trimmed.includes("@")) return trimmed.slice(0, 2).toUpperCase();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Falls back through display name → email handle → a neutral label. */
export function peerLabel(displayName: string | null, email: string | null): string {
  const name = displayName?.trim();
  if (name && name.length > 0) return name;
  const address = email?.trim();
  if (address && address.length > 0) return address.split("@")[0];
  return "Người dùng AVORA";
}
