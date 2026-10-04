import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, type NavigateFunction } from "react-router-dom";

import { hasInAppPrevious, previousEntryPath, useHistoryVersion } from "@/lib/nav-history";
import { activeNavEntry, HOME_ROUTE } from "@/lib/navigation";
import { readReturn } from "@/lib/return-to";

/**
 * AVORA-94B · luật 1 (ADR-062) — the one way back in AVORA.
 *
 * Every `‹`, the browser / Android Back and the edge swipe (installed app) go through `goBack`:
 * 1. a screen behind inside the app → step back to it (`navigate(-1)`);
 * 2. else the `tu` the address carries;
 * 3. else the parent screen (`parentOf`). 2 and 3 always `replace`, so Back never bounces.
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

/** Where `‹` lands when nothing is behind and no `tu` was given (bảng ở PHẦN A). */
export function parentOf(where: Where): BackPlace {
  const { pathname } = where;
  const params = new URLSearchParams(where.search);
  if (pathname.startsWith("/du-an/")) return { path: "/tin-nhan?tab=du-an", label: "Kết nối" };
  if (pathname.startsWith("/tin-nhan/") || pathname === "/lien-he" || pathname.startsWith("/lien-he/")) return { path: "/tin-nhan?tab=1-1", label: "Kết nối" };
  if (pathname.startsWith("/ke-hoach")) {
    const ke = params.get("ke");
    return { path: ke !== null && /^[1-6]$/.test(ke) ? `/ke-hoach?ke=${ke}` : "/ke-hoach", label: "Kế hoạch" };
  }
  const area = /^\/(ket-sat|cai-dat)\//.exec(pathname);
  if (area !== null) return { path: `/${area[1]}`, label: area[1] === "ket-sat" ? "Két sắt" : "Cài đặt" };
  return { path: HOME_ROUTE, label: "Avora Space" };
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

/** What `‹` does from here, and the small name it carries. */
export function backTarget(where: Where, parent?: BackPlace): BackTarget {
  const returnTo = readReturn(new URLSearchParams(where.search));
  if (hasInAppPrevious()) {
    const previous = previousEntryPath();
    return { kind: "history", label: returnTo?.label ?? (previous === null ? "Quay lại" : placeLabel(previous)) };
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

/** `{ back, label }` for a screen's `‹`. */
export function useBack(parent?: BackPlace): { back: () => void; label: string } {
  const navigate = useNavigate();
  const location = useLocation();
  const version = useHistoryVersion();
  const parentPath = parent?.path;
  const parentLabel = parent?.label;
  const place = useMemo(
    () => (parentPath === undefined ? undefined : { path: parentPath, label: parentLabel ?? "Quay lại" }),
    [parentPath, parentLabel],
  );
  const back = useCallback(() => goBack(navigate, location, place), [navigate, location, place]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version: the walked path moved
  const label = useMemo(() => backTarget(location, place).label, [location, place, version]);
  return { back, label };
}
