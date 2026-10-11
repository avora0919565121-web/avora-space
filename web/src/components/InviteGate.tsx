import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { useAuth } from "@/lib/auth";
import { myInviteGate, normalizeInviteCode, redeemInvite } from "@/lib/invites";

/**
 * AVORA-100 · G.3 — when the team requires an invite code, an account made after that moment
 * without one is held here. The server already shows it nothing (session_allowed); this screen
 * only says why and takes the code. Accounts made before are never asked. Off today.
 */
export function InviteGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const gate = useQuery({
    queryKey: ["invite-gate", user?.id ?? "none"],
    queryFn: myInviteGate,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
  if (gate.data === true) return <InviteGateScreen />;
  return <>{children}</>;
}

export function InviteGateScreen() {
  const { signOut, user } = useAuth();
  const queryClient = useQueryClient();
  const [code, setCode] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState<boolean>(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (code === "" || isWorking) return;
    setIsWorking(true);
    setError(null);
    try {
      await redeemInvite(code);
      await queryClient.invalidateQueries();
      await queryClient.refetchQueries({ queryKey: ["invite-gate", user?.id ?? "none"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsWorking(false);
    }
  };

  const leave = async (): Promise<void> => {
    await signOut().catch(() => undefined);
    window.location.assign("/dang-nhap");
  };

  return (
    <div className="paper flex min-h-[100dvh] items-center justify-center px-6" data-invite-gate="">
      <form onSubmit={submit} className="w-full max-w-sm text-center">
        <p className="wordmark text-[15px] text-muted-foreground">AVORA</p>
        <h1 className="mt-4 text-[24px] font-semibold tracking-tight text-foreground">Nhập mã mời để vào Avora</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">Avora đang mở theo lời mời. Mã mời nằm trong tin nhắn hoặc email bạn được gửi.</p>
        <label htmlFor="gate-code" className="sr-only">
          Mã mời
        </label>
        <input
          id="gate-code"
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          onChange={(event) => setCode(normalizeInviteCode(event.target.value))}
          placeholder="AVR-VN-01"
          className="mt-6 h-12 w-full rounded-control border border-border bg-card px-4 text-center font-mono text-[17px] uppercase tracking-wider text-foreground outline-none placeholder:normal-case focus:border-primary/70"
        />
        {error !== null ? (
          <p role="alert" className="mt-2 text-[14px] text-destructive">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={code === "" || isWorking} className="press mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-control bg-primary text-[15.5px] font-semibold text-primary-foreground disabled:opacity-50">
          {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Vào Avora
        </button>
        <button type="button" onClick={() => void leave()} className="press mt-3 inline-flex min-h-11 items-center gap-1.5 text-[14.5px] text-muted-foreground hover:text-foreground">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Đăng xuất
        </button>
      </form>
    </div>
  );
}
