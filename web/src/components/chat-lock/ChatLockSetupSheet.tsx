import { BellOff, Fingerprint, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import {
  CODE_MAX,
  CODE_MIN,
  deviceUnlockAvailable,
  hintShown,
  isValidCode,
  LOCK_TRUTH,
  markHintShown,
  registerDevice,
  type ChatLockMethod,
} from "@/lib/chat-lock";
import { useChatLock } from "@/lib/use-chat-lock";
import { useProfileSettings, useSettingsActions } from "@/lib/use-settings";
import { cn } from "@/lib/utils";

type Step = "method" | "code" | "hint";

/**
 * AVORA-109 · A1/A2/A4 — the two-step setup: choose how to open (device lock first when the device
 * has one, else a 4–6 digit code), then lock at once. `lockAfter=false` is used from Settings to
 * change the method without covering the screen.
 */
export function ChatLockSetupSheet({ open, onOpenChange, lockAfter = true }: { open: boolean; onOpenChange: (open: boolean) => void; lockAfter?: boolean }) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { setUp, lock } = useChatLock();
  const settings = useProfileSettings();
  const { setPushPrefs } = useSettingsActions();
  const [step, setStep] = useState<Step>("method");
  const [hasDevice, setHasDevice] = useState<boolean>(false);
  const [code, setCode] = useState<string>("");
  const [again, setAgain] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setStep("method");
    setCode("");
    setAgain("");
    setError("");
    void deviceUnlockAvailable().then(setHasDevice);
  }, [open]);

  const finish = (): void => {
    onOpenChange(false);
    if (lockAfter) lock();
    else toast.success("Đã đổi cách mở Khoá Kết nối.");
  };

  const afterSetUp = (): void => {
    // A4: suggest hiding notification text once, never push it.
    if (settings.data?.pushShowContent === true && !hintShown(userId)) {
      markHintShown(userId);
      setStep("hint");
      return;
    }
    finish();
  };

  const choose = async (method: ChatLockMethod): Promise<void> => {
    setError("");
    if (method === "code") {
      setStep("code");
      return;
    }
    setBusy(true);
    try {
      const credentialId = await registerDevice(userId);
      await setUp({ method: "device", credentialId }, false);
      afterSetUp();
    } catch {
      setError("Máy chưa bật được cách mở này. Thử lại, hoặc dùng mã số.");
    } finally {
      setBusy(false);
    }
  };

  const saveCode = async (): Promise<void> => {
    if (!isValidCode(code)) {
      setError(`Mã gồm ${CODE_MIN}–${CODE_MAX} chữ số.`);
      return;
    }
    if (code !== again) {
      setError("Hai lần nhập chưa giống nhau.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await setUp({ method: "code", code }, false);
      afterSetUp();
    } catch {
      setError("Không lưu được mã trên máy này. Thử lại nhé.");
    } finally {
      setBusy(false);
    }
  };

  const option = (method: ChatLockMethod, title: string, sub: string, Icon: typeof KeyRound, recommended: boolean) => (
    <button
      type="button"
      onClick={() => void choose(method)}
      disabled={busy}
      data-chat-lock-method={method}
      className={cn(
        "press flex min-h-16 w-full items-center gap-3 rounded-card border bg-card px-4 py-3 text-left transition-colors hover:bg-accent/40 disabled:opacity-60",
        recommended ? "border-[hsl(var(--personal)/0.45)]" : "border-border",
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--soft))] text-[hsl(var(--soft-fg))]">
        <Icon className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground">{sub}</span>
      </span>
    </button>
  );

  const codeInput = (value: string, set: (v: string) => void, label: string, attr: string) => (
    <label className="block">
      <span className="text-[14px] text-muted-foreground">{label}</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]*"
        maxLength={CODE_MAX}
        value={value}
        onChange={(event) => set(event.target.value.replace(/\D/g, "").slice(0, CODE_MAX))}
        className="mt-1 h-12 w-full rounded-control border border-input bg-background px-4 text-center text-[20px] tracking-[0.4em] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        {...{ [attr]: "" }}
      />
    </label>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] scroll-y p-0 md:mx-auto md:max-w-md md:rounded-t-card" data-chat-lock-setup="">
        <SheetHeader className="px-4 pt-4 text-left">
          <SheetTitle className="text-[18px]">{step === "hint" ? "Thông báo trên màn hình khoá" : "Khoá Kết nối"}</SheetTitle>
          <SheetDescription className="text-[14px] leading-6">
            {step === "hint"
              ? "Thông báo đang hiện nội dung tin. Tắt đi để giữ riêng tư hơn?"
              : step === "method"
                ? "Bước 1/2 · Chọn cách mở. Khi khoá, Kết nối chỉ hiện tên app và nút Mở."
                : "Bước 2/2 · Đặt mã chỉ dùng trên máy này."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-s-2 px-4 pb-6 pt-s-4">
          {step === "method" ? (
            <>
              {hasDevice ? option("device", "Khoá màn hình của máy", "Mở bằng vân tay, khuôn mặt hoặc mã máy.", Fingerprint, true) : null}
              {option("code", "Mã 4–6 số", "Riêng cho máy này, không dùng chung Mã Két sắt.", KeyRound, !hasDevice)}
              {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-label="Đang bật" /> : null}
            </>
          ) : null}
          {step === "code" ? (
            <>
              {codeInput(code, setCode, `Mã ${CODE_MIN}–${CODE_MAX} số`, "data-chat-lock-new-code")}
              {codeInput(again, setAgain, "Nhập lại", "data-chat-lock-new-code-again")}
              <button
                type="button"
                onClick={() => void saveCode()}
                disabled={busy}
                className="press mt-s-2 flex h-12 items-center justify-center gap-2 rounded-control bg-primary text-[16px] font-semibold text-primary-foreground disabled:opacity-60"
                data-chat-lock-save=""
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {lockAfter ? "Xong, khoá luôn" : "Lưu mã"}
              </button>
            </>
          ) : null}
          {step === "hint" ? (
            <div className="flex flex-col gap-s-2">
              <button
                type="button"
                onClick={() => {
                  setPushPrefs.mutate({ pushShowContent: false }, { onError: (err: Error) => toast.error(err.message) });
                  finish();
                }}
                className="press flex h-12 items-center justify-center gap-2 rounded-control bg-primary text-[16px] font-semibold text-primary-foreground"
                data-chat-lock-hint-off=""
              >
                <BellOff className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                Tắt hiện nội dung
              </button>
              <button type="button" onClick={finish} className="min-h-11 text-[15px] text-muted-foreground" data-chat-lock-hint-keep="">
                Để nguyên
              </button>
            </div>
          ) : null}
          {error !== "" ? <p role="alert" className="text-[14px] text-destructive">{error}</p> : null}
          {step !== "hint" ? (
            <div className="mt-s-2 space-y-1 rounded-card bg-muted/50 px-3 py-2.5 text-[13px] leading-5 text-muted-foreground" data-chat-lock-truth="">
              <p>{LOCK_TRUTH}</p>
              <p>Quên mã hoặc máy không còn mở được: đăng xuất rồi đăng nhập lại là đặt lại khoá. Không mất tin nào.</p>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
