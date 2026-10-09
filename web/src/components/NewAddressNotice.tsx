import { useState } from "react";
import { Link } from "react-router-dom";

import { deviceLabelOf } from "@/lib/device";
import { useDeviceStatus } from "@/lib/use-device";
import { APP_HOST } from "@/lib/app-origin";
import { isGuestMachine } from "@/lib/guest-machine";

const SEEN_KEY = "avora.new-address.seen";

/**
 * KHỐI 0 · 4 — data on a device belongs to one address, so the first visit to the new address is a
 * new device to AVORA. When the account already has a main device (held from the old address), say
 * so once and lead into the 67 rank flow. No rank moves by itself (ADR-042: password + email code).
 */
export function NewAddressNotice() {
  const { status } = useDeviceStatus();
  const [seen, setSeen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      return true;
    }
  });
  const close = (): void => {
    setSeen(true);
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Without storage the note may come back once.
    }
  };
  if (seen || status === undefined || !status.allowed || status.device === null || status.guest || isGuestMachine()) return null;
  // When the suggested rank is free, DeviceRankPrompt already asks; this note is for a rank held elsewhere.
  const { kind } = deviceLabelOf(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  const suggested: 1 | 2 = kind === "phone" ? 1 : 2;
  if (status.myRank !== 3 || !status.rankTaken[suggested]) return null;

  return (
    <div role="dialog" aria-labelledby="new-address-title" data-new-address="" className="fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-50 mx-auto max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl md:bottom-6">
      <h2 id="new-address-title" className="text-[17px] font-semibold text-foreground">Đây là địa chỉ mới của Avora</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
        Máy này cần đặt lại làm máy chính (mật khẩu + mã email) và mở Két sắt bằng Mật khẩu Két sắt một lần. Nhớ cài lại Avora lên
        Màn hình chính từ {APP_HOST} và bật lại thông báo.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={close} className="press h-11 rounded-lg px-4 text-[14px] text-muted-foreground">Để sau</button>
        <Link to="/cai-dat#bao-mat" onClick={close} className="press inline-flex h-11 items-center rounded-lg bg-primary px-4 text-[14px] font-semibold text-primary-foreground">
          Đặt máy chính
        </Link>
      </div>
    </div>
  );
}
