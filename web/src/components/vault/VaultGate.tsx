import { ChevronLeft, Loader2, Lock, LockKeyhole, Mail, MonitorSmartphone, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { ClaimMainDeviceButton } from "@/components/DeviceSecurity";
import { CodePad } from "@/components/vault/CodePad";
import { VaultForgotEncrypted } from "@/components/vault/VaultForgot";
import { VaultAboutText } from "@/components/vault/VaultAbout";
import { useAuth } from "@/lib/auth";
import { maskEmail } from "@/lib/mask";
import { useVaultLock } from "@/lib/use-vault-lock";
import { requestVaultReset } from "@/lib/vault-api";
import {
  VAULT_MAIN_ONLY,
  VAULT_SET_HINT,
  readIntroSeen,
  vaultErrorMessage,
  waitLine,
  wrongCodeLine,
  writeIntroSeen,
} from "@/lib/vault-lock";

type Step =
  | { kind: "unlock" }
  | { kind: "intro" }
  | { kind: "set"; first: string | null }
  | { kind: "forgot" }
  | { kind: "email-code" }
  | { kind: "reset-new"; emailCode: string; first: string | null };

function errorText(error: unknown): string {
  return error instanceof Error ? vaultErrorMessage(error.message) : "Chưa làm được. Thử lại nhé.";
}

/** Ticks once a second while a wait is running, so `mm:ss` counts down by itself. */
function useNow(isRunning: boolean): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);
  return now;
}

