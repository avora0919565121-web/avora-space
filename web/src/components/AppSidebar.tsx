import { LogOut } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRef } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { ResizeHandle } from "@/components/ResizeHandle";
import { navIconFor } from "@/components/nav/nav-icons";
import { useAuth, useDisplayName } from "@/lib/auth";
import { NAV_COLUMN, useColumnWidth } from "@/lib/column-width";
import { formatUnreadBadge } from "@/lib/chat";
import { HOME_ROUTE, NAV_ITEMS } from "@/lib/navigation";
import { useNavBadges } from "@/lib/use-nav-badges";
import { cn } from "@/lib/utils";

/**
 * Fixed site navigation shared by every signed-in screen.
 *
 * The app always opens on Avora Space, so these badges are the only thing that says another tab
 * wants attention. They are a reminder, never a redirection — nothing here moves the reader off
 * the screen they chose to start on.
 */
export function AppSidebar() {
  const { user, signOut } = useAuth();
  const displayName = useDisplayName();
  const navigate = useNavigate();
  // Desktop only: the rail's width, as the reader last dragged it.
  const navColumn = useColumnWidth(NAV_COLUMN);
  const asideRef = useRef<HTMLElement | null>(null);
  const badges = useNavBadges();

  const handleSignOut = async (): Promise<void> => {
    await signOut();
    navigate("/dang-nhap", { replace: true });
  };

  return (
    <aside
      ref={asideRef}
      style={navColumn.isDesktop ? { width: navColumn.width } : undefined}
      // A computer only: on a phone the top bar and the tool-belt take over.
      className="paper relative hidden h-screen w-[240px] shrink-0 flex-col border-r border-border md:flex"
    >
      <ResizeHandle columnRef={asideRef} control={navColumn} label="Độ rộng thanh điều hướng" />
      {/* The mark is the way home: one click lands on Avora Space from anywhere. */}
      <Link
        to={HOME_ROUTE}
        aria-label="Về Avora Space"
        title="Về Avora Space"
        className="press mx-3 mb-2 mt-3 flex items-center gap-2.5 rounded-lg px-3 pb-3 pt-3 transition-colors hover:bg-accent/40"
      >
        <img
          src="/icon.png"
          alt=""
          aria-hidden="true"
          width={28}
          height={28}
          className="h-7 w-7 rounded-md"
        />
        <span className="wordmark text-[17px] text-foreground">AVORA</span>
      </Link>

      <nav aria-label="Điều hướng chính" className="px-3">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon: LucideIcon = navIconFor(item.to);
            const badge = badges[item.to];
            return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "relative flex items-center gap-3 rounded-md px-3 py-2.5 text-[15px] font-medium transition-colors",
                    isActive
                      ? "bg-accent/70 text-primary"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute -left-3 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity",
                        isActive ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
                    <span>{item.label}</span>
                    {badge !== undefined && badge.count > 0 ? (
                      <span
                        aria-label={badge.label}
                        className="tabular ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-none text-primary-foreground"
                      >
                        {formatUnreadBadge(badge.count)}
                      </span>
                    ) : null}
                  </>
                )}
              </NavLink>
            </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-auto border-t border-border px-4 py-5">
        <div className="flex items-center gap-3">
          <InitialsAvatar name={displayName} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-foreground">{displayName}</p>
            <p className="truncate text-[12px] text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="press mt-4 flex w-full items-center gap-3 rounded-md px-1 py-2 text-[15px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.6} />
          Đăng xuất
        </button>
      </div>
    </aside>
  );
}
