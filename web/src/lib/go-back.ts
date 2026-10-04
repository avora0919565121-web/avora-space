import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, type NavigateFunction } from "react-router-dom";

import { hasInAppPrevious, previousEntryPath, useHistoryVersion, walkedEntries } from "@/lib/nav-history";
import { activeNavEntry, HOME_ROUTE } from "@/lib/navigation";
import { readReturn, stripReturn } from "@/lib/return-to";

/**
 * AVORA-94B / AVORA-100 · C (ADR-062 bản sửa) — the one way back in AVORA.
 *
 * Tap `‹` (and the browser / Android Back, the edge swipe) → `goBack`, one step to where you came from:
 * 1. a screen behind inside the app → step back to it (`navigate(-1)`);
 * 2. else the `tu` the address carries;
 * 3. else the parent screen (`parentOf` = `tabRootOf`). 2 and 3 always `replace`, so Back never bounces.
 *
 * Hold `‹` → `goToTabRoot`: the top of the big tab you are in, dropping the chain of `‹` inside it.
 */
export type BackPlace = { path: string; label: string };

type Where = { pathname: string; search: string };

/** The six areas' own front screens: no `‹` there (the bars move between them). */
export function isAreaRoot(where: Where): boolean {
  const params = new URLSearchParams(where.search);
  const { pathname } = where;
  if (pathname === HOME_ROUTE || pathname === "/" || pathname === "/tin-nhan" || pathname === "/nhiem-vu") return true;
  if (pathname === "/ke-hoach") return !["bang", "xem", "hm", "toan-man"].some((key) => params.has(key));
  // Két sắt / Cài đặt: their strip sections are siblings of one screen, not steps deeper.
  return /^\/(ket-sat|cai-dat)(\/[^/]+)?$/.test(pathname);
}

/** Which big tab a path lives in (`/du-an/…`, `/lien-he/…` belong to Kết nối). */
export function areaOf(pathname: string): string {
  if (pathname === "/tin-nhan" || pathname.startsWith("/tin-nhan/") || pathname.startsWith("/du-an/") || pathname === "/lien-he" || pathname.startsWith("/lien-he/")) return "/tin-nhan";
  return activeNavEntry(pathname)?.to ?? HOME_ROUTE;
}

/**
 * AVORA-100 · C mục 3 — the top of the big tab a screen lives in (where holding `‹` lands).
 * `threadSection` is the Kết nối section of an open conversation (only the chat knows its kind).
 */
export function tabRootOf(where: Where, threadSection?: BackPlace): BackPlace {
  const { pathname } = where;
  const params = new URLSearchParams(where.search);
  if (pathname.startsWith("/tin-nhan/")) return threadSection ?? { path: "/tin-nhan?tab=1-1", label: "Kết nối" };
  if (pathname.startsWith("/du-an/")) return { path: "/tin-nhan?tab=du-an", label: "Kết nối" };
  if (pathname === "/tin-nhan" || pathname === "/lien-he" || pathname.startsWith("/lien-he/")) return { path: "/tin-nhan?tab=1-1", label: "Kết nối" };
  if (pathname.startsWith("/ke-hoach")) {
    // The shelf the board opened on; none → `/ke-hoach`, which opens the shelf remembered on the account.
    const ke = params.get("ke");
    return { path: ke !== null && /^[1-6]$/.test(ke) ? `/ke-hoach?ke=${ke}` : "/ke-hoach", label: "Kế hoạch" };
  }
  if (pathname.startsWith("/nhiem-vu")) return { path: "/nhiem-vu", label: "Nhiệm vụ" };
  const area = /^\/(ket-sat|cai-dat)(\/|$)/.exec(pathname);
  if (area !== null) return { path: `/${area[1]}`, label: area[1] === "ket-sat" ? "Két sắt" : "Cài đặt" };
  return { path: HOME_ROUTE, label: "Avora Space" };
}

/** Where `‹` lands when nothing is behind and no `tu` was given: the same table as `tabRootOf`. */
export function parentOf(where: Where): BackPlace {
  return tabRootOf(where);
}

/** The name of a place, for the small label beside `‹`. */
export function placeLabel(path: string): string {
  const pathname = path.split("?")[0] ?? path;
  if (pathname.startsWith("/tin-nhan/")) return "Cuộc trò chuyện";
  if (pathname.startsWith("/du-an/")) return "Dự án";
  if (pathname.startsWith("/lien-he")) return "Liên hệ";
  return activeNavEntry(pathname)?.label ?? "Quay lại";
}

