/**
 * The first open of a new day starts at Avora Space.
 *
 * The rule is about the CALENDAR, not about time away: coming back after ten minutes at 23:59
 * and 00:01 is a new morning, and coming back after six hours on the same day is not. The day is
 * the person's local one, the same `YYYY-MM-DD` every deadline on the task list is read against,
 * so "today" can never mean two different things on two screens.
 *
 * It is one condition placed in front of everything else, not a change to how the app opens on
 * an ordinary same-day return — which stays exactly as it was.
 */

/** Paths someone reached by tapping a link sent to them. A link is an explicit intent. */
const LINK_ENTRY_PREFIXES: readonly string[] = ["/loi-moi/", "/loi-moi-lien-he/", "/ket-noi/"];

/** The app's own front doors: opening here is "opening the app", not following a link. */
export function isRootEntry(pathname: string, homeRoute: string): boolean {
  return pathname === "/" || pathname === homeRoute;
}

/** True when this path was opened from an invite link, which a new day must not overrule. */
export function isLinkEntry(pathname: string): boolean {
  return LINK_ENTRY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Whether this open is the first of a new day. A person who has never been recorded opening the
 * app counts as a new day: their first sight of AVORA should be the calm overview.
 */
export function isNewDay(lastOpenedDate: string | null, today: string): boolean {
  return lastOpenedDate !== today;
}

export type DayOpenDecision = "stay" | "go-home" | "record-only";

/** `cold`: the page just loaded (icon, notification, link). `resume`: a tab that was already open came back. */
export type DayOpenMoment = "cold" | "resume";

/**
 * What to do on this open.
 *
 * - `stay`: same day, nothing changes.
 * - `go-home`: new day on a tab left open since yesterday — send them to Avora Space and record the day.
 * - `record-only`: new day, but they opened a specific place (a notification, `/tin-nhan/…`,
 *   `/nhiem-vu?…&mo=`, an invite / QR link) — honour it and only record the day (AVORA-53 · 1.1).
 *   Opening the app at its root lands on Avora Space by itself, so that is recorded too.
 */
export function decideDayOpen(
  lastOpenedDate: string | null,
  today: string,
  pathname: string,
  homeRoute: string,
  moment: DayOpenMoment = "resume",
): DayOpenDecision {
  if (!isNewDay(lastOpenedDate, today)) return "stay";
  if (isRootEntry(pathname, homeRoute) || isLinkEntry(pathname)) return "record-only";
  if (moment === "cold") return "record-only";
  return "go-home";
}

/**
 * The path the page was loaded with, read once before the router rewrites `/` to Avora Space.
 * A cold open is judged by this, not by wherever the router has already moved on to.
 */
export const ENTRY_PATH: string = typeof window === "undefined" ? "/" : window.location.pathname;
