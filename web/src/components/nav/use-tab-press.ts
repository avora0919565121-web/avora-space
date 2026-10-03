import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/lib/auth";
import { mainScroller, rememberPlace, tabTarget } from "@/lib/tab-memory";

/**
 * AVORA-77 · G — what a press on a main tab does (tool-belt, landscape rail, sidebar): another tab
 * → where you left it; the tab you are on → its root. Plain clicks only; a modified click (new
 * window, new tab) keeps the link's own root address.
 */
export function useTabPress(): (event: React.MouseEvent, tab: string) => void {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const userId: string | undefined = user?.id;

  return useCallback(
    (event: React.MouseEvent, tab: string): void => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      // Keep where this tab stands right now, scroll included, before leaving it.
      rememberPlace(userId, `${location.pathname}${location.search}`, mainScroller()?.scrollTop ?? 0);
      const target = tabTarget(tab, location.pathname, userId);
      if (target.path === `${location.pathname}${location.search}`) {
        mainScroller()?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      navigate(target.path, target.remembered ? { state: { fromTabMemory: true, scroll: target.scroll } } : undefined);
    },
    [navigate, location.pathname, location.search, userId],
  );
}
