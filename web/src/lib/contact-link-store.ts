import { useSyncExternalStore } from "react";

/**
 * AVORA-117 · what the one link manager is asked to do.
 * - `manage`: a contact already linked — gỡ, or chuyển sang liên hệ khác.
 * - `link-friend`: a friend no contact of mine names yet — gắn với một liên hệ có sẵn.
 */
export type ContactLinkRequest =
  | { kind: "manage"; contactId: string; startAt?: "menu" | "pick" }
  | { kind: "link-friend"; userId: string; avoraName: string };

/** How long `Hoàn tác` stays on screen (AVORA-117). */
export const LINK_UNDO_MS = 10_000;

let current: ContactLinkRequest | null = null;
const listeners = new Set<() => void>();

function emit(next: ContactLinkRequest | null): void {
  current = next;
  for (const listener of listeners) listener();
}

/** Opens the link manager from anywhere (contact page, person card). */
export function openContactLinkManager(request: ContactLinkRequest): void {
  emit(request);
}

export function closeContactLinkManager(): void {
  emit(null);
}

/** The request the host is showing, or null. */
export function useContactLinkRequest(): ContactLinkRequest | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}
