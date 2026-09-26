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
  /** A short note shown beside the label, e.g. "Sắp ra mắt" on a tab that is not built yet. */
  readonly badge?: string;
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

/**
 * Where to go once signed in: the screen that sent the person to sign in (an invite link, a contact
 * invite), or Avora Space. Only an in-app path is honoured — never another site, never the sign-in
 * screen itself.
 */
export function returnPathFrom(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  if (typeof from !== "string") return HOME_ROUTE;
  if (!from.startsWith("/") || from.startsWith("//") || from.startsWith("/dang-nhap")) return HOME_ROUTE;
  return from;
}

/**
 * Where the unconfirmed channels of an import are settled.
 *
 * Kept as a constant because two screens link to it and it sits above `/lien-he/:contactId` in
 * the route table — a literal typed twice could drift into being read as a contact id.
 */
export const CHANNEL_REVIEW_ROUTE = "/lien-he/can-xem-lai";

/** The main rail. Liên hệ deliberately is NOT here: it opens from Tin nhắn. */
export const NAV_ITEMS: readonly NavEntry[] = [
  { to: "/tong-quan", label: "Avora Space" },
  { to: "/tin-nhan", label: "Kết nối" },
  { to: "/nhiem-vu", label: "Nhiệm vụ" },
  // Above Két sắt, below Nhiệm vụ: the HUB is work being done, and it belongs beside the
  // other doing screens rather than beside the one that keeps things safe.
  { to: "/ke-hoach", label: "Kế hoạch" },
  { to: "/ket-sat", label: "Két sắt" },
  { to: "/cai-dat", label: "Cài đặt" },
];

/**
 * The phone's tool-belt: the five Hubs, pinned to the bottom of the screen. Avora Space is not
 * among them — it is reached by tapping the logo, which is where "home" lives.
 */
export const TOOL_BELT_ITEMS: readonly NavEntry[] = NAV_ITEMS.filter((item) => item.to !== HOME_ROUTE);

/**
 * Named at the end of the full map (hold the logo on a phone) so the shape of AVORA is complete,
 * but not built: no route, no screen, only the "Sắp ra mắt" pill.
 */
export const APP_MAP_UPCOMING: readonly { label: string; note: string }[] = [
  { label: "Donation", note: "Ủng hộ AVORA" },
];

/** How long the logo must be held before the full map opens instead of going home. */
export const LOGO_HOLD_MS = 450;

/**
 * Whether a step back stays inside AVORA.
 *
 * The router stamps every history entry it creates with its position (`idx`); the first page
 * this tab opened is 0. Anything above that was reached from within the app, so going back lands
 * on a screen the person has actually seen — never out to whatever site came before.
 */
export function canGoBackInApp(historyState: unknown): boolean {
  if (historyState === null || typeof historyState !== "object") return false;
  const idx: unknown = (historyState as { idx?: unknown }).idx;
  return typeof idx === "number" && idx > 0;
}

/**
 * What the logo does from where the person stands: from anywhere it goes home to Avora Space;
 * from Avora Space itself it steps back to the screen they came from, or does nothing when
 * there is nowhere inside AVORA to go back to.
 */
export function logoAction(pathname: string, historyState: unknown): "home" | "back" | "stay" {
  if (pathname !== HOME_ROUTE) return "home";
  return canGoBackInApp(historyState) ? "back" : "stay";
}

/** Which main destination owns a path — the deepest match, so "/ket-sat/mat-khau" is Két sắt. */
export function activeNavEntry(pathname: string): NavEntry | null {
  let best: NavEntry | null = null;
  for (const item of NAV_ITEMS) {
    const owns = pathname === item.to || pathname.startsWith(`${item.to}/`);
    if (owns && (best === null || item.to.length > best.to.length)) best = item;
  }
  return best;
}

/**
 * Where the phone's tool-belt steps aside: inside an open conversation, as a native messenger
 * does, so the composer and the keyboard keep the whole bottom of the screen.
 */
export function hidesToolBelt(pathname: string): boolean {
  return /^\/tin-nhan\/[^/]+/.test(pathname);
}

/** Két sắt: the live ledger, and the vault half that is not built yet. */
export const VAULT_TABS: readonly NavEntry[] = [
  { to: "/ket-sat", label: "Tài chính" },
  { to: "/ket-sat/mat-khau", label: "Mật khẩu" },
];

/** Cài đặt: the profile, the app's own settings, its notifications, and the unbuilt assistant. */
export const SETTINGS_TABS: readonly NavEntry[] = [
  { to: "/cai-dat", label: "Hồ sơ" },
  // Not "Thiết lập": that reads as a synonym of the section name "Cài đặt". Route unchanged.
  { to: "/cai-dat/thiet-lap", label: "Tuỳ chọn chung" },
  { to: "/cai-dat/thong-bao", label: "Thông báo" },
  { to: "/cai-dat/avora-ai", label: "Avora AI", badge: "Sắp ra mắt" },
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
  "/business-hub": "/ke-hoach",
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
