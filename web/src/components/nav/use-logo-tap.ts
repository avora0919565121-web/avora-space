import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/lib/auth";
import { takeLogoReturn, writeLogoReturn } from "@/lib/logo-return";
import { HOME_ROUTE } from "@/lib/navigation";
import { mainScroller } from "@/lib/tab-memory";

/**
 * AVORA-94B · luật 2 — the logo A. Away from Avora Space: remember this place, go home (push).
 * On Avora Space: back to the place remembered (scroll restored), or stay when there is none.
 */
export function useLogoTap(): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  return useCallback((): void => {
    if (location.pathname !== HOME_ROUTE) {
      writeLogoReturn(user?.id, { path: `${location.pathname}${location.search}`, scroll: mainScroller()?.scrollTop ?? 0 });
      navigate(HOME_ROUTE);
      return;
    }
    const back = takeLogoReturn(user?.id);
    if (back === null) return;
    navigate(back.path, { state: { fromTabMemory: true, scroll: back.scroll } });
  }, [location.pathname, location.search, navigate, user?.id]);
}
