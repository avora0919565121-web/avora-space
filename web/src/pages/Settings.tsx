import { Outlet } from "react-router-dom";

import { SectionTabs } from "@/components/SectionTabs";
import { SETTINGS_TABS } from "@/lib/navigation";

/**
 * Cài đặt — four sibling halves: the account (Hồ sơ), the app's own settings (Thiết lập),
 * its notifications (Thông báo), and the assistant that is planned but not built (Avora AI).
 * The section frames them and nothing more.
 */
const Settings = () => (
  <div className="flex min-h-0 flex-1 flex-col">
    <SectionTabs section="Cài đặt" tabs={SETTINGS_TABS} />
    <Outlet />
  </div>
);

export default Settings;
