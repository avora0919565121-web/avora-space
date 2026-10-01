import { Moon } from "lucide-react";
import { toast } from "sonner";

import { openFocusSheet } from "@/components/chat/FocusHost";
import { MuteSettingsCard } from "@/components/chat/MuteSettingsCard";
import { shortUntil, useRhythm } from "@/lib/use-rhythm";
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
  const rhythm = useRhythm();

  const toggle = (which: "messages" | "reminders", on: boolean): void => {
    setSoundPref.mutate(
      { which, on },
      { onSuccess: () => toast.success("Đã lưu", { duration: 1500 }), onError: (error: Error) => toast.error(error.message) },
    );
  };

  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl animate-rise-in space-y-6 px-6 py-12 md:px-10">
        {/* AVORA-47 · C: the easy-to-find way in; holding Kết nối opens the same sheet. */}
        <section aria-labelledby="focus-heading" className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <Moon className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 id="focus-heading" className="text-[17px] font-semibold tracking-tight text-foreground">
                Chế độ tập trung
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                {rhythm.focus === null
                  ? "Yên lặng hoặc Ngắt kết nối. Gia đình và tin Khẩn vẫn báo; nhắc việc luôn kêu. Mở nhanh: giữ tab Kết nối."
                  : `${rhythm.focus === "disconnect" ? "Đang ngắt kết nối" : "Đang tập trung"}${rhythm.focusUntil !== null ? ` tới ${shortUntil(rhythm.focusUntil)}` : " tới khi bạn tắt"}.`}
              </p>
            </div>
            <button
              type="button"
              onClick={rhythm.focus === null ? openFocusSheet : rhythm.stopFocus}
              className="press shrink-0 rounded-md border border-border px-3 py-2 text-[13.5px] font-medium text-foreground hover:bg-accent/40"
            >
              {rhythm.focus === null ? "Bật" : "Tắt"}
            </button>
          </div>
        </section>
        {/* AVORA-57 · A: Chế độ tập trung first, then the "Tắt trong…" layers, then sounds. */}
        <MuteSettingsCard />
        <section aria-labelledby="sound-heading" className="rounded-xl border border-border bg-card p-5">
          <h2 id="sound-heading" className="text-[17px] font-semibold tracking-tight text-foreground">
            Âm báo khi đang mở AVORA
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            Một âm ngắn, nhẹ. Theo đúng các tầng Tắt thông báo ở trên.
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
      </div>
    </div>
  );
};

export default SettingsNotifications;
