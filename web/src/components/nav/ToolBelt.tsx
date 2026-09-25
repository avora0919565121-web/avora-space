import { NavLink } from "react-router-dom";

import { navIconFor } from "@/components/nav/nav-icons";
import { formatUnreadBadge } from "@/lib/chat";
import { TOOL_BELT_ITEMS } from "@/lib/navigation";
import { useNavBadges } from "@/lib/use-nav-badges";
import { cn } from "@/lib/utils";

/**
 * The phone's tool-belt: five Hubs pinned to the bottom, icon over a small label.
 *
 * Avora Space is deliberately absent — the logo at the top is the way home.
 */
export function ToolBelt() {
  const badges = useNavBadges();

  return (
    <nav
      aria-label="Các Hub"
      className="relative z-30 shrink-0 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="grid grid-cols-5">
        {TOOL_BELT_ITEMS.map((item) => {
          const Icon = navIconFor(item.to);
          const badge = badges[item.to];
          return (
            <li key={item.to} className="min-w-0">
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "press relative flex h-[58px] flex-col items-center justify-center gap-1 transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-x-5 top-0 h-[2.5px] rounded-b-full bg-primary transition-opacity",
                        isActive ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="relative">
                      <Icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2 : 1.6} aria-hidden="true" />
                      {badge !== undefined && badge.count > 0 ? (
                        <span
                          aria-label={badge.label}
                          className="tabular absolute -right-2.5 -top-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full border-2 border-card bg-primary px-1 text-[9.5px] font-bold leading-none text-primary-foreground"
                        >
                          {formatUnreadBadge(badge.count)}
                        </span>
                      ) : null}
                    </span>
                    <span className={cn("max-w-full truncate px-0.5 text-[10.5px] leading-none", isActive ? "font-semibold" : "font-medium")}>
                      {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
