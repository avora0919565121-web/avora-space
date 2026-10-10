import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, KeyRound, Loader2, ScrollText, TriangleAlert } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { CodePad } from "@/components/vault/CodePad";
import { KitCheck, KitWords, PassphraseFields } from "@/components/vault/VaultSetup";
import { useAuth } from "@/lib/auth";
import { vaultE2eeKeys } from "@/lib/use-vault-e2ee";
import { useVaultLock } from "@/lib/use-vault-lock";
import { requestVaultReset } from "@/lib/vault-api";
import { entropyToWords, newRecoveryEntropy, passphraseStrength } from "@/lib/vault-crypto";
import { changePassphrase, fetchKeyring, provePassphrase, resetCodeByPassphrase, resetEverything, rotateRecovery } from "@/lib/vault-keys";
import { cn } from "@/lib/utils";

const primary = "press flex h-12 w-full items-center justify-center gap-2 rounded-control bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-50";

function Panel({ title, onBack, children }: { title: string; onBack?: () => void; children: ReactNode }) {
  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto px-5 pb-12 pt-6 md:pt-10">
      <div className="animate-rise-in mx-auto w-full max-w-[420px]">
        {onBack !== undefined ? (
          <button type="button" onClick={onBack} className="press -ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-[13.5px] text-muted-foreground">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Quay lại
          </button>
        ) : null}
        <h2 className="mt-3 text-[24px] font-semibold tracking-tight">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** 4.3 · after opening with the 24 words: a new passphrase, then a new kit; the old kit stops working. */
export function RecoveredResetInner({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"pass" | "kit" | "check" | "saving">("pass");
  const [pass, setPass] = useState<string>("");
  const [again, setAgain] = useState<string>("");
  const [entropy] = useState<Uint8Array>(() => newRecoveryEntropy());
  const words = useMemo(() => entropyToWords(entropy), [entropy]);
  const finish = async (): Promise<void> => {
    if (user === null) return;
    setStep("saving");
    try {
      await changePassphrase(user.id, pass);
      await rotateRecovery(user.id, entropy);
      entropy.fill(0);
      await queryClient.invalidateQueries({ queryKey: vaultE2eeKeys.keyring(user.id) });
      toast.success("Đã đặt Mật khẩu Két sắt mới. Bộ khôi phục cũ đã hết hiệu lực.");
      onDone();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : "Chưa làm được.");
      setStep("check");
    }
  };
  if (step === "pass") {
    return (
      <Panel title="Đặt Mật khẩu Két sắt mới">
        <p className="mt-2 text-[14.5px] text-muted-foreground">Bạn vừa mở bằng Bộ khôi phục. Đặt mật khẩu mới, rồi cất Bộ khôi phục mới — bộ cũ sẽ hết hiệu lực.</p>
        <PassphraseFields value={pass} onChange={setPass} again={again} onAgain={setAgain} />
        <button type="button" disabled={!passphraseStrength(pass).ok || pass.trim() !== again.trim()} onClick={() => setStep("kit")} className={cn(primary, "mt-6")}>Tiếp</button>
      </Panel>
    );
  }
  if (step === "kit") {
    return (
      <Panel title="Bộ khôi phục mới" onBack={() => setStep("pass")}>
        <KitWords words={words} />
        <button type="button" onClick={() => setStep("check")} className={cn(primary, "mt-6")}>Tôi đã cất</button>
      </Panel>
    );
  }
  return (
    <Panel title="Kiểm tra Bộ khôi phục mới" onBack={step === "saving" ? undefined : () => setStep("kit")}>
      {step === "saving" ? <Loader2 className="mt-8 h-5 w-5 animate-spin text-muted-foreground" /> : <KitCheck words={words} onPassed={() => void finish()} />}
    </Panel>
  );
}

type Step = { kind: "menu" } | { kind: "code-pass" } | { kind: "code-new"; first: string | null } | { kind: "pass-info" } | { kind: "wipe" };

/**
 * 4.3 · `Quên mã?` on an account with an encrypted Két sắt. Email no longer opens anything: the 6-digit
 * code is reset with the passphrase; the passphrase with the 24 words; both lost → wipe and start over.
 */
export function VaultForgotEncrypted({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const vault = useVaultLock();
  const [step, setStep] = useState<Step>({ kind: "menu" });
  const [pass, setPass] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<string>("");
  const [emailCode, setEmailCode] = useState<string>("");
  const [typed, setTyped] = useState<string>("");
  const [sent, setSent] = useState<boolean>(false);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setIsWorking(true);
    setError(null);
    try {
      await work();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Chưa làm được.");
    } finally {
      setIsWorking(false);
    }
  };

  if (step.kind === "code-pass") {
    return (
      <Panel title="Quên mã 6 số" onBack={() => setStep({ kind: "menu" })}>
        <p className="mt-2 text-[14.5px] text-muted-foreground">Nhập Mật khẩu Két sắt để đặt mã 6 số mới.</p>
        <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { const ring = await fetchKeyring(); if (ring === null) throw new Error("Két sắt chưa mã hoá."); await provePassphrase(ring, pass); setPass(""); setStep({ kind: "code-new", first: null }); }); }}>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} aria-label="Mật khẩu Két sắt" placeholder="Mật khẩu Két sắt" className="h-12 w-full rounded-control border border-input bg-card px-3 font-mono text-[16px] outline-none focus:border-personal" />
          {error !== null ? <p className="text-[13.5px] text-destructive" role="alert">{error}</p> : null}
          <button type="submit" disabled={isWorking || pass === ""} className={primary}>{isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{isWorking ? "Đang kiểm tra trên máy…" : "Tiếp"}</button>
        </form>
      </Panel>
    );
  }
  if (step.kind === "code-new") {
    return (
      <Panel title={step.first === null ? "Đặt mã 6 số mới" : "Nhập lại mã mới"} onBack={() => setStep({ kind: "menu" })}>
        <CodePad
          label="Mã Két sắt mới"
          value={code}
          onChange={setCode}
          isDisabled={isWorking}
          shakeKey={error === null ? 0 : 1}
          onComplete={(value) => {
            setCode("");
            if (step.first === null) setStep({ kind: "code-new", first: value });
            else if (step.first !== value) { setError("Hai lần chưa khớp."); setStep({ kind: "code-new", first: null }); }
            else void run(async () => { await resetCodeByPassphrase(value); await vault.refresh(); toast.success("Đã đặt mã Két sắt mới."); });
          }}
        />
        {error !== null ? <p className="mt-2 text-center text-[13.5px] text-destructive" role="alert">{error}</p> : null}
      </Panel>
    );
  }
  if (step.kind === "pass-info") {
    return (
      <Panel title="Quên Mật khẩu Két sắt" onBack={() => setStep({ kind: "menu" })}>
        <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">Mở Két sắt bằng mã 6 số, vào Chứng chỉ / Tài liệu / Tài sản và chọn <strong className="text-foreground">Dùng Bộ khôi phục</strong>. Gõ 24 từ, đặt Mật khẩu Két sắt mới và cất Bộ khôi phục mới.</p>
        <button type="button" onClick={onBack} className={cn(primary, "mt-6")}>Đã hiểu</button>
      </Panel>
    );
  }
  if (step.kind === "wipe") {
    return (
      <Panel title="Xoá Két sắt và bắt đầu lại" onBack={() => setStep({ kind: "menu" })}>
        <p className="mt-3 flex gap-2 rounded-card border border-destructive/40 bg-destructive/5 px-4 py-3 text-[14px] font-medium leading-relaxed text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Giấy tờ đã cất trong Chứng chỉ, Tài liệu, Tài sản sẽ mất hẳn. AVORA không giữ chìa nên không ai mở lại được. Tài chính không bị ảnh hưởng.
        </p>
        <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); if (user === null) return; void run(async () => { await resetEverything(user.id, password, emailCode); toast.success("Đã xoá phần mã hoá. Bạn có thể bắt đầu lại."); onBack(); }); }}>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Mật khẩu tài khoản" placeholder="Mật khẩu tài khoản" className="h-12 w-full rounded-control border border-input bg-card px-3 text-[16px] outline-none focus:border-personal" />
          <div className="flex gap-2">
            <input inputMode="numeric" maxLength={6} value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))} aria-label="Mã email" placeholder="Mã 6 số từ email" className="h-12 min-w-0 flex-1 rounded-control border border-input bg-card px-3 font-mono text-[16px] outline-none focus:border-personal" />
            <button type="button" onClick={() => void run(async () => { await requestVaultReset(); setSent(true); })} className="press h-12 shrink-0 rounded-control border border-border px-3 text-[13.5px] font-medium">{sent ? "Gửi lại" : "Gửi mã"}</button>
          </div>
          <label className="block text-[13.5px]">Gõ <strong>XOÁ</strong> để xác nhận
            <input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 h-12 w-full rounded-control border border-input bg-card px-3 text-[16px] outline-none focus:border-personal" />
          </label>
          {error !== null ? <p className="text-[13.5px] text-destructive" role="alert">{error}</p> : null}
          <button type="submit" disabled={isWorking || password === "" || emailCode.length !== 6 || typed.trim().toUpperCase() !== "XOÁ"} className="press flex h-12 w-full items-center justify-center gap-2 rounded-control bg-destructive text-[15px] font-semibold text-destructive-foreground disabled:opacity-50">
            {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Xoá Két sắt và bắt đầu lại
          </button>
        </form>
      </Panel>
    );
  }
  const option = (icon: ReactNode, title: string, body: string, onClick: () => void, danger = false): ReactNode => (
    <button type="button" onClick={onClick} className={cn("press flex w-full items-start gap-3 rounded-card border bg-card px-4 py-3.5 text-left", danger ? "border-destructive/40" : "border-border")}>
      <span className={cn("mt-0.5", danger ? "text-destructive" : "text-primary")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[15px] font-semibold", danger && "text-destructive")}>{title}</span>
        <span className="block text-[13px] text-muted-foreground">{body}</span>
      </span>
    </button>
  );
  return (
    <Panel title="Quên mã?" onBack={onBack}>
      <p className="mt-2 text-[14px] text-muted-foreground">Két sắt của bạn đã mã hoá, nên email không mở được nữa.</p>
      <div className="mt-5 space-y-2" data-forgot-menu="">
        {option(<KeyRound className="h-5 w-5" />, "Quên mã 6 số", "Dùng Mật khẩu Két sắt để đặt mã mới.", () => setStep({ kind: "code-pass" }))}
        {option(<ScrollText className="h-5 w-5" />, "Quên Mật khẩu Két sắt", "Dùng Bộ khôi phục 24 từ, rồi đặt mật khẩu và bộ mới.", () => setStep({ kind: "pass-info" }))}
        {option(<TriangleAlert className="h-5 w-5" />, "Quên cả hai", "Xoá Két sắt và bắt đầu lại — giấy tờ đã cất sẽ mất hẳn.", () => setStep({ kind: "wipe" }), true)}
      </div>
    </Panel>
  );
}
