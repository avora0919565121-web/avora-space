import { isGuestMachine } from "@/lib/guest-machine";

/**
 * AVORA-94B · luật 2 (ADR-062) — the logo A: tap → Avora Space, remembering the place just left;
 * tap again on Avora Space → back to exactly that place (path + scroll), then forgotten.
 * Kept in sessionStorage per account: it belongs to this sitting, not to the device.
 */
export type LogoReturn = { path: string; scroll: number };

const PREFIX = "avora.tab-memory.v1.logo-return";

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function writeLogoReturn(userId: string | undefined, place: LogoReturn): void {
  if (userId === undefined) return;
  try {
    store()?.setItem(`${PREFIX}:${userId}`, JSON.stringify(place));
  } catch {
    // Not remembering means the second tap simply stays.
  }
}

export function takeLogoReturn(userId: string | undefined): LogoReturn | null {
  if (userId === undefined) return null;
  try {
    const key = `${PREFIX}:${userId}`;
    const raw = store()?.getItem(key) ?? null;
    store()?.removeItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<LogoReturn> | null;
    if (parsed === null || typeof parsed.path !== "string" || !parsed.path.startsWith("/") || parsed.path.startsWith("//")) return null;
    return { path: parsed.path, scroll: typeof parsed.scroll === "number" ? Math.max(0, parsed.scroll) : 0 };
  } catch {
    return null;
  }
}

/** For the guest-machine banner and sign-out: nothing to keep. */
export function hasLogoReturnStore(): boolean {
  return store() !== null && !isGuestMachine();
}
