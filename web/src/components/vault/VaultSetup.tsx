import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Copy, Eye, EyeOff, FileDown, KeyRound, Loader2, Printer, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { KIT_WARNING, printKit, saveKitPdf } from "@/lib/recovery-kit-pdf";
import { vaultE2eeKeys } from "@/lib/use-vault-e2ee";
import { useVaultLock } from "@/lib/use-vault-lock";
import { entropyToWords, isKitWord, newRecoveryEntropy, passphraseStrength, pickCheckPositions, wordsToEntropy } from "@/lib/vault-crypto";
import { logError } from "@/lib/log";
import { VaultUserError, openWithPassphrase, openWithRecovery, setupVault, type Keyring } from "@/lib/vault-keys";
import { suggestPassphrase } from "@/lib/vault-templates";
import { cn } from "@/lib/utils";

export const E2EE_ABOUT = {
  tech: [
    "Mỗi giấy tờ được mã hoá AES-256-GCM ngay trên máy bạn trước khi gửi đi.",
    "Khoá chính chỉ mở được bằng Mật khẩu Két sắt (Argon2id) hoặc Bộ khôi phục 24 từ. Máy chủ AVORA chỉ giữ dữ liệu đã mã hoá và các bản khoá đã bọc.",
    "Máy quen mở nhanh bằng mã 6 số: máy giữ một nửa chìa, máy chủ chỉ trả nửa còn lại khi đúng mã.",
  ],
  you: [
    "Chỉ bạn đọc được Chứng chỉ, Tài liệu, Tài sản. AVORA không đọc được, kể cả khi được yêu cầu.",
    "Quên cả Mật khẩu Két sắt lẫn Bộ khôi phục thì phần đã mã hoá mất hẳn — AVORA không giữ chìa.",
    "Máy chủ vẫn biết số mục, kích thước tệp và ngày cần nhắc; không biết tên, số hiệu, ảnh hay chữ.",
    "Đây vẫn là một ứng dụng web: nó dựa vào việc mã AVORA tải về là mã đúng.",
  ],
} as const;

const primary = "press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-50";
const quiet = "press flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-[14px] font-medium";

