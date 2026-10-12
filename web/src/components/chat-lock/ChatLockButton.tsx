import { Lock } from "lucide-react";
import { useState } from "react";

import { ChatLockSetupSheet } from "@/components/chat-lock/ChatLockSetupSheet";
import { useChatLock } from "@/lib/use-chat-lock";

/**
 * AVORA-109 · A1 — `Khoá` in Kết nối's top row (same kind of button as its neighbours, ADR-059).
 * Tap = lock now; the first time it opens the two-step setup instead, which locks when done.
 */
export function ChatLockButton() {
  const { isEnabled, lock } = useChatLock();
  const [isSetupOpen, setIsSetupOpen] = useState<boolean>(false);
  return (
    <>
      <button
        type="button"
        onClick={() => (isEnabled ? lock() : setIsSetupOpen(true))}
        aria-label={isEnabled ? "Khoá Kết nối" : "Khoá Kết nối — thiết lập"}
        title="Khoá"
        data-chat-lock-button=""
        className="icon-btn h-11 w-11 text-foreground"
      >
        <Lock className="h-[18px] w-[18px]" strokeWidth={1.6} aria-hidden="true" />
      </button>
      <ChatLockSetupSheet open={isSetupOpen} onOpenChange={setIsSetupOpen} />
    </>
  );
}
