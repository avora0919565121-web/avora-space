import { Fingerprint, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { CODE_MAX, CODE_MIN, isValidCode, readAttempts, type CodeCheck } from "@/lib/chat-lock";
import { useAuth } from "@/lib/auth";
import { useChatLock } from "@/lib/use-chat-lock";

function waitText(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} giây`;
  return `${Math.ceil(seconds / 60)} phút`;
}

/**
 * The unlock step, shared by the lock screen and by "confirm it is you" before changing the lock.
 * `mode="unlock"` opens Kết nối; `mode="confirm"` only proves ownership (the screen stays as it is).
 */
export function ChatUnlockForm({ mode, onDone }: { mode: "unlock" | "confirm"; onDone: () => void }) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { config, unlockWithCode, unlockWithDevice, confirmOwner } = useChatLock();
  const [code, setCode] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [waitUntil, setWaitUntil] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    if (userId === "" || config?.method !== "code") return;
    void readAttempts(userId).then((attempts) => setWaitUntil(attempts.until));
  }, [config?.method, userId]);

  useEffect(() => {
    if (waitUntil <= now) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [now, waitUntil]);

  const waiting = waitUntil > now;

  const afterCheck = (result: CodeCheck): void => {
    if (!("waitUntil" in result)) {
      setCode("");
      onDone();
      return;
    }
    setCode("");
    setNow(Date.now());
    setWaitUntil(result.waitUntil);
    setError(result.waitUntil > Date.now() ? "" : "Mã chưa đúng.");
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!isValidCode(code) || waiting) return;
    setBusy(true);
    setError("");
    try {
      afterCheck(mode === "unlock" ? await unlockWithCode(code) : await confirmOwner(code));
    } catch {
      setError("Không kiểm được mã trên máy này. Thử lại nhé.");
    } finally {
      setBusy(false);
    }
  };

  const unlockByDevice = async (): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      const ok = mode === "unlock" ? await unlockWithDevice() : (await confirmOwner(null)).ok;
      if (ok) onDone();
      else setError("Chưa mở được. Thử lại nhé.");
    } catch {
      setError("Chưa mở được. Thử lại nhé.");
    } finally {
      setBusy(false);
    }
  };

  if (config?.method === "device") {
    return (
      <div className="flex w-full flex-col items-center gap-s-2">
        <button
          type="button"
          onClick={() => void unlockByDevice()}
          disabled={busy}
          data-chat-unlock-device=""
          className="press flex h-12 w-full max-w-xs items-center justify-center gap-2 rounded-control bg-primary px-5 text-[16px] font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Fingerprint className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />}
          Mở
        </button>
        {error !== "" ? <p role="alert" className="text-[14px] text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex w-full max-w-xs flex-col items-stretch gap-s-2" data-chat-unlock-code="">
      <label className="sr-only" htmlFor="chat-lock-code">Mã mở Kết nối</label>
      <input
        id="chat-lock-code"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]*"
        maxLength={CODE_MAX}
        value={code}
        disabled={waiting || busy}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, CODE_MAX))}
        placeholder={`Mã ${CODE_MIN}–${CODE_MAX} số`}
        className="h-12 rounded-control border border-input bg-background px-4 text-center text-[20px] tracking-[0.4em] text-foreground placeholder:text-[16px] placeholder:tracking-normal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        data-chat-lock-code-input=""
      />
      <button
        type="submit"
        disabled={!isValidCode(code) || waiting || busy}
        className="press flex h-12 items-center justify-center gap-2 rounded-control bg-primary px-5 text-[16px] font-semibold text-primary-foreground disabled:opacity-50"
        data-chat-unlock-submit=""
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Mở
      </button>
      {waiting ? (
        <p role="status" className="text-center text-[14px] text-muted-foreground" data-chat-lock-wait="">
          Sai nhiều lần. Thử lại sau {waitText(waitUntil - now)}.
        </p>
      ) : error !== "" ? (
        <p role="alert" className="text-center text-[14px] text-destructive">{error}</p>
      ) : null}
    </form>
  );
}