function Frame({ step, total, title, onBack, children }: { step?: number; total?: number; title: string; onBack?: () => void; children: ReactNode }) {
  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto px-5 pb-12 pt-6 md:pt-10">
      <div className="animate-rise-in mx-auto w-full max-w-[440px]">
        <div className="flex min-h-11 items-center gap-2">
          {onBack !== undefined ? (
            <button type="button" onClick={onBack} className="press -ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-[13.5px] text-muted-foreground">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Quay lại
            </button>
          ) : null}
          {step !== undefined && total !== undefined ? (
            <div className="ml-auto flex items-center gap-1.5" aria-label={`Bước ${step} trên ${total}`}>
              {Array.from({ length: total }, (_, i) => (
                <span key={i} className={cn("h-1.5 rounded-full transition-all", i < step ? "w-6 bg-primary" : "w-3 bg-border")} />
              ))}
            </div>
          ) : null}
        </div>
        <h2 className="mt-3 text-[25px] font-semibold leading-tight tracking-tight text-foreground">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function E2eeAboutText({ className }: { className?: string }) {
  const [layer, setLayer] = useState<"you" | "tech">("you");
  return (
    <div className={className}>
      <div role="tablist" className="inline-flex rounded-full border border-border bg-card p-1">
        {(["you", "tech"] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={layer === id} onClick={() => setLayer(id)} className={cn("press h-9 rounded-full px-4 text-[13px] font-medium", layer === id ? "bg-foreground text-background" : "text-muted-foreground")}>
            {id === "you" ? "Với bạn" : "Kỹ thuật"}
          </button>
        ))}
      </div>
      <ul className="mt-4 space-y-3">
        {E2EE_ABOUT[layer].map((line) => (
          <li key={line} className="flex gap-2.5 text-[14.5px] leading-relaxed text-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A secret field: hidden by default (people nearby, Android keyboards that learn `text`
 * fields), `autoComplete="off"` so no browser or iCloud offers to keep it.
 */
export function SecretInput({ value, onChange, isShown, onToggle, label, ...rest }: { value: string; onChange: (v: string) => void; isShown: boolean; onToggle: () => void; label: string; "data-passphrase"?: string; "data-passphrase-again"?: string; "data-open-passphrase"?: string }) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium">{label}</span>
      <span className="relative mt-1 block">
        <input
          type={isShown ? "text" : "password"}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-full rounded-xl border border-input bg-card pl-3 pr-12 font-mono text-[16px] outline-none focus:border-personal"
          {...rest}
        />
        <button type="button" onClick={onToggle} aria-label={isShown ? `Ẩn ${label.toLowerCase()}` : `Hiện ${label.toLowerCase()}`} aria-pressed={isShown} className="press absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground" data-secret-toggle="">
          {isShown ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
        </button>
      </span>
    </label>
  );
}

/**
 * 4.1 · step 2 — the passphrase, typed twice, with the meter and the suggestion.
 * Hidden by default; a suggestion is shown once so it can be copied down, and hides again
 * as soon as this step is left (the component unmounts on `Tiếp`).
 */
export function PassphraseFields({ value, onChange, again, onAgain }: { value: string; onChange: (v: string) => void; again: string; onAgain: (v: string) => void }) {
  const strength = passphraseStrength(value);
  const [isShown, setIsShown] = useState<boolean>(false);
  const [isAgainShown, setIsAgainShown] = useState<boolean>(false);
  const colors = ["bg-border", "bg-destructive", "bg-[hsl(32_90%_55%)]", "bg-[hsl(90_45%_45%)]", "bg-[hsl(150_45%_38%)]"];
  return (
    <div className="mt-5 space-y-3">
      <SecretInput label="Mật khẩu Két sắt" value={value} onChange={onChange} isShown={isShown} onToggle={() => setIsShown((s) => !s)} data-passphrase="" />
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => <span key={n} className={cn("h-1.5 flex-1 rounded-full transition-colors", strength.score >= n ? colors[strength.score] : "bg-border")} />)}
      </div>
      <p className="text-[12.5px] text-muted-foreground">Ít nhất 12 ký tự hoặc 4 từ. Đừng dùng lại mật khẩu đăng nhập AVORA.</p>
      <button type="button" onClick={() => { onChange(suggestPassphrase()); onAgain(""); setIsShown(true); }} className="press inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-[13.5px] font-medium text-primary">
        <Sparkles className="h-4 w-4" aria-hidden="true" /> Gợi ý một cụm dễ nhớ
      </button>
      <SecretInput label="Nhập lại" value={again} onChange={onAgain} isShown={isAgainShown} onToggle={() => setIsAgainShown((s) => !s)} data-passphrase-again="" />
      {again !== "" && again.trim() !== value.trim() ? <p className="text-[13px] text-destructive">Hai lần chưa khớp.</p> : null}
    </div>
  );
}

/** 4.1 · step 3 — the 24 words, saved as an on-device PDF (S9) or copied. */
export function KitWords({ words }: { words: readonly string[] }) {
  const [isSaving, setIsSaving] = useState<boolean>(false);
  return (
    <>
      <p className="mt-3 rounded-xl border border-[hsl(32_70%_70%)] bg-[hsl(38_90%_95%)] px-4 py-3 text-[14px] font-medium leading-relaxed text-[hsl(28_60%_25%)] dark:bg-[hsl(32_30%_16%)] dark:text-[hsl(38_80%_82%)]" data-kit-warning="">
        {KIT_WARNING}
      </p>
      <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-3" data-kit-words="">
        {words.map((word, i) => (
          <li key={i} className="flex items-baseline gap-2 font-mono text-[15px]">
            <span className="w-6 text-right text-[12px] tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="text-foreground">{word}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={isSaving} onClick={() => { setIsSaving(true); void saveKitPdf(words).catch(() => toast.error("Chưa tạo được PDF.")).finally(() => setIsSaving(false)); }} className={quiet}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" aria-hidden="true" />} Lưu PDF
        </button>
        <button type="button" onClick={() => printKit(words)} className={quiet}><Printer className="h-4 w-4" aria-hidden="true" /> In</button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(words.join(" ")).then(() => {
              toast.success("Đã chép. AVORA xoá bộ nhớ tạm sau 60 giây nếu vẫn đang mở.");
              window.setTimeout(() => void navigator.clipboard.writeText("").catch(() => undefined), 60_000);
            });
          }}
          className={quiet}
        >
          <Copy className="h-4 w-4" aria-hidden="true" /> Chép
        </button>
      </div>
    </>
  );
}

/** Asks back three random words; no skip button. */
export function KitCheck({ words, onPassed }: { words: readonly string[]; onPassed: () => void }) {
  const positions = useMemo(() => pickCheckPositions(), []);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const [error, setError] = useState<boolean>(false);
  return (
    <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); const ok = positions.every((p, i) => answers[i].trim().toLowerCase() === words[p]); setError(!ok); if (ok) onPassed(); }}>
      {positions.map((p, i) => (
        <label key={p} className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-[14px] text-muted-foreground">Từ số {p + 1}</span>
          <input autoCapitalize="none" autoComplete="off" spellCheck={false} value={answers[i]} onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))} className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 font-mono text-[16px] outline-none focus:border-personal" data-kit-check={p} />
        </label>
      ))}
      {error ? <p className="text-[13.5px] text-destructive" role="alert">Chưa đúng. Xem lại tờ đã cất nhé.</p> : null}
      <button type="submit" disabled={answers.some((a) => a.trim() === "")} className={primary}>Kiểm tra</button>
    </form>
  );
}

