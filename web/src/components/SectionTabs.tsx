import { Link, useLocation } from "react-router-dom";

import { activeSectionTab, type NavEntry } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * The strip that sits above a sectioned area (Két sắt, Cài đặt) and names the
 * halves it holds. Deliberately quieter than the pills a page draws inside
 * itself: this row says where you are, the inner row says what you are reading.
 *
 * Which tab is current is decided by `activeSectionTab`, not by NavLink: the
 * finance sub-routes (`/ket-sat/giao-dich`, …) live under the Tài chính tab, so
 * an exact-match rule would leave the strip with nothing highlighted there.
 */
export function SectionTabs({ section, tabs }: { section: string; tabs: readonly NavEntry[] }) {
  const location = useLocation();
  const current: string = activeSectionTab(location.pathname, tabs);

  return (
    <header className="border-b border-border bg-card px-6 pt-5 md:px-10">
      <p className="wordmark text-[11px] text-muted-foreground">{section}</p>
      <nav aria-label={`Mục ${section}`} className="mt-2.5">
        <ul className="flex items-center gap-1">
          {tabs.map((tab) => {
            const isActive: boolean = tab.to === current;
            return (
              <li key={tab.to}>
                <Link
                  to={tab.to}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "press relative inline-block px-2 pb-2.5 text-[14.5px] transition-colors",
                    isActive
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-primary transition-opacity",
                      isActive ? "opacity-100" : "opacity-0",
                    )}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
