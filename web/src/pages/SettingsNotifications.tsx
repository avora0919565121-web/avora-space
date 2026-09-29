import { toast } from "sonner";

import { MuteSettingsCard } from "@/components/chat/MuteSettingsCard";
import { PushSettingsCard } from "@/components/PushSettingsCard";
import { Switch } from "@/components/ui/switch";
import { useProfileSettings, useSettingsActions } from "@/lib/use-settings";

/**
 * Thông báo — the mute layers, plus the two in-app sounds (Đợt gộp 2 · A11).
 *
 * Sounds only play while AVORA is open; they follow the mute layers above.
 */
const SettingsNotifications = () => {
  const { data: settings } = useProfileSettings();
  const { setSoundPref } = useSettingsActions();

  const toggle = (which: "messages" | "reminders", on: boolean): void => {
    setSoundPref.mutate(
      { which, on },
      { onError: (error: Error) => toast.error(error.message) },
    );
  };

  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl animate-rise-in space-y-6 px-6 py-12 md:px-10">
        <section aria-labelledby="sound-heading" className="rounded-xl border border-border bg-card p-5">
          <h2 id="sound-heading" className="text-[17px] font-semibold tracking-tight text-foreground">
            Âm báo khi đang mở AVORA
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            Một âm ngắn, nhẹ. Theo đúng các tầng Tắt thông báo bên dưới.
          </p>
          <div className="mt-4 divide-y divide-border">
            <label className="flex min-h-12 items-center justify-between gap-3 text-[14.5px] text-foreground">
              Âm báo tin nhắn
              <Switch
                checked={settings?.soundMessages ?? true}
                disabled={settings === undefined || setSoundPref.isPending}
                onCheckedChange={(on) => toggle("messages", on)}
                aria-label="Âm báo tin nhắn"
              />
            </label>
            <label className="flex min-h-12 items-center justify-between gap-3 text-[14.5px] text-foreground">
              Âm báo nhắc việc
              <Switch
                checked={settings?.soundReminders ?? true}
                disabled={settings === undefined || setSoundPref.isPending}
                onCheckedChange={(on) => toggle("reminders", on)}
                aria-label="Âm báo nhắc việc"
              />
            </label>
          </div>
        </section>
        <PushSettingsCard />
        <MuteSettingsCard />
      </div>
    </div>
  );
};

export default SettingsNotifications;
