/**
 * The shape of the app's navigation: the five places in the main rail, the two
 * sectioned areas (Két sắt, Cài đặt), and where every previously-published URL
 * now lands.
 *
 * It lives outside the components so the structure can be checked without
 * rendering anything — a broken saved link is a routing fact, not a pixel.
 */

export type NavEntry = {
  readonly to: string;
  readonly label: string;
};

/**
 * Where a signed-in visitor lands: Avora Space, always.
 *
 * The app opens on the calm overview rather than on the inbox, so the first thing someone sees
 * is what they chose to work on, not whoever happened to write to them last. Every other tab
 * announces itself with a badge instead — a reminder, not a redirection.
 *
 * Kept as one constant because five different screens send people "home" (sign-in, sign-up,
 * finished password reset, the bare "/", and a dead link), and they must never drift apart.
 */
export const HOME_ROUTE = "/tong-quan";

/** The main rail. Liên hệ deliberately is NOT here: it opens from Tin nhắn. */
export const NAV_ITEMS: readonly NavEntry[] = [
  { to: "/tong-quan", label: "Avora Space" },
  { to: "/tin-nhan", label: "Tin nhắn" },
  { to: "/nhiem-vu", label: "Nhiệm vụ" },
  { to: "/ket-sat", label: "Két sắt" },
  { to: "/cai-dat", label: "Cài đặt" },
];

/** Két sắt: the live ledger, and the vault half that is not built yet. */
export const VAULT_TABS: readonly NavEntry[] = [
  { to: "/ket-sat", label: "Tài chính" },
  { to: "/ket-sat/mat-khau", label: "Mật khẩu" },
];

/** Cài đặt: the real profile, and the assistant that is not built yet. */
export const SETTINGS_TABS: readonly NavEntry[] = [
  { to: "/cai-dat", label: "Hồ sơ" },
  { to: "/cai-dat/avora-ai", label: "Avora AI" },
];

/**
 * Every route this restructure renamed, mapped to its replacement. Kept as data
 * so a redirect can never disagree with the list of what moved.
 */
export const LEGACY_ROUTES: Readonly<Record<string, string>> = {
  "/tai-chinh": "/ket-sat",
  "/tai-chinh/giao-dich": "/ket-sat/giao-dich",
  "/tai-chinh/tai-khoan": "/ket-sat/tai-khoan",
  "/tai-chinh/bao-cao": "/ket-sat/bao-cao",
  "/ho-so": "/cai-dat",
};

/**
 * Where a saved (or shared) old link should go now, query string intact — the
 * finance screens link to each other with filters in the URL, and a redirect
 * that dropped them would silently show the wrong month.
 *
 * Returns null when the path was never renamed.
 */
export function legacyTarget(pathname: string, search: string = ""): string | null {
  const normalized: string = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const next: string | undefined = LEGACY_ROUTES[normalized];
  if (next === undefined) return null;
  return `${next}${search}`;
}

/**
 * Which tab of a sectioned screen owns the current path. The deepest matching
 * tab wins, so "/ket-sat/mat-khau" belongs to Mật khẩu while the finance
 * sub-routes ("/ket-sat/giao-dich", …) all stay under Tài chính.
 */
export function activeSectionTab(pathname: string, tabs: readonly NavEntry[]): string {
  const fallback: string = tabs[0].to;
  let best: string | null = null;

  for (const tab of tabs) {
    const owns: boolean = pathname === tab.to || pathname.startsWith(`${tab.to}/`);
    if (!owns) continue;
    if (best === null || tab.to.length > best.length) best = tab.to;
  }

  return best ?? fallback;
}
