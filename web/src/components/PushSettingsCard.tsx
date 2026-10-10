import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Share, Smartphone, SquarePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import {
  currentPushSupport,
  currentSubscription,
  disablePushHere,
  enablePush,
  fetchPushDevices,
  removePushDevice,
  type PushDevice,
} from "@/lib/push";
import { useProfileSettings, useSettingsActions } from "@/lib/use-settings";

const devicesKey = ["push-devices"] as const;

/** Cài đặt › Thông báo › Thông báo đẩy (AVORA-46). */
export function PushSettingsCard() {
  const queryClient = useQueryClient();
  const { data: settings } = useProfileSettings();
  const { setPushPrefs } = useSettingsActions();
  const support = currentPushSupport();
  const [hereEndpoint, setHereEndpoint] = useState<string | null>(null);
  useEffect(() => {
    void currentSubscription().then((sub) => setHereEndpoint(sub?.endpoint ?? null));
  }, []);
  const devices = useQuery<PushDevice[], Error>({ queryKey: devicesKey, queryFn: fetchPushDevices, staleTime: 30_000 });
  const hereOn = hereEndpoint !== null && (devices.data ?? []).some((device) => device.endpoint === hereEndpoint);

  const toggleHere = useMutation({
    mutationFn: async (on: boolean): Promise<void> => {
      if (on) {
        const result = await enablePush();
        if (result === "denied") throw new Error("Trình duyệt đang chặn thông báo. Mở cài đặt trang để cho phép.");
        if (result === "unsupported") throw new Error("Thiết bị này chưa nhận được thông báo đẩy.");
      } else {
        await disablePushHere();
      }
      const sub = await currentSubscription();
      setHereEndpoint(sub?.endpoint ?? null);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: devicesKey }),
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (endpoint: string) => removePushDevice(endpoint),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: devicesKey });
      void currentSubscription().then((sub) => setHereEndpoint(sub?.endpoint ?? null));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const setPref = (patch: { pushShowContent?: boolean; pushReminders?: boolean }): void =>
    setPushPrefs.mutate(patch, { onError: (error: Error) => toast.error(error.message) });

  return (
    <section aria-labelledby="push-heading" className="rounded-card border border-border bg-card p-5">
      <h2 id="push-heading" className="flex items-center gap-2 text-[17px] font-semibold tracking-tight text-foreground">
        <BellRing className="h-[18px] w-[18px] text-primary" /> Thông báo khi AVORA đang đóng
      </h2>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
        Mặc định chỉ hiện tên người gửi hoặc tên cuộc — không hiện nội dung. Bấm vào thông báo là mở đúng chỗ.
      </p>
      {support === "ios-needs-install" ? (
        <ol className="mt-4 space-y-2 rounded-lg border border-dashed border-border p-3 text-[13.5px] text-foreground">
          <li className="flex items-center gap-2">
            <Share className="h-4 w-4 shrink-0 text-primary" /> 1. Bấm nút Chia sẻ của Safari.
          </li>
          <li className="flex items-center gap-2">
            <SquarePlus className="h-4 w-4 shrink-0 text-primary" /> 2. Chọn “Thêm vào MH chính”, rồi mở AVORA từ màn hình chính.
          </li>
          <li className="text-[12.5px] text-muted-foreground">iPhone/iPad chỉ nhận thông báo khi AVORA đã được thêm vào màn hình chính (iOS 16.4 trở lên).</li>
        </ol>
      ) : null}
      <div className="mt-4 divide-y divide-border">
        <label className="flex min-h-12 items-center justify-between gap-3 text-[14.5px] text-foreground">
          Thông báo trên thiết bị này
          <Switch
            checked={hereOn}
            disabled={support !== "supported" || toggleHere.isPending || devices.isPending}
            onCheckedChange={(on) => toggleHere.mutate(on)}
            aria-label="Thông báo trên thiết bị này"
          />
        </label>
        <label className="flex min-h-12 items-center justify-between gap-3 text-[14.5px] text-foreground">
          <span>
            Hiện nội dung trong thông báo
            <span className="block text-[12.5px] text-muted-foreground">80 ký tự đầu của tin, tên việc khi nhắc.</span>
          </span>
          <Switch
            checked={settings?.pushShowContent ?? false}
            disabled={settings === undefined || setPushPrefs.isPending}
            onCheckedChange={(on) => setPref({ pushShowContent: on })}
            aria-label="Hiện nội dung trong thông báo"
          />
        </label>
        <label className="flex min-h-12 items-center justify-between gap-3 text-[14.5px] text-foreground">
          Thông báo nhắc việc
          <Switch
            checked={settings?.pushReminders ?? true}
            disabled={settings === undefined || setPushPrefs.isPending}
            onCheckedChange={(on) => setPref({ pushReminders: on })}
            aria-label="Thông báo nhắc việc"
          />
        </label>
      </div>
      <div className="mt-4">
        <p className="text-[13px] font-medium text-muted-foreground">Thiết bị đã bật</p>
        {devices.isError ? (
          <p role="alert" className="mt-1 text-[13px] text-destructive">{devices.error.message}</p>
        ) : (devices.data ?? []).length === 0 ? (
          <p className="mt-1 text-[13px] text-muted-foreground">Chưa có thiết bị nào.</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {(devices.data ?? []).map((device) => (
              <li key={device.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13.5px]">
                <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {device.deviceLabel}
                  {device.endpoint === hereEndpoint ? <span className="ml-1.5 text-[12px] text-primary">(thiết bị này)</span> : null}
                </span>
                <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(device.endpoint)} className="press rounded-md px-2 py-1 text-[12.5px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                  Gỡ
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
