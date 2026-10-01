/**
 * AVORA-54 · A — "Đây là máy của người khác".
 *
 * The flag lives in sessionStorage: it is per-tab by definition, so a guest session set up with
 * it dies with the tab, and a normal tab never inherits it. While the flag is set, the Supabase
 * client (integrations/supabase/client.ts) routes the session to sessionStorage — nothing is
 * written to localStorage, closing the tab leaves nothing behind.
 */

export const GUEST_MACHINE_KEY = "avora.guest-machine";

/** True when this tab signed in as a guest machine. */
export function isGuestMachine(): boolean {
  try {
    return window.sessionStorage.getItem(GUEST_MACHINE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Turned on right before the session is created, so the session lands in sessionStorage. */
export function setGuestMachine(on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(GUEST_MACHINE_KEY, "1");
    else window.sessionStorage.removeItem(GUEST_MACHINE_KEY);
  } catch {
    // Private browsing can block storage; the tab simply behaves like an ordinary one.
  }
}

/** The top banner is closable for the tab only; a reload brings it back. */
const NOTICE_DISMISS_KEY = "avora.guest-machine.notice-dismissed";

export function dismissGuestNotice(): void {
  try {
    window.sessionStorage.setItem(NOTICE_DISMISS_KEY, "1");
  } catch {
    // Without storage the banner just shows again after a reload — the safe direction.
  }
}

export function isGuestNoticeDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(NOTICE_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}
