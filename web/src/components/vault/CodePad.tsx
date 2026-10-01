import { Delete } from "lucide-react";
import { memo, useCallback, useEffect } from "react";

import { VAULT_CODE_LENGTH, cleanVaultCode } from "@/lib/vault-lock";
import { cn } from "@/lib/utils";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

/**
 * Six dots and a phone-sized keypad (keys ≥ 56px). On a computer the keyboard types into it too,
 * and a pasted code (from the email) fills it at once. `shakeKey` changing replays the small
 * shake of a wrong code.
 */
export const CodePad = memo(function CodePad({
  value,
  onChange,
  onComplete,
  isDisabled = false,
  shakeKey = 0,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete: (code: string) => void;
  isDisabled?: boolean;
  shakeKey?: number;
  label: string;
}) {
  const put = useCallback(
    (next: string): void => {
      const clean = cleanVaultCode(next);
      onChange(clean);
      if (clean.length === VAULT_CODE_LENGTH) onComplete(clean);
    },
    [onChange, onComplete],
  );

  const press = useCallback(
    (key: (typeof KEYS)[number]): void => {
      if (isDisabled || key === "") return;
      if (key === "del") {
        onChange(value.slice(0, -1));
        return;
      }
      if (value.length >= VAULT_CODE_LENGTH) return;
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(6);
      put(value + key);
    },
    [isDisabled, onChange, put, value],
  );

  useEffect(() => {
    if (isDisabled) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        if (value.length < VAULT_CODE_LENGTH) put(value + event.key);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        onChange(value.slice(0, -1));
      }
    };
    const onPaste = (event: ClipboardEvent): void => {
      const pasted = cleanVaultCode(event.clipboardData?.getData("text") ?? "");
      if (pasted.length === 0) return;
      event.preventDefault();
      put(pasted);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, [isDisabled, onChange, put, value]);

  return (
    <div className="flex flex-col items-center">
      <div
        key={shakeKey}
        role="img"
        aria-label={`${label}: đã nhập ${value.length} trên ${VAULT_CODE_LENGTH} số`}
        className={cn("flex items-center gap-3.5 py-2", shakeKey > 0 && "animate-code-shake")}
      >
        {Array.from({ length: VAULT_CODE_LENGTH }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-3.5 w-3.5 rounded-full border-[1.5px] transition-all duration-150",
              index < value.length ? "scale-110 border-foreground bg-foreground" : "border-foreground/35 bg-transparent",
            )}
          />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-x-5 gap-y-3.5" role="group" aria-label="Bàn phím số">
        {KEYS.map((key, index) =>
          key === "" ? (
            <span key={`blank-${index}`} aria-hidden="true" />
          ) : (
            <button
              key={key}
              type="button"
              disabled={isDisabled || (key === "del" && value.length === 0)}
              onClick={() => press(key)}
              aria-label={key === "del" ? "Xoá một số" : key}
              className={cn(
                "press flex h-[64px] w-[64px] items-center justify-center rounded-full text-[26px] font-medium tabular-nums transition-colors disabled:opacity-35 sm:h-[68px] sm:w-[68px]",
                key === "del"
                  ? "text-muted-foreground hover:text-foreground"
                  : "bg-secondary/70 text-foreground hover:bg-secondary active:bg-accent",
              )}
            >
              {key === "del" ? <Delete className="h-6 w-6" strokeWidth={1.6} /> : key}
            </button>
          ),
        )}
      </div>
    </div>
  );
});
