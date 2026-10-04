import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { StatusPill } from "@/components/StatusPill";
import { MobileTopActions } from "@/components/nav/HubTitle";
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
export function SectionTabs({
  section,
  tabs,
  action,
}: {
  section: string;
  tabs: readonly NavEntry[];
  /** AVORA-57 · E: the area's main `+`, outermost on the right of the title. */
  action?: (current: string) => ReactNode;
}) {
  const location = useLocation();
  const current: string = activeSectionTab(location.pathname, tabs);

  return (
    <header data-section-tabs="" className="shrink-0 border-b border-border px-4 pt-1 sm:px-6 md:bg-card md:px-10 md:pr-[4.5rem] md:pt-6 short:bg-card short:px-4 short:pr-[4.25rem] short:pt-2">
      {/* AVORA-93 · 91 (ADR-059): on an upright phone the tab name lives only in the top row; the title row is hidden and its `+` moves up there. */}
      <div className="hidden items-center justify-between gap-3 md:flex short:flex">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-foreground md:text-[30px]">{section}</h1>
        {action?.(current) ?? null}
      </div>
      <PhoneActions>{action?.(current) ?? null}</PhoneActions>
      <nav aria-label={`Mục ${section}`} className="no-scrollbar mt-0 overflow-x-auto [mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] md:mt-2 short:mt-2">
        <ul className="flex items-center gap-1 whitespace-nowrap">
          {tabs.map((tab) => {
            const isActive: boolean = tab.to === current;
            return (
              <li key={tab.to}>
                <Link
                  to={tab.to}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "press relative inline-flex items-center gap-1.5 px-2 pb-2.5 text-[14.5px] transition-colors",
                    isActive
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                  {tab.badge !== undefined ? (
                    <StatusPill className="px-2 py-0.5 text-[9.5px]">{tab.badge}</StatusPill>
                  ) : null}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-personal transition-opacity",
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

/** The `+` of a sectioned area, carried into the phone's top row (renders nothing elsewhere — the title row has it). */
function PhoneActions({ children }: { children: ReactNode }) {
  if (children === null) return null;
  return (
    <div className="md:hidden short:hidden">
      <MobileTopActions>{children}</MobileTopActions>
    </div>
  );
}
