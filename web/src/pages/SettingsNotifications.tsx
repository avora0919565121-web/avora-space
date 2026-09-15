import { MuteSettingsCard } from "@/components/chat/MuteSettingsCard";

/**
 * Thông báo — the mute layers, given their own sub-tab.
 *
 * The card itself is untouched; only where it lives changed, so the person
 * looking for quiet does not have to remember it was filed under the profile.
 */
const SettingsNotifications = () => (
  <div className="paper min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto max-w-2xl animate-rise-in px-6 py-12 md:px-10">
      <MuteSettingsCard />
    </div>
  </div>
);

export default SettingsNotifications;
