import { useRef } from "react";
import { NavLink } from "react-router-dom";

import { openFocusSheet } from "@/components/chat/FocusHost";
import { navIconFor } from "@/components/nav/nav-icons";
import { activeFocus } from "@/lib/mute";
import { useProfileSettings } from "@/lib/use-settings";
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
  const { data: profile } = useProfileSettings();
  const isFocused = activeFocus(profile?.focusMode, profile?.focusUntil) !== null;
  // Hold Kết nối (AVORA-47 · C): opens Chế độ tập trung instead of navigating.
  const holdRef = useRef<{ timer: number | null; fired: boolean }>({ timer: null, fired: false });
  const startHold = (): void => {
    holdRef.current.fired = false;
    holdRef.current.timer = window.setTimeout(() => {
      holdRef.current.fired = true;
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(12);
      openFocusSheet();
    }, 500);
  };
  const endHold = (): void => {
    if (holdRef.current.timer !== null) window.clearTimeout(holdRef.current.timer);
    holdRef.current.timer = null;
  };

  return (
    <nav
      aria-label="Các Hub"
      className="relative z-30 shrink-0 border-t border-border bg-card/95 pb-[max(env(safe-area-inset-bottom),10px)] backdrop-blur-md md:hidden short:hidden"
    >
      <ul className="grid grid-cols-5">
        {TOOL_BELT_ITEMS.map((item) => {
          const Icon = navIconFor(item.to);
          const badge = badges[item.to];
          const isConnect = item.to === "/tin-nhan";
          return (
            <li key={item.to} className="min-w-0">
              <NavLink
                to={item.to}
                {...(isConnect
                  ? {
                      onPointerDown: startHold,
                      onPointerUp: endHold,
                      onPointerLeave: endHold,
                      onPointerCancel: endHold,
                      onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
                      onClick: (event: React.MouseEvent) => {
                        if (holdRef.current.fired) {
                          event.preventDefault();
                          holdRef.current.fired = false;
                        }
                      },
                    }
                  : {})}
                className={({ isActive }) =>
                  cn(
                    "press relative flex h-[52px] min-h-12 flex-col items-center justify-center gap-1 transition-colors",
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
                      {isConnect && isFocused ? (
                        <span aria-label="Đang tập trung" className="absolute -left-2 -top-1 text-[10px] leading-none">
                          ☾
                        </span>
                      ) : null}
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
