import { useCallback, useState } from "react";
import { toast } from "sonner";

import { CodePad } from "@/components/vault/CodePad";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useVaultLock } from "@/lib/use-vault-lock";
import { vaultErrorMessage, waitLine, wrongCodeLine } from "@/lib/vault-lock";

type Phase = { kind: "old" } | { kind: "new"; old: string } | { kind: "again"; old: string; next: string };

const TITLES: Record<Phase["kind"], string> = {
  old: "Nhập mã Két sắt hiện tại",
  new: "Chọn mã mới",
  again: "Nhập lại mã mới",
};

/** Két sắt › ⋯ › Đổi mã Két sắt: the old code, then the new one twice. */
export function ChangeCodeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const vault = useVaultLock();
  const [phase, setPhase] = useState<Phase>({ kind: "old" });
  const [code, setCode] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [shake, setShake] = useState<number>(0);
  const [isBusy, setIsBusy] = useState<boolean>(false);

  const reset = useCallback((): void => {
    setPhase({ kind: "old" });
    setCode("");
    setMessage(null);
  }, []);

  const wrong = useCallback((text: string): void => {
    setShake((n) => n + 1);
    setCode("");
    setMessage(text);
  }, []);

  const complete = useCallback(
    (value: string): void => {
      if (phase.kind === "old") {
        setPhase({ kind: "new", old: value });
        setCode("");
        setMessage(null);
        return;
      }
      if (phase.kind === "new") {
        setPhase({ kind: "again", old: phase.old, next: value });
        setCode("");
        setMessage(null);
        return;
      }
      if (phase.next !== value) {
        setPhase({ kind: "new", old: phase.old });
        wrong("Hai lần nhập chưa khớp. Chọn lại mã mới nhé.");
        return;
      }
      setIsBusy(true);
      void vault
        .changeCode(phase.old, value)
        .then((attempt) => {
          if (attempt.ok === true) {
            toast.success("Đã đổi mã Két sắt. Email báo đã gửi tới hộp thư của bạn.");
            onOpenChange(false);
            reset();
            return;
          }
          setPhase({ kind: "old" });
          if ("lockedUntil" in attempt) wrong(waitLine(attempt.lockedUntil, Date.now()));
          else if ("remaining" in attempt) wrong(wrongCodeLine(attempt.remaining));
        })
        .catch((error: unknown) => wrong(error instanceof Error ? vaultErrorMessage(error.message) : "Chưa đổi được mã."))
        .finally(() => setIsBusy(false));
    },
    [onOpenChange, phase, reset, vault, wrong],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-w-[400px] pb-8">
        <DialogTitle className="text-center text-[20px] font-semibold tracking-tight">{TITLES[phase.kind]}</DialogTitle>
        <DialogDescription className="min-h-[40px] text-center text-[14px] text-muted-foreground" role={message !== null ? "alert" : undefined}>
          {message ?? (phase.kind === "old" ? "Đổi mã sẽ khoá Két sắt trên các máy khác." : "Đúng 6 chữ số.")}
        </DialogDescription>
        {open ? (
          <CodePad label={TITLES[phase.kind]} value={code} onChange={setCode} onComplete={complete} isDisabled={isBusy} shakeKey={shake} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
