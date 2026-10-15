import { Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ChatLockSetupSheet } from "@/components/chat-lock/ChatLockSetupSheet";
import { ChatUnlockForm } from "@/components/chat-lock/ChatUnlockForm";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AUTO_LOCK_OPTIONS, type ChatAutoLock } from "@/lib/chat-lock";
import { useChatLock } from "@/lib/use-chat-lock";
import { FeatureGate } from "@/components/features/FeatureGate";

type Pending = "change" | "off" | null;

/**
 * AVORA-109 · A2/A3 — Cài đặt › Riêng tư › `Khoá Kết nối` and `Tự khoá Kết nối`. Changing the way
 * to open or turning the lock off first asks the current way (otherwise Settings would be a side door).
 */
function ChatLockSettingsInner() {
  const { config, isEnabled, setAutoLock, turnOff } = useChatLock();
  const [isSetupOpen, setIsSetupOpen] = useState<boolean>(false);
  const [setupLocks, setSetupLocks] = useState<boolean>(true);
  const [pending, setPending] = useState<Pending>(null);

  const afterConfirm = async (): Promise<void> => {
    const what = pending;
    setPending(null);
    if (what === "off") {
      await turnOff();
      toast.success("Đã tắt Khoá Kết nối trên máy này.");
    } else if (what === "change") {
      setSetupLocks(false);
      setIsSetupOpen(true);
    }
  };

  const methodText = config?.method === "device" ? "Mở bằng khoá màn hình của máy" : config?.method === "code" ? "Mở bằng mã số riêng cho máy này" : "Đang tắt";

  return (
    <div className="mt-s-4 border-t border-border pt-s-4" data-chat-lock-settings="">
      <div className="flex min-h-12 items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-[15px] font-medium text-foreground">
            <Lock className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
            Khoá Kết nối
          </span>
          <span className="mt-1 block text-[12.5px] leading-5 text-muted-foreground" data-chat-lock-status="">
            {methodText}. Chỉ che Kết nối trên máy này.
          </span>
        </span>
        {isEnabled ? null : (
          <button
            type="button"
            onClick={() => {
              setSetupLocks(true);
              setIsSetupOpen(true);
            }}
            className="press h-10 shrink-0 rounded-control border border-border px-4 text-[15px] font-medium text-foreground hover:bg-accent/40"
            data-chat-lock-enable=""
          >
            Bật
          </button>
        )}
      </div>
      {isEnabled && config !== null ? (
        <div className="mt-s-2 space-y-s-2">
          <label className="flex min-h-12 items-center justify-between gap-3">
            <span className="text-[15px] text-foreground">Tự khoá Kết nối</span>
            <select
              value={config.autoLock}
              onChange={(event) => setAutoLock(event.target.value as ChatAutoLock)}
              className="h-10 max-w-[60%] rounded-control border border-input bg-background px-3 text-[16px] text-foreground"
              data-chat-lock-auto=""
            >
              {AUTO_LOCK_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPending("change")} className="press h-10 rounded-control border border-border px-4 text-[15px] text-foreground hover:bg-accent/40" data-chat-lock-change="">
              Đổi cách mở
            </button>
            <button type="button" onClick={() => setPending("off")} className="press h-10 rounded-control border border-border px-4 text-[15px] text-foreground hover:bg-accent/40" data-chat-lock-off="">
              Tắt khoá
            </button>
          </div>
        </div>
      ) : null}
      <ChatLockSetupSheet open={isSetupOpen} onOpenChange={setIsSetupOpen} lockAfter={setupLocks} />
      <Dialog open={pending !== null} onOpenChange={(next) => (next ? undefined : setPending(null))}>
        <DialogContent className="max-w-sm" data-chat-lock-confirm="">
          <DialogHeader>
            <DialogTitle>{pending === "off" ? "Tắt Khoá Kết nối" : "Đổi cách mở"}</DialogTitle>
            <DialogDescription>Mở bằng cách hiện tại trước đã.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center pt-s-2">
            <ChatUnlockForm mode="confirm" onDone={() => void afterConfirm()} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** AVORA-112-B: behind the `chat_lock` switch (stable · soon · hidden). */
export function ChatLockSettings() {
  return (
    <FeatureGate feature="chat_lock">
      <ChatLockSettingsInner />
    </FeatureGate>
  );
}
