import type { ReactNode } from "react";

import { ChatLockScreen } from "@/components/chat-lock/ChatLockScreen";
import { useChatLock } from "@/lib/use-chat-lock";

/** AVORA-109 · A1 — while locked, Kết nối (list and thread alike) is replaced, not hidden under a layer. */
export function ChatLockGate({ children }: { children: ReactNode }) {
  const { isLocked } = useChatLock();
  return isLocked ? <ChatLockScreen /> : <>{children}</>;
}
