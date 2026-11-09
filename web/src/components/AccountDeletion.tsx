import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, KeyRound, Loader2, Mail, Trash2, UserX } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  accountDeletionApi,
  accountDeletionKeys,
  CONFIRM_WORD,
  daysUntil,
  DELETION_KEEPS,
  DELETION_LOSES,
  formatDeletionDate,
  gateAckKey,
  isConfirmWord,
  readGateAck,
  writeGateAck,
  type DeletionStatus,
} from "@/lib/account-deletion";
import { useAuth } from "@/lib/auth";
import { useFeature } from "@/lib/use-feature";
import { cn } from "@/lib/utils";

/** 111-A · the deletion status of the signed-in account, shared by the section and the gate. */
function useDeletionStatus(): { status: DeletionStatus | undefined; isLoading: boolean } {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: accountDeletionKeys.status(user?.id ?? ""),
    queryFn: () => accountDeletionApi.status(),
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    retry: 1,
  });
  return { status: query.data, isLoading: query.isPending && Boolean(user?.id) };
}

function useKeepAccount(): { keep: () => Promise<boolean>; isKeeping: boolean } {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isKeeping, setIsKeeping] = useState<boolean>(false);
  const keep = async (): Promise<boolean> => {
    setIsKeeping(true);
    try {
      await accountDeletionApi.cancel();
      await queryClient.invalidateQueries({ queryKey: accountDeletionKeys.status(user?.id ?? "") });
      toast.success("Đã giữ tài khoản. Không có gì bị xoá.");
      return true;
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : "Chưa làm được. Thử lại nhé.");
      return false;
    } finally {
      setIsKeeping(false);
    }
  };
  return { keep, isKeeping };
}

const inputClass =
  "h-12 w-full rounded-md border border-border bg-card px-4 text-[16px] md:text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-personal/70";
const primaryClass =
  "press flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-50";
const dangerClass =
  "press flex h-12 w-full items-center justify-center gap-2 rounded-md bg-destructive text-[15px] font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-40";
const quietClass =
  "press flex min-h-11 w-full items-center justify-center gap-2 rounded-md text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50";

type Step = "info" | "password" | "otp" | "confirm";

/**
 * Cài đặt › Hồ sơ › Tài khoản (id `tai-khoan`). The light-red button opens the flow — two taps from
 * Cài đặt. A pending request shows its date and `Giữ tài khoản` here too, whatever the switch says.
 */
export function AccountDeletionSection() {
  const feature = useFeature("account_deletion");
  const { status } = useDeletionStatus();
  const { keep, isKeeping } = useKeepAccount();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const pending = status?.status === "pending";

  if (!pending && feature === "hidden") return null;

  return (
    <section id="tai-khoan" aria-labelledby="account-heading" data-testid="account-section" className="mt-s-4 scroll-mt-4 rounded-card border border-border bg-card p-s-4">
      <h2 id="account-heading" className="text-[17px] font-semibold text-foreground">Tài khoản</h2>
      {pending ? (
        <div className="mt-s-2 rounded-md border border-destructive/25 bg-destructive/[0.06] p-s-2" data-testid="account-pending">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-destructive">
            <CalendarClock className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} aria-hidden="true" />
            Tài khoản sẽ bị xoá vào ngày {formatDeletionDate(status?.executeAfter ?? null)}
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
            Còn {daysUntil(status?.executeAfter ?? null)} ngày để đổi ý. Đăng nhập không tự huỷ yêu cầu — bấm Giữ tài khoản nếu bạn muốn ở lại.
          </p>
          <button type="button" onClick={() => void keep()} disabled={isKeeping} className={cn(primaryClass, "mt-s-2 h-11")} data-testid="account-keep">
            {isKeeping ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Giữ tài khoản
          </button>
        </div>
      ) : (
        <>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Xoá tài khoản và dữ liệu riêng của bạn. Có {status?.graceDays ?? 14} ngày để đổi ý.
          </p>
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            disabled={feature !== "stable"}
            data-testid="account-delete-open"
            className="press mt-s-2 flex min-h-11 items-center gap-2 rounded-md border border-destructive/25 bg-destructive/[0.07] px-4 text-[14px] font-medium text-destructive transition-colors hover:bg-destructive/[0.12] disabled:opacity-50"
          >
            <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.6} aria-hidden="true" />
            Xoá tài khoản
          </button>
        </>
      )}
      <DeleteAccountDialog open={isOpen} onOpenChange={setIsOpen} graceDays={status?.graceDays ?? 14} />
    </section>
  );
}