type Step = "intro" | "pass" | "kit" | "check" | "saving";

/** AVORA-102 · A0.3 — the keyring was written but this device could not be tied. */
export const SETUP_UNBOUND_LINE = "Két sắt đã mã hoá. Máy này chưa gắn — lần sau mở bằng Mật khẩu Két sắt.";

/** AVORA-102 · A0.4 — any failure that is not "wrong passphrase / wrong kit" reads the same. */
export const OPEN_HERE_FAILED = "Chưa mở được trên máy này. Thử lại, hoặc dùng Bộ khôi phục.";

/** 4.1 — first time in Chứng chỉ / Tài liệu / Tài sản. No keyring exists until the kit is confirmed. */
export function VaultSetupFlow() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("intro");
  const [pass, setPass] = useState<string>("");
  const [again, setAgain] = useState<string>("");
  const [entropy] = useState<Uint8Array>(() => newRecoveryEntropy());
  const words = useMemo(() => entropyToWords(entropy), [entropy]);
  const canPass = passphraseStrength(pass).ok && pass.trim() === again.trim();

  useEffect(
    () => () => {
      entropy.fill(0);
    },
    [entropy],
  );

  const finish = async (): Promise<void> => {
    if (user === null) return;
    setStep("saving");
    try {
      const result = await setupVault(user.id, pass, entropy);
      setPass("");
      setAgain("");
      await queryClient.invalidateQueries({ queryKey: vaultE2eeKeys.keyring(user.id) });
      // AVORA-102 · A0.3: the keyring exists — done, even when this device could not be tied.
      if (result.deviceBound) toast.success("Két sắt đã được mã hoá trên máy này.");
      else toast.success(SETUP_UNBOUND_LINE, { duration: 8000 });
    } catch (caught: unknown) {
      toast.error(caught instanceof VaultUserError ? caught.message : "Chưa làm được. Thử lại nhé.");
      setStep("check");
    }
  };

  if (step === "intro") {
    return (
      <Frame step={1} total={4} title="Két sắt mã hoá ngay trên máy bạn">
        <E2eeAboutText className="mt-5" />
        <button type="button" onClick={() => setStep("pass")} className={cn(primary, "mt-8")} data-setup-start="">Bắt đầu</button>
      </Frame>
    );
  }
  if (step === "pass") {
    return (
      <Frame step={2} total={4} title="Đặt Mật khẩu Két sắt" onBack={() => setStep("intro")}>
        <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">Mật khẩu này không bao giờ rời máy. Dùng nó khi mở Két sắt trên máy mới hoặc khi quên mã 6 số.</p>
        <PassphraseFields value={pass} onChange={setPass} again={again} onAgain={setAgain} />
        <button type="button" disabled={!canPass} onClick={() => setStep("kit")} className={cn(primary, "mt-6")}>Tiếp</button>
      </Frame>
    );
  }
  if (step === "kit") {
    return (
      <Frame step={3} total={4} title="Bộ khôi phục" onBack={() => setStep("pass")}>
        <KitWords words={words} />
        <button type="button" onClick={() => setStep("check")} className={cn(primary, "mt-6")}>Tôi đã cất</button>
      </Frame>
    );
  }
  return (
    <Frame step={4} total={4} title="Kiểm tra Bộ khôi phục" onBack={step === "saving" ? undefined : () => setStep("kit")}>
      <p className="mt-2 text-[14.5px] text-muted-foreground">Gõ lại ba từ theo đúng số thứ tự. Mã 6 số Két sắt giữ nguyên — máy này được gắn luôn.</p>
      {step === "saving" ? (
        <p className="mt-8 flex items-center gap-2 text-[14.5px] text-muted-foreground" role="status"><Loader2 className="h-5 w-5 animate-spin" /> Đang tạo khoá trên máy…</p>
      ) : (
        <KitCheck words={words} onPassed={() => void finish()} />
      )}
    </Frame>
  );
}

