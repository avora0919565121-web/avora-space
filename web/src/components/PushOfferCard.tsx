import { BellRing, Share, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { currentPushSupport, currentSubscription, enablePush, PUSH_OFFER_EVENT, readAskState, rememberAskLater, shouldOfferPush } from "@/lib/push";
import { isGuestMachine } from "@/lib/guest-machine";

/**
 * "Bật thông báo để không lỡ tin và nhắc việc?" — shown after the first message sent or the first
 * reminder set (never on opening the app). The browser's own prompt comes only after "Bật".
 */
export function PushOfferCard() {
  const [visible, setVisible] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const support = currentPushSupport();

  useEffect(() => {
    const onOffer = (): void => {
      // AVORA-54 · A: a guest-machine session is never asked to take notifications and never
      // registers this device — nothing about AVORA may stay on a borrowed machine.
      if (isGuestMachine()) return;
      void currentSubscription().then((sub) => {
        const permission = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
        if (shouldOfferPush({ support, permission, subscribed: sub !== null, laterAt: readAskState().laterAt })) setVisible(true);
      });
    };
    window.addEventListener(PUSH_OFFER_EVENT, onOffer);
    return () => window.removeEventListener(PUSH_OFFER_EVENT, onOffer);
  }, [support]);

  if (!visible) return null;
  const later = (): void => {
    rememberAskLater();
    setVisible(false);
  };
  return (
    <div role="dialog" aria-label="Bật thông báo" className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-sm animate-rise-in rounded-2xl border border-border bg-card p-4 shadow-xl md:bottom-6 md:right-6 md:left-auto">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <BellRing className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-semibold text-foreground">Bật thông báo để không lỡ tin và nhắc việc?</p>
          {support === "ios-needs-install" ? (
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              Trên iPhone/iPad: bấm <Share className="inline h-3.5 w-3.5" /> Chia sẻ → “Thêm vào MH chính”, rồi mở AVORA từ màn hình chính và bật trong Cài đặt › Thông báo.
            </p>
          ) : (
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Chỉ hiện tên người gửi, không hiện nội dung.</p>
          )}
        </div>
        <button type="button" aria-label="Đóng" onClick={later} className="press rounded-md p-1 text-muted-foreground hover:bg-accent">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={later} className="press rounded-md px-3 py-2 text-[13.5px] text-muted-foreground hover:bg-accent/50">
          Để sau
        </button>
        {support === "supported" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void enablePush()
                .then((result) => {
                  if (result === "granted") toast.success("Đã bật thông báo trên thiết bị này.");
                  else if (result === "denied") toast("Đã không bật. Có thể bật lại trong Cài đặt › Thông báo.");
                  setVisible(false);
                })
                .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Chưa bật được thông báo."))
                .finally(() => setBusy(false));
            }}
            className="press rounded-md bg-primary px-4 py-2 text-[13.5px] font-semibold text-primary-foreground disabled:opacity-60"
          >
            Bật
          </button>
        ) : null}
      </div>
    </div>
  );
}
