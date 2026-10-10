import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { MobileTopActions } from "@/components/nav/HubTitle";
import { SubTabs } from "@/components/nav/SubTabs";
import { activeSectionTab, type NavEntry } from "@/lib/navigation";

/**
 * The head of a sectioned area (Két sắt, Cài đặt): the title + `+` on wide screens, the `+` in the
 * phone's top row (ADR-059), and the sub-sections as the shared SubTabs strip (AVORA-101A). Which
 * tab is current comes from `activeSectionTab` (finance sub-routes live under Tài chính). A
 * "Sắp có" status never rides on the strip — it belongs inside the page.
 */
export function SectionNav({
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
  const navigate = useNavigate();
  const current: string = activeSectionTab(location.pathname, tabs);

  return (
    <header data-section-nav="" className="shrink-0 md:bg-card short:bg-card">
      <div className="hidden items-center justify-between gap-3 px-4 pb-2 pt-6 sm:px-6 md:flex md:px-10 md:pr-[4.5rem] short:flex short:px-4 short:pr-[4.25rem] short:pb-1 short:pt-2">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-foreground md:text-[30px]">{section}</h1>
        {action?.(current) ?? null}
      </div>
      <PhoneActions>{action?.(current) ?? null}</PhoneActions>
      <SubTabs
        ariaLabel={`Mục ${section}`}
        items={tabs.map((tab) => ({ id: tab.to, label: tab.label }))}
        value={current}
        onChange={(to) => navigate(to)}
      />
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
