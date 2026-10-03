import { Navigate, useLocation } from "react-router-dom";

import { HOME_ROUTE, legacyTarget } from "@/lib/navigation";

/**
 * Sends a renamed URL to its new home, query string and all. A link someone
 * saved or shared before the sections were renamed must land on the same
 * screen, not on a 404 — and not on an unfiltered version of it either.
 */
export function LegacyRedirect() {
  const location = useLocation();
  const target: string | null = legacyTarget(location.pathname, location.search);

  return <Navigate to={target ?? HOME_ROUTE} replace />;
}

/**
 * AVORA-77 · C — `/ke-hoach/ke-sach` stays a working address: it opens Kế hoạch on kệ 04, every
 * parameter kept (`?sach=` opens that book, `?ve=` keeps the way back).
 */
export function ShelfRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("ke", "ke-sach");
  return <Navigate to={`/ke-hoach?${params.toString()}`} replace />;
}
