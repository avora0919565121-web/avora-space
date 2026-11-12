import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { SectionFeatureGate } from "@/components/features/FeatureGate";
import { InlineBack } from "@/components/nav/InlineBack";
import { BackToSettings, SettingsMenu } from "@/components/settings/SettingsMenu";
import { SETTINGS_ROUTE, SETTINGS_TABS } from "@/lib/navigation";
import { useVisibleNav } from "@/lib/use-feature";
import { cn } from "@/lib/utils";

/**
 * Cài đặt — KT-07b (CEO 12/11 · 3): a grouped list in the manner of iOS Settings instead of eight
 * sideways tabs (QA-02 CC-32: the edge tabs were cut to "ách", "Du…").
 *
 * Computer: the list is the left column and the open page sits beside it. Phone: `/cai-dat` is
 * the list itself; each row opens its page, which starts with `‹ Cài đặt`. Reached from elsewhere,
 * the way back (`tu`) rides along every row (AVORA-53 · 2.11).
 */
const Settings = () => {
  const visibleNav = useVisibleNav(SETTINGS_TABS);
  const location = useLocation();
  const isRoot = location.pathname === SETTINGS_ROUTE || location.pathname === `${SETTINGS_ROUTE}/`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header data-section-nav="" className="hidden shrink-0 pb-2 pl-tab pr-4 pt-6 md:flex md:bg-card md:pr-[4.5rem] short:flex short:bg-card short:pb-1 short:pt-2">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-foreground md:text-[30px]">Cài đặt</h1>
      </header>
      <InlineBack className="mx-auto w-full max-w-2xl px-6 md:px-10" />
      <div className="flex min-h-0 flex-1 md:gap-2 md:pl-tab">
        <aside className="hidden w-[264px] shrink-0 scroll-y pb-8 pt-3 md:block short:block">
          <SettingsMenu tabs={visibleNav} variant="side" />
        </aside>
        {isRoot ? (
          <div className="min-h-0 flex-1 scroll-y md:hidden short:hidden" data-settings-list="">
            {/* The phone's top bar already reads "Cài đặt" — no second title here. */}
            <SettingsMenu tabs={visibleNav} variant="page" />
          </div>
        ) : null}
        <div className={cn("min-h-0 min-w-0 flex-1 flex-col", isRoot ? "hidden md:flex short:flex" : "flex")}>
          {isRoot ? null : <BackToSettings />}
          <SectionFeatureGate>
            <Suspense fallback={null}>
              <Outlet />
            </Suspense>
          </SectionFeatureGate>
        </div>
      </div>
    </div>
  );
};

export default Settings;