export type BackTarget = { kind: "history"; label: string } | { kind: "path"; path: string; label: string };

/** What `‹` does from here, and the small name it carries (always the place it really goes to). */
export function backTarget(where: Where, parent?: BackPlace): BackTarget {
  const returnTo = readReturn(new URLSearchParams(where.search));
  if (hasInAppPrevious()) {
    const previous = previousEntryPath();
    return { kind: "history", label: previous === null ? (returnTo?.label ?? "Quay lại") : placeLabel(previous) };
  }
  if (returnTo !== null) return { kind: "path", path: returnTo.path, label: returnTo.label };
  const place = parent ?? parentOf(where);
  return { kind: "path", path: place.path, label: place.label };
}

/** Steps back by luật 1. `parent` lets a screen name its own parent (a chat knows its section). */
export function goBack(navigate: NavigateFunction, where: Where, parent?: BackPlace): void {
  const target = backTarget(where, parent);
  if (target.kind === "history") navigate(-1);
  else navigate(target.path, { replace: true });
}

/** Whether a walked entry is the tab root itself (`/tin-nhan` with no `tab` is the 1-1 section). */
function isSameRoot(entryPath: string, root: string): boolean {
  const [entryPathname = "", entryQuery = ""] = stripReturn(entryPath).split("?");
  const [rootPathname = "", rootQuery = ""] = root.split("?");
  if (entryPathname !== rootPathname || !isAreaRoot({ pathname: entryPathname, search: `?${entryQuery}` })) return false;
  const entryParams = new URLSearchParams(entryQuery);
  for (const [key, value] of new URLSearchParams(rootQuery)) {
    const have = entryParams.get(key) ?? (rootPathname === "/tin-nhan" && key === "tab" ? "1-1" : null);
    if (have !== value) return false;
  }
  return true;
}

/** How many steps back the tab root sits in this visit to the tab, or null when it is not behind us. */
export function stepsToTabRoot(root: BackPlace): number | null {
  const walked = walkedEntries();
  const top = walked.length - 1;
  const rootArea = areaOf(root.path.split("?")[0] ?? root.path);
  for (let index = top - 1; index >= 0; index -= 1) {
    const later = walked[index + 1];
    // A fresh landing (reopen, notification) or a screen of another tab ends this visit to the tab.
    if (later === undefined || later.noBack || areaOf(later.path.split("?")[0] ?? "") !== rootArea) return null;
    const entry = walked[index];
    if (entry !== undefined && isSameRoot(entry.path, root.path)) return top - index;
  }
  return null;
}

export const TAB_ROOT_EVENT = "avora_tab_root";

/**
 * AVORA-100 · C mục 4.1 — hold `‹`: back to the top of the big tab. When that top is behind us in this
 * visit, step back to it (`navigate(-n)`), so the chain inside is dropped and Back afterwards leaves
 * the tab; otherwise open it in place (`replace`). Says `Về đầu {tab}` for 1.5 s.
 */
export function goToTabRoot(navigate: NavigateFunction, where: Where, threadSection?: BackPlace): void {
  if (isAreaRoot(where)) return;
  const root = tabRootOf(where, threadSection);
  const steps = stepsToTabRoot(root);
  if (steps !== null) navigate(-steps);
  else navigate(root.path, { replace: true });
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<string>(TAB_ROOT_EVENT, { detail: root.label }));
}

/** `{ back, label, toRoot, rootLabel }` for a screen's `‹`. */
export function useBack(parent?: BackPlace): { back: () => void; label: string; toRoot: () => void; rootLabel: string } {
  const navigate = useNavigate();
  const location = useLocation();
  const version = useHistoryVersion();
  const parentPath = parent?.path;
  const parentLabel = parent?.label;
  const place = useMemo(
    () => (parentPath === undefined ? undefined : { path: parentPath, label: parentLabel ?? "Quay lại" }),
    [parentPath, parentLabel],
  );
  // Only a conversation's own section is its tab root; other screens' parents are steps, not tops.
  const section = location.pathname.startsWith("/tin-nhan/") ? place : undefined;
  const back = useCallback(() => goBack(navigate, location, place), [navigate, location, place]);
  const toRoot = useCallback(() => goToTabRoot(navigate, location, section), [navigate, location, section]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version: the walked path moved
  const label = useMemo(() => backTarget(location, place).label, [location, place, version]);
  const rootLabel = tabRootOf(location, section).label;
  return { back, label, toRoot, rootLabel };
}
