import { X } from "lucide-react";
import { useState } from "react";

import { dismissGuestNotice, isGuestMachine, isGuestNoticeDismissed } from "@/lib/guest-machine";

/**
 * AVORA-54 · A — the quiet strip on top while this tab is a guest machine: one reminder that the
 * session dies with the tab and one nudge to sign out when done. Closable; the dismissal is kept
 * per tab, so a reload in the same tab brings it back — a borrowed machine deserves the reminder.
 */
export function GuestMachineBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => isGuestNoticeDismissed());

  if (!isGuestMachine() || dismissed) return null;

  return (
    <div role="status" className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/[0.08] px-4 py-2 text-[13px]">
      <span className="min-w-0 flex-1 truncate text-foreground">
        Bạn đang dùng máy của người khác · Đăng xuất khi xong
      </span>
      <button
        type="button"
        aria-label="Ẩn nhắc này"
        onClick={() => {
          dismissGuestNotice();
          setDismissed(true);
        }}
        className="press shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <X className="h-4 w-4" strokeWidth={1.8} />
      </button>
    </div>
  );
}
