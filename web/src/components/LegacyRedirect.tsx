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