function DeleteAccountDialog({ open, onOpenChange, graceDays }: { open: boolean; onOpenChange: (open: boolean) => void; graceDays: number }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("info");
  const [password, setPassword] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [word, setWord] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState<boolean>(false);

  const reset = (): void => {
    setStep("info");
    setPassword("");
    setCode("");
    setSentTo(null);
    setWord("");
    setError(null);
    setIsWorking(false);
  };

  const run = async (work: () => Promise<void>): Promise<void> => {
    setIsWorking(true);
    setError(null);
    try {
      await work();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Chưa làm được. Thử lại nhé.");
    } finally {
      setIsWorking(false);
    }
  };

  const checkPassword = (): Promise<void> =>
    run(async () => {
      if (password.length === 0) throw new Error("Nhập mật khẩu tài khoản nhé.");
      const ok = await accountDeletionApi.reauthPassword(password);
      if (!ok) throw new Error("Mật khẩu chưa đúng.");
      setPassword("");
      setStep("confirm");
    });

  const sendCode = (): Promise<void> =>
    run(async () => {
      const r = await accountDeletionApi.requestOtp();
      setSentTo(r.to);
      setCode("");
      setStep("otp");
    });

  const checkCode = (): Promise<void> =>
    run(async () => {
      if (!/^[0-9]{6}$/.test(code.trim())) throw new Error("Mã gồm 6 chữ số.");
      const r = await accountDeletionApi.verifyOtp(code);
      if ("reason" in r) throw new Error(r.reason === "expired" ? "Mã đã hết hạn hoặc sai quá 5 lần. Bấm Gửi lại mã." : "Mã chưa đúng.");
      setCode("");
      setStep("confirm");
    });

  const confirm = (): Promise<void> =>
    run(async () => {
      if (!isConfirmWord(word)) throw new Error(`Gõ ${CONFIRM_WORD} để xác nhận.`);
      const r = await accountDeletionApi.request();
      await queryClient.invalidateQueries({ queryKey: accountDeletionKeys.status(user?.id ?? "") });
      // This sign-in already knows: the full-screen notice waits for the next one.
      writeGateAck(gateAckKey(user?.id ?? "", user?.last_sign_in_at));
      toast.success(`Đã ghi nhận. Tài khoản sẽ bị xoá vào ngày ${formatDeletionDate(r.executeAfter)}. Email xác nhận đã được gửi.`);
      onOpenChange(false);
      reset();
    });

  const title =
    step === "info" ? "Xoá tài khoản AVORA?" : step === "confirm" ? "Bước cuối" : "Xác nhận là bạn";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-h-[92dvh] max-w-[440px] overflow-y-auto overflow-x-hidden" data-testid="account-delete-dialog" data-step={step}>
        <DialogTitle className="text-[19px] font-semibold tracking-tight">{title}</DialogTitle>
        {step === "info" ? (
          <>
            <DialogDescription className="text-[14px] text-muted-foreground">
              Sau khi xác nhận, bạn có {graceDays} ngày để đổi ý. Hết thời gian đó, những thứ dưới đây bị xoá và không khôi phục được.
            </DialogDescription>
            <ul className="mt-1 space-y-2" aria-label="Dữ liệu sẽ mất">
              {DELETION_LOSES.map((line) => (
                <li key={line} className="flex gap-2 text-[14px] leading-relaxed text-foreground">
                  <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-destructive/70" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Còn lại với người khác</p>
            <ul className="space-y-2">
              {DELETION_KEEPS.map((line) => (
                <li key={line} className="flex gap-2 text-[14px] leading-relaxed text-muted-foreground">
                  <UserX className="mt-[3px] h-4 w-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 space-y-1">
              <button type="button" className={primaryClass} onClick={() => setStep("password")} data-testid="account-delete-next">
                Tiếp tục
              </button>
              <button type="button" className={quietClass} onClick={() => onOpenChange(false)}>
                Giữ tài khoản
              </button>
            </div>
          </>
        ) : null}

        {step === "password" ? (
          <>
            <DialogDescription className="text-[14px] text-muted-foreground">
              Nhập mật khẩu tài khoản AVORA. Không cần PIN hay mã Két sắt.
            </DialogDescription>
            <label htmlFor="deletePassword" className="sr-only">Mật khẩu tài khoản</label>
            <input
              id="deletePassword"
              type="password"
              autoComplete="current-password"
              spellCheck={false}
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                // Enter does not submit (AVORA rule): a destructive step is a tap.
                if (event.key === "Enter") event.preventDefault();
              }}
              placeholder="Mật khẩu tài khoản"
              className={inputClass}
              data-testid="account-delete-password"
            />
            {error !== null ? <p role="alert" className="text-[13.5px] text-destructive">{error}</p> : null}
            <button type="button" className={primaryClass} disabled={isWorking || password.length === 0} onClick={() => void checkPassword()} data-testid="account-delete-password-ok">
              {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
              Xác nhận
            </button>
            <button type="button" className={quietClass} disabled={isWorking} onClick={() => void sendCode()} data-testid="account-delete-forgot">
              <Mail className="h-4 w-4" aria-hidden="true" />
              Tôi quên mật khẩu — gửi mã qua email
            </button>
          </>
        ) : null}

        {step === "otp" ? (
          <>
            <DialogDescription className="text-[14px] text-muted-foreground">
              Đã gửi mã 6 số tới <span translate="no" className="font-medium text-foreground">{sentTo}</span>. Mã hết hạn sau 10 phút.
            </DialogDescription>
            <label htmlFor="deleteCode" className="sr-only">Mã xác nhận</label>
            <input
              id="deleteCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
              placeholder="••••••"
              className={cn(inputClass, "tabular text-center text-[22px] tracking-[0.4em] md:text-[22px]")}
              data-testid="account-delete-code"
            />
            {error !== null ? <p role="alert" className="text-[13.5px] text-destructive">{error}</p> : null}
            <button type="button" className={primaryClass} disabled={isWorking || code.length !== 6} onClick={() => void checkCode()} data-testid="account-delete-code-ok">
              {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Xác nhận mã
            </button>
            <button type="button" className={quietClass} disabled={isWorking} onClick={() => void sendCode()}>
              Gửi lại mã
            </button>
          </>
        ) : null}

        {step === "confirm" ? (
          <>
            <DialogDescription className="text-[14px] text-muted-foreground">
              Gõ <strong className="font-semibold tracking-[0.12em] text-foreground">{CONFIRM_WORD}</strong> rồi bấm nút đỏ. Tài khoản bị xoá sau {graceDays} ngày; trong thời gian đó bạn vẫn đăng nhập và bấm Giữ tài khoản được.
            </DialogDescription>
            <label htmlFor="deleteWord" className="sr-only">Gõ {CONFIRM_WORD}</label>
            <input
              id="deleteWord"
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={word}
              onChange={(event) => setWord(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
              placeholder={CONFIRM_WORD}
              className={cn(inputClass, "text-center font-semibold tracking-[0.3em]")}
              data-testid="account-delete-word"
            />
            {error !== null ? <p role="alert" className="text-[13.5px] text-destructive">{error}</p> : null}
            <button type="button" className={dangerClass} disabled={isWorking || !isConfirmWord(word)} onClick={() => void confirm()} data-testid="account-delete-confirm">
              {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              Xoá tài khoản sau {graceDays} ngày
            </button>
            <button type="button" className={quietClass} onClick={() => onOpenChange(false)}>
              Giữ tài khoản
            </button>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * While a deletion is pending, every sign-in opens on this screen first: the date, `Giữ tài khoản`
 * (cancels) and `Tiếp tục xoá` (keeps the request, shows the app until the next sign-in). Signing in
 * never cancels by itself. A failed status read lets the app through rather than locking anyone out.
 */
export function AccountDeletionGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { status } = useDeletionStatus();
  const { keep, isKeeping } = useKeepAccount();
  const ackKey = gateAckKey(user?.id ?? "", user?.last_sign_in_at);
  const [acked, setAcked] = useState<string | null>(null);
  const isAcked = acked === ackKey || readGateAck(ackKey);

  if (status?.status !== "pending" || isAcked) return <>{children}</>;

  const date = formatDeletionDate(status.executeAfter);
  const left = daysUntil(status.executeAfter);
  return (
    <div
      role="alertdialog"
      aria-labelledby="deletion-gate-title"
      aria-describedby="deletion-gate-body"
      data-testid="account-deletion-gate"
      className="paper fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto overflow-x-hidden px-6 py-[max(env(safe-area-inset-top),24px)]"
    >
      <div className="w-full max-w-sm animate-rise-in text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <CalendarClock className="h-8 w-8" strokeWidth={1.6} aria-hidden="true" />
        </span>
        <h1 id="deletion-gate-title" className="mt-6 text-[24px] font-semibold tracking-tight text-foreground">
          Tài khoản sẽ bị xoá vào ngày {date}
        </h1>
        <p id="deletion-gate-body" className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          Còn {left} ngày. Bạn vẫn dùng AVORA bình thường đến hôm đó. Muốn ở lại thì bấm Giữ tài khoản — chỉ đăng nhập thì yêu cầu xoá vẫn còn.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={isKeeping}
            onClick={() => void keep().then((ok) => (ok ? setAcked(ackKey) : undefined))}
            className={primaryClass}
            data-testid="account-gate-keep"
          >
            {isKeeping ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            Giữ tài khoản
          </button>
          <button
            type="button"
            disabled={isKeeping}
            onClick={() => {
              writeGateAck(ackKey);
              setAcked(ackKey);
            }}
            className="press flex h-12 items-center justify-center rounded-md border border-border bg-card text-[15px] font-medium text-foreground transition-colors hover:bg-accent/40"
            data-testid="account-gate-continue"
          >
            Tiếp tục xoá
          </button>
        </div>
      </div>
    </div>
  );
}
