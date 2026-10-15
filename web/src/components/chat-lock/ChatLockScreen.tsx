import { Lock } from "lucide-react";
import { confirmSignOut } from "@/lib/unsynced";
import { useState } from "react";

import { ChatUnlockForm } from "@/components/chat-lock/ChatUnlockForm";
import { askConfirm } from "@/components/ConfirmHost";
import { useAuth } from "@/lib/auth";
import { clearChatLock } from "@/lib/chat-lock";

/**
 * AVORA-109 · A1 — what Kết nối shows while locked: the app's name, a lock, `Mở`. No names, no
 * previews, no times, no unread counts — the conversation screen is not even mounted.
 */
export function ChatLockScreen() {
  const { user, signOut } = useAuth();
  const [isLeaving, setIsLeaving] = useState<boolean>(false);

  const resetBySignOut = async (): Promise<void> => {
    const ok = await askConfirm({
      title: "Đăng xuất để đặt lại?",
      body: "Đăng nhập lại là đặt lại được khoá này. Khoá chỉ che màn hình nên không mất tin nào.",
      confirmLabel: "Đăng xuất",
    });
    if (!ok) return;
    // 112-C: the lock hides nothing from the outbox — unsent messages are still lost on sign-out.
    if (!(await confirmSignOut(user?.id))) return;
    setIsLeaving(true);
    await clearChatLock(user?.id ?? null);
    await signOut();
  };

  return (
    <section
      className="relative flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-s-4 overflow-hidden bg-card px-6 text-center"
      aria-label="Kết nối đang khoá"
      data-chat-lock-screen=""
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_45%_at_50%_38%,hsl(var(--personal)/0.10),transparent_70%)]" />
      <p className="relative text-[13px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">AVORA</p>
      <span className="relative flex h-16 w-16 items-center justify-center rounded-full border border-border bg-background shadow-sm">
        <Lock className="h-7 w-7 text-foreground" strokeWidth={1.6} aria-hidden="true" />
      </span>
      <h1 className="relative text-[22px] font-semibold tracking-tight text-foreground">Kết nối đang khoá</h1>
      <div className="relative flex w-full flex-col items-center">
        <ChatUnlockForm mode="unlock" onDone={() => undefined} />
      </div>
      <button
        type="button"
        onClick={() => void resetBySignOut()}
        disabled={isLeaving}
        className="relative min-h-11 px-3 text-[14px] text-muted-foreground underline-offset-4 hover:underline"
        data-chat-lock-reset=""
      >
        Quên cách mở? Đăng xuất để đặt lại
      </button>
    </section>
  );
}
