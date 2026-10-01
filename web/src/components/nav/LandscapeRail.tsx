import { NavLink } from "react-router-dom";

import { navIconFor } from "@/components/nav/nav-icons";
import { formatUnreadBadge } from "@/lib/chat";
import { NAV_ITEMS } from "@/lib/navigation";
import { useNavBadges } from "@/lib/use-nav-badges";
import { cn } from "@/lib/utils";

/**
 * AVORA-57 · I — a phone on its side. Instead of the 240px column (logo + words), a narrow
 * vertical strip of icons: Avora Space and the five main tabs, with their number badges — the
 * tool-belt, stood up. Shown only on short landscape screens (`short:`), judged by height.
 */
export function LandscapeRail() {
  const badges = useNavBadges();
  return (
    <nav
      aria-label="Điều hướng chính"
      // AVORA-61 · J: a 56px strip. Its background runs to the screen edge; the notch inset is added
      // only when the notch is on this side (`--inset-l`), so the icons never sit under it.
      data-landscape-rail=""
      className="hidden h-[100dvh] w-[calc(56px+var(--inset-l))] shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-card/95 py-[max(env(safe-area-inset-top),8px)] pl-[var(--inset-l)] short:flex"
    >
      {NAV_ITEMS.map((item) => {
        const Icon = navIconFor(item.to);
        const badge = badges[item.to];
        return (
          <NavLink
            key={item.to}
            to={item.to}
            aria-label={item.label}
            title={item.label}
            className={({ isActive }) =>
              cn(
                "press no-callout relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors",
                isActive ? "bg-accent/70 text-primary" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )
            }
          >
            <Icon className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
            {badge !== undefined && badge.count > 0 ? (
              <span
                aria-label={badge.label}
                className="tabular absolute -right-0.5 -top-0.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
              >
                {formatUnreadBadge(badge.count)}
              </span>
            ) : null}
          </NavLink>
        );
      })}
    </nav>
  );
}
