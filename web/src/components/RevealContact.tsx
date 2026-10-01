import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { verifyAccountPassword } from "@/lib/vault-api";

/** How long the full email / phone stays on screen once the password was given again. */
export const REVEAL_MS = 60_000;

/**
 * AVORA-51 · B3 — Hồ sơ › `Hiện đầy đủ`. The account's own email and phone stay masked; showing
 * them whole asks for the account password again (checked on the server, no new sign-in), then
 * covers them again after 60 seconds.
 */
export function useReveal(): {
  isRevealed: boolean;
  secondsLeft: number;
  ask: () => void;
  hide: () => void;
  dialog: ReactElement;
} {
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [isAsking, setIsAsking] = useState<boolean>(false);
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(false);

  useEffect(() => {
    if (until === null) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= until) setUntil(null);
    }, 1000);
    return () => window.clearInterval(id);
  }, [until]);

  const isRevealed = until !== null && now < until;
  const secondsLeft = until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (password.length === 0) {
      setError("Nhập mật khẩu tài khoản nhé.");
      return;
    }
    setIsChecking(true);
    setError(null);
    try {
      const ok = await verifyAccountPassword(password);
      if (!ok) {
        setError("Mật khẩu chưa đúng.");
        return;
      }
      const t = Date.now();
      setNow(t);
      setUntil(t + REVEAL_MS);
      setIsAsking(false);
      setPassword("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Chưa kiểm tra được. Thử lại nhé.");
    } finally {
      setIsChecking(false);
    }
  };

  const dialog = (
    <Dialog
      open={isAsking}
      onOpenChange={(open) => {
        setIsAsking(open);
        if (!open) {
          setPassword("");
          setError(null);
        }
      }}
    >
      <DialogContent className="max-w-[400px]">
        <DialogTitle className="text-[19px] font-semibold tracking-tight">Hiện đầy đủ email và số điện thoại</DialogTitle>
        <DialogDescription className="text-[14px] text-muted-foreground">
          Nhập lại mật khẩu tài khoản. Thông tin hiện trong 60 giây rồi tự che lại.
        </DialogDescription>
        <form onSubmit={(event) => void submit(event)} className="mt-2 space-y-3">
          <input
            type="password"
            spellCheck={false}
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-label="Mật khẩu tài khoản"
            placeholder="Mật khẩu tài khoản"
            className="h-12 w-full rounded-md border border-border bg-card px-4 text-[16px] md:text-[15px] outline-none focus:border-primary/70"
          />
          {error !== null ? (
            <p role="alert" className="text-[13.5px] text-destructive">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isChecking}
            className="press flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-[15px] font-semibold text-primary-foreground hover:bg-primary/92 disabled:opacity-60"
          >
            {isChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Hiện
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );

  return { isRevealed, secondsLeft, ask: () => setIsAsking(true), hide: () => setUntil(null), dialog };
}

/** The small toggle beside the masked values. */
export function RevealButton({ isRevealed, secondsLeft, onAsk, onHide }: { isRevealed: boolean; secondsLeft: number; onAsk: () => void; onHide: () => void }) {
  return (
    <button
      type="button"
      onClick={isRevealed ? onHide : onAsk}
      className="press inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {isRevealed ? <EyeOff className="h-4 w-4" strokeWidth={1.7} /> : <Eye className="h-4 w-4" strokeWidth={1.7} />}
      {isRevealed ? `Che lại · ${secondsLeft}s` : "Hiện đầy đủ"}
    </button>
  );
}
