let publish: (() => void) | null = null;

/** AVORA-115 · 4: the one way in to change one's own picture — Hồ sơ, and one's own person card. */
export function openAvatarEditor(): void {
  publish?.();
}

/** The editor host registers itself here (one host for every signed-in screen). */
export function registerAvatarEditor(open: (() => void) | null): void {
  publish = open;
}
