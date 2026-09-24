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
const LINK_ENTRY_PREFIXES: readonly string[] = ["/loi-moi/", "/loi-moi-lien-he/"];

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

/**
 * What to do on this open.
 *
 * - `stay`: same day, nothing changes.
 * - `go-home`: new day, send them to Avora Space and record the day.
 * - `record-only`: new day, but they arrived through an invite link — honour the link, and still
 *   record the day so returning to the tab later does not yank them away from it.
 * A person already on Avora Space is recorded without being navigated anywhere.
 */
export function decideDayOpen(
  lastOpenedDate: string | null,
  today: string,
  pathname: string,
  homeRoute: string,
): DayOpenDecision {
  if (!isNewDay(lastOpenedDate, today)) return "stay";
  if (pathname === homeRoute || isLinkEntry(pathname)) return "record-only";
  return "go-home";
}