function Shell({ icon, title, children, onBack }: { icon: ReactNode; title: string; children: ReactNode; onBack?: () => void }) {
  return (
    <div className="paper relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pb-10 pt-8 md:pt-14">
      {/* A faint warm halo behind the lock — the room is closed, not alarmed. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-[340px] w-[340px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,hsl(var(--accent))_0%,transparent_68%)] opacity-80"
      />
      <div className="animate-rise-in relative flex w-full max-w-[360px] flex-col items-center text-center">
        {onBack !== undefined ? (
          <button
            type="button"
            onClick={onBack}
            className="press absolute -left-2 -top-2 inline-flex min-h-11 items-center gap-1.5 px-2 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
            Quay lại
          </button>
        ) : null}
        <div className="mt-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-foreground shadow-[0_6px_24px_-12px_hsl(30_20%_20%/0.35)]">
          {icon}
        </div>
        <h2 className="mt-4 text-[22px] font-semibold tracking-tight text-foreground">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * AVORA-51 · the screen over the whole of Két sắt while it is locked: first code, unlock, and
 * "Quên mã?" through an emailed code. Every decision is the server's; this only asks and says.
 */
export function VaultGate() {
  const { user } = useAuth();
  const vault = useVaultLock();
  const status = vault.status;
  const userId = user?.id ?? "";

  const initial = (): Step => {
    if (status?.hasCode === true) return { kind: "unlock" };
    if (status?.hasData === true && !readIntroSeen(userId)) return { kind: "intro" };
    return { kind: "set", first: null };
  };
  const [step, setStep] = useState<Step>(initial);
  const [code, setCode] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [shake, setShake] = useState<number>(0);
  const [isBusy, setIsBusy] = useState<boolean>(false);

  const lockedUntil = status?.lockedUntil ?? null;
  const now = useNow(lockedUntil !== null);
  const isWaiting = lockedUntil !== null && new Date(lockedUntil).getTime() > now;

  useEffect(() => {
    if (lockedUntil !== null && !isWaiting) void vault.refresh();
  }, [isWaiting, lockedUntil, vault]);

  const go = useCallback((next: Step): void => {
    setStep(next);
    setCode("");
    setMessage(null);
  }, []);

  const wrong = useCallback((text: string): void => {
    setShake((n) => n + 1);
    setCode("");
    setMessage(text);
  }, []);

  const run = useCallback(async (work: () => Promise<void>): Promise<void> => {
    setIsBusy(true);
    try {
      await work();
    } catch (error) {
      setCode("");
      setMessage(errorText(error));
    } finally {
      setIsBusy(false);
    }
  }, []);

  const handleUnlock = useCallback(
    (value: string) =>
      run(async () => {
        const attempt = await vault.unlock(value);
        if (attempt.ok === true) return;
        if ("lockedUntil" in attempt) wrong(waitLine(attempt.lockedUntil, Date.now()));
        else if ("remaining" in attempt) wrong(wrongCodeLine(attempt.remaining));
      }),
    [run, vault, wrong],
  );

  const handleSet = useCallback(
    (value: string): void => {
      if (step.kind !== "set") return;
      if (step.first === null) {
        setStep({ kind: "set", first: value });
        setCode("");
        setMessage(null);
        return;
      }
      if (step.first !== value) {
        setStep({ kind: "set", first: null });
        wrong("Hai lần nhập chưa khớp. Đặt lại từ đầu nhé.");
        return;
      }
      void run(async () => {
        await vault.setCode(value);
        writeIntroSeen(userId);
      });
    },
    [run, step, userId, vault, wrong],
  );

  const handleReset = useCallback(
    (value: string): void => {
      if (step.kind !== "reset-new") return;
      if (step.first === null) {
        setStep({ ...step, first: value });
        setCode("");
        setMessage(null);
        return;
      }
      if (step.first !== value) {
        setStep({ ...step, first: null });
        wrong("Hai lần nhập chưa khớp. Đặt lại từ đầu nhé.");
        return;
      }
      void run(async () => {
        const attempt = await vault.confirmReset(step.emailCode, value);
        if (attempt.ok === true) return;
        if ("remaining" in attempt) {
          go({ kind: "email-code" });
          wrong("Mã xác nhận chưa đúng. Kiểm tra lại email nhé.");
        } else {
          go({ kind: "forgot" });
          setMessage("Mã xác nhận đã hết hạn hoặc đã dùng. Xin mã mới nhé.");
        }
      });
    },
    [go, run, step, vault, wrong],
  );

  const sendEmail = useCallback(
    () =>
      run(async () => {
        await requestVaultReset();
        go({ kind: "email-code" });
      }),
    [go, run],
  );

  const line = (fallback: string | null): ReactNode => {
    const text = isWaiting && lockedUntil !== null ? waitLine(lockedUntil, now) : (message ?? fallback);
    return (
      <p role={message !== null || isWaiting ? "alert" : undefined} className="mt-2 min-h-[44px] text-[14px] leading-snug text-muted-foreground">
        {text}
      </p>
    );
  };

  // AVORA-102 · A1.2: told before, never set-then-refused. No code pad, no `Quên mã` here.
  if (status?.deviceAllowed === false) {
    return (
      <Shell icon={<MonitorSmartphone className="h-6 w-6" strokeWidth={1.6} />} title="Két sắt">
        <div data-vault-main-only="" className="contents">
          <p className="mt-2 text-[15px] leading-relaxed text-foreground">{VAULT_MAIN_ONLY}</p>
          {status.deviceBound ? null : (
            <p className="mt-3 rounded-lg bg-secondary/60 px-3 py-2 text-[13.5px] leading-snug text-foreground" data-vault-unbound="">
              Máy này chưa được nhận ra — đặt lại máy chính.
            </p>
          )}
          <div className="mt-6 flex w-full flex-col gap-2">
            <ClaimMainDeviceButton
              onDone={() => void vault.refresh()}
              className="press flex h-12 w-full items-center justify-center rounded-md bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92"
            />
            <Link
              to="/cai-dat#bao-mat"
              className="press flex h-12 w-full items-center justify-center rounded-md border border-border bg-card text-[14.5px] font-medium text-foreground hover:bg-secondary"
            >
              Cho phép mở trên máy khác
            </Link>
          </div>
          <p className="mt-4 text-[12.5px] leading-snug text-muted-foreground">Đổi ở Cài đặt › Hồ sơ › Bảo mật. Cần mật khẩu tài khoản.</p>
        </div>
      </Shell>
    );
  }

  if (step.kind === "intro") {
    return (
      <Shell icon={<LockKeyhole className="h-6 w-6" strokeWidth={1.6} />} title="Trước khi đặt mã Két sắt">
        <div className="mt-5 rounded-xl border border-border bg-card p-5">
          <VaultAboutText />
        </div>
        <button
          type="button"
          onClick={() => {
            writeIntroSeen(userId);
            go({ kind: "set", first: null });
          }}
          className="press mt-6 h-12 w-full rounded-md bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92"
        >
          Tôi đã hiểu
        </button>
      </Shell>
    );
  }

  if (step.kind === "set") {
    const isSecond = step.first !== null;
    return (
      <Shell
        icon={<LockKeyhole className="h-6 w-6" strokeWidth={1.6} />}
        title={isSecond ? "Nhập lại mã Két sắt" : "Đặt mã Két sắt"}
        onBack={isSecond ? () => go({ kind: "set", first: null }) : undefined}
      >
        {line(isSecond ? "Nhập lại đúng 6 số vừa chọn." : VAULT_SET_HINT)}
        <CodePad label="Mã Két sắt" value={code} onChange={setCode} onComplete={handleSet} isDisabled={isBusy} shakeKey={shake} />
        {!isSecond ? (
          <details className="mt-7 w-full rounded-xl border border-border bg-card px-4 py-3 text-left">
            <summary className="cursor-pointer text-[13.5px] font-medium text-foreground">Về khoá Két sắt</summary>
            <VaultAboutText className="mt-3" />
          </details>
        ) : null}
        {isBusy ? <Loader2 className="mt-4 h-5 w-5 animate-spin text-muted-foreground" aria-label="Đang lưu" /> : null}
      </Shell>
    );
  }

  // AVORA-68 · 68.8: an encrypted account never resets through email — the passphrase / kit do.
  if (step.kind === "forgot" && status?.hasKeyring === true) {
    return <VaultForgotEncrypted onBack={() => go({ kind: "unlock" })} />;
  }

  if (step.kind === "forgot") {
    return (
      <Shell icon={<Mail className="h-6 w-6" strokeWidth={1.6} />} title="Quên mã Két sắt" onBack={() => go({ kind: "unlock" })}>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          Gửi mã xác nhận 6 số tới <span className="font-medium text-foreground">{maskEmail(user?.email)}</span>. Mã dùng
          một lần, hết hạn sau 10 phút.
        </p>
        {message !== null ? (
          <p role="alert" className="mt-3 text-[14px] text-destructive">
            {message}
          </p>
        ) : null}
        <button
          type="button"
          disabled={isBusy}
          onClick={() => void sendEmail()}
          className="press mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-60"
        >
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Gửi mã xác nhận
        </button>
        <div
          aria-disabled="true"
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-md border border-dashed border-border text-[14px] text-muted-foreground/70"
        >
          <Smartphone className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />
          Xác nhận qua số điện thoại · Sắp có
        </div>
      </Shell>
    );
  }

  if (step.kind === "email-code") {
    return (
      <Shell icon={<Mail className="h-6 w-6" strokeWidth={1.6} />} title="Nhập mã từ email" onBack={() => go({ kind: "forgot" })}>
        {line(`Mã 6 số vừa gửi tới ${maskEmail(user?.email)}.`)}
        <CodePad
          label="Mã xác nhận"
          value={code}
          onChange={setCode}
          onComplete={(value) => go({ kind: "reset-new", emailCode: value, first: null })}
          isDisabled={isBusy}
          shakeKey={shake}
        />
        <button
          type="button"
          disabled={isBusy}
          onClick={() => void sendEmail()}
          className="press mt-6 min-h-11 text-[13.5px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Chưa nhận được? Gửi lại
        </button>
      </Shell>
    );
  }

  if (step.kind === "reset-new") {
    const isSecond = step.first !== null;
    return (
      <Shell
        icon={<LockKeyhole className="h-6 w-6" strokeWidth={1.6} />}
        title={isSecond ? "Nhập lại mã mới" : "Đặt mã Két sắt mới"}
        onBack={() => go({ kind: "email-code" })}
      >
        {line(isSecond ? "Nhập lại đúng 6 số vừa chọn." : "Chọn 6 số mới cho Két sắt.")}
        <CodePad label="Mã Két sắt mới" value={code} onChange={setCode} onComplete={handleReset} isDisabled={isBusy} shakeKey={shake} />
        {isBusy ? <Loader2 className="mt-4 h-5 w-5 animate-spin text-muted-foreground" aria-label="Đang lưu" /> : null}
      </Shell>
    );
  }

  return (
    <Shell icon={<Lock className="h-6 w-6" strokeWidth={1.6} />} title="Két sắt đang khoá">
      {line("Nhập mã Két sắt 6 số")}
      <CodePad
        label="Mã Két sắt"
        value={code}
        onChange={setCode}
        onComplete={(value) => void handleUnlock(value)}
        isDisabled={isBusy || isWaiting}
        shakeKey={shake}
      />
      <button
        type="button"
        onClick={() => go({ kind: "forgot" })}
        className="press mt-6 min-h-11 px-3 text-[14px] font-medium text-primary hover:underline"
      >
        Quên mã 6 số?
      </button>
    </Shell>
  );
}
