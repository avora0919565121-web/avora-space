import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { askConfirm } from "@/components/ConfirmHost";
import { deviceTimeZone, setAppTimeZone } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
import { TIMEZONE_OPTIONS } from "@/lib/settings";
import { keptZone, rememberKeep, shouldAskZone, zoneLabel } from "@/lib/time-zone-prompt";
import { useProfileSettings, useSettingsActions } from "@/lib/use-settings";

/**
 * 112-E · LOI-03: hands the profile's zone to every day / deadline / habit calculation, and asks once when
 * this device sits in another zone. Renders nothing.
 */
export function TimeZoneSync() {
  const { user } = useAuth();
  const { data: profile } = useProfileSettings();
  const { setTimezone } = useSettingsActions();
  const askedFor = useRef<string | null>(null);
  const profileZone = profile?.timezone ?? null;

  useEffect(() => {
    if (profileZone !== null) setAppTimeZone(profileZone);
  }, [profileZone]);

  useEffect(() => {
    const userId = user?.id;
    if (userId === undefined || profileZone === null) return;
    const device = deviceTimeZone();
    if (!shouldAskZone({ profileZone, deviceZone: device, kept: keptZone(userId) })) return;
    if (askedFor.current === device) return;
    askedFor.current = device;
    void askConfirm({
      title: `Đổi múi giờ hồ sơ sang ${zoneLabel(device, TIMEZONE_OPTIONS)}?`,
      body: `Máy này đang ở múi giờ ${zoneLabel(device, TIMEZONE_OPTIONS)}; hồ sơ của bạn là ${zoneLabel(profileZone, TIMEZONE_OPTIONS)}. Ngày, hạn chót và thói quen trên mọi máy đều tính theo hồ sơ.`,
      confirmLabel: "Đổi",
      cancelLabel: "Giữ",
    }).then((change) => {
      if (!change) {
        rememberKeep(userId, device);
        return;
      }
      setTimezone.mutate(device, {
        onSuccess: () => toast.success(`Đã đổi múi giờ hồ sơ sang ${zoneLabel(device, TIMEZONE_OPTIONS)}`),
        onError: (error) => toast.error(error instanceof Error ? error.message : "Chưa đổi được múi giờ."),
      });
    });
  }, [user?.id, profileZone, setTimezone]);

  return null;
}