/** 4.2 — this device has no wrap yet (new device, cleared data): passphrase, or the 24 words. */
export function VaultOpenHere({ ring, onRecovered }: { ring: Keyring; onRecovered: () => void }) {
  const { user } = useAuth();
  const [mode, setMode] = useState<"pass" | "kit">("pass");
  const [pass, setPass] = useState<string>("");
  const [kit, setKit] = useState<string>("");
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [isShown, setIsShown] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (): Promise<void> => {
    if (user === null) return;
    setIsWorking(true);
    setError(null);
    try {
      if (mode === "pass") await openWithPassphrase(user.id, ring, pass);
      else {
        const entropy = wordsToEntropy(kit);
        if (entropy === null) throw new Error("Bộ khôi phục chưa đúng.");
        await openWithRecovery(user.id, ring, entropy);
        entropy.fill(0);
        onRecovered();
      }
      setPass("");
      setKit("");
    } catch (caught: unknown) {
      if (caught instanceof VaultUserError) {
        setError(caught.message);
      } else {
        // WebCrypto / Argon2 / IndexedDB said something in English: log its name, say one plain line.
        logError("vault-open-here", { mode, name: caught instanceof Error ? caught.name : "unknown", message: caught instanceof Error ? caught.message.slice(0, 60) : "" });
        setError(OPEN_HERE_FAILED);
      }
    } finally {
      setIsWorking(false);
    }
  };
  const badWords = kit.trim() === "" ? [] : kit.trim().toLowerCase().split(/\s+/).filter((w) => !isKitWord(w));
  return (
    <Frame title="Mở Két sắt trên máy này">
      <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
        Máy này chưa giữ chìa Két sắt. {mode === "pass" ? "Lần sau trên máy này chỉ cần mã 6 số." : "Gõ đủ 24 từ, cách nhau bằng dấu cách. Sau đó bạn đặt Mật khẩu Két sắt mới và Bộ khôi phục mới."}
      </p>
      {mode === "pass" ? (
        <p className="mt-3 text-[15px] font-medium text-foreground" data-open-here-ask="">Nhập Mật khẩu Két sắt (cụm dài bạn đặt khi mã hoá)</p>
      ) : null}
      <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        {mode === "pass" ? (
          <SecretInput label="Mật khẩu Két sắt" value={pass} onChange={setPass} isShown={isShown} onToggle={() => setIsShown((v) => !v)} data-open-passphrase="" />
        ) : (
          <textarea rows={4} autoCapitalize="none" spellCheck={false} value={kit} onChange={(e) => setKit(e.target.value)} aria-label="24 từ" className="w-full rounded-xl border border-input bg-card px-3 py-2 font-mono text-[16px] outline-none focus:border-personal" />
        )}
        {badWords.length > 0 ? <p className="text-[13px] text-destructive">Từ không có trong danh sách: {badWords.slice(0, 3).join(", ")}</p> : null}
        {error !== null ? <p className="text-[13.5px] text-destructive" role="alert">{error}</p> : null}
        <button type="submit" disabled={isWorking || (mode === "pass" ? pass === "" : kit.trim().split(/\s+/).length !== 24)} className={primary}>
          {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
          {isWorking ? "Đang mở khoá trên máy…" : "Mở"}
        </button>
      </form>
      <button type="button" onClick={() => { setMode(mode === "pass" ? "kit" : "pass"); setError(null); }} className="press mt-4 min-h-11 text-[14px] font-medium text-primary">
        {mode === "pass" ? "Dùng Bộ khôi phục" : "Dùng Mật khẩu Két sắt"}
      </button>
    </Frame>
  );
}
