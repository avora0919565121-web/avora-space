import { Outlet } from "react-router-dom";

import { ReturnChip } from "@/components/nav/ReturnChip";
import { SectionTabs } from "@/components/SectionTabs";
import { SETTINGS_TABS } from "@/lib/navigation";

/**
 * Cài đặt — four sibling halves: the account (Hồ sơ), the app's own settings (Tuỳ chọn chung),
 * its notifications (Thông báo), and the assistant that is planned but not built (Avora AI).
 * The section frames them and nothing more. Reached from elsewhere, it shows the way back
 * (AVORA-53 · 2.11), as Két sắt does.
 */
const Settings = () => (
  <div className="flex min-h-0 flex-1 flex-col">
    <SectionTabs section="Cài đặt" tabs={SETTINGS_TABS} />
    <ReturnChip className="mx-auto w-full max-w-2xl px-6 md:px-10" />
    <Outlet />
  </div>
);

export default Settings;
