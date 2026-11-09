/**
 * 111-D · where AVORA is running. The first native builds (Capacitor) show nothing about
 * Donation, paid plans, prices or outside payment links (App Store 3.1.1 / Google Play payments);
 * in-app purchase comes in a later build. Every such place asks `canShowPayments()`.
 *
 * `?shell=native` / `?shell=web` forces the answer for testing — only in dev and test builds,
 * never in the production bundle (`import.meta.env.PROD` drops the branch).
 */
type CapacitorLike = { isNativePlatform?: () => boolean; getPlatform?: () => string };

const SHELL_OVERRIDE_KEY = "avora-shell-override";

function capacitor(): CapacitorLike | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorLike }).Capacitor;
}

/** Dev/test only: `?shell=native` sticks for the tab (so navigating keeps it), `?shell=web` clears it. */
function testOverride(): "native" | "web" | null {
  if (import.meta.env.PROD || typeof window === "undefined") return null;
  try {
    const asked = new URLSearchParams(window.location.search).get("shell");
    if (asked === "native" || asked === "web") window.sessionStorage.setItem(SHELL_OVERRIDE_KEY, asked);
    const kept = window.sessionStorage.getItem(SHELL_OVERRIDE_KEY);
    return kept === "native" || kept === "web" ? kept : null;
  } catch {
    return null;
  }
}

export function isNativeShell(): boolean {
  const forced = testOverride();
  if (forced !== null) return forced === "native";
  return capacitor()?.isNativePlatform?.() === true;
}

export type PlatformName = "ios" | "android" | "web";

export function platformName(): PlatformName {
  if (!isNativeShell()) return "web";
  const name = capacitor()?.getPlatform?.();
  return name === "ios" || name === "android" ? name : "web";
}

/** Donation, plans, prices, outside payment links: web only for now. */
export function canShowPayments(): boolean {
  return !isNativeShell();
}
