import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type ConfirmRequest = {
  kind: "confirm";
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
};

type TextRequest = {
  kind: "text";
  title: string;
  body?: string;
  initial: string;
  confirmLabel: string;
  cancelLabel: string;
  maxLength: number;
  placeholder?: string;
  resolve: (value: string | null) => void;
};

type Request = ConfirmRequest | TextRequest;

let current: Request | null = null;
const listeners = new Set<() => void>();

function publish(next: Request | null): void {
  current = next;
  for (const listener of listeners) listener();
}

/** A new question answers the one still open with "no". */
function dismissCurrent(): void {
  if (current === null) return;
  if (current.kind === "confirm") current.resolve(false);
  else current.resolve(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The app's own yes/no question (AVORA-49 · 2.8), in place of the browser's `confirm()`.
 * Resolves false when dismissed. Only one question at a time; a second one answers the first "no".
 */
export function askConfirm(input: {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  dismissCurrent();
  return new Promise<boolean>((resolve) => {
    publish({
      kind: "confirm",
      title: input.title,
      body: input.body,
      confirmLabel: input.confirmLabel ?? "Đồng ý",
      cancelLabel: input.cancelLabel ?? "Huỷ",
      danger: input.danger ?? false,
      resolve,
    });
  });
}

/** A short name typed in the app's own box (folder names), in place of `prompt()`. Null = cancelled. */
export function askText(input: { title: string; body?: string; initial?: string; confirmLabel?: string; cancelLabel?: string; maxLength?: number; placeholder?: string }): Promise<string | null> {
  dismissCurrent();
  return new Promise<string | null>((resolve) => {
    publish({
      kind: "text",
      title: input.title,
      body: input.body,
      initial: input.initial ?? "",
      confirmLabel: input.confirmLabel ?? "Lưu",
      cancelLabel: input.cancelLabel ?? "Huỷ",
      maxLength: input.maxLength ?? 80,
      placeholder: input.placeholder,
      resolve,
    });
  });
}

/** Mounted once for every signed-in screen. */
export function ConfirmHost() {
  const request = useSyncExternalStore(subscribe, () => current, () => null);
  const [text, setText] = useState<string>("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (request?.kind === "text") {
      setText(request.initial);
      window.setTimeout(() => inputRef.current?.select(), 30);
    }
  }, [request]);

  const close = (answer: boolean): void => {
    if (request === null) return;
    if (request.kind === "confirm") request.resolve(answer);
    else request.resolve(answer && text.trim() !== "" ? text.trim() : null);
    publish(null);
  };

  return (
    <AlertDialog open={request !== null} onOpenChange={(open) => !open && close(false)}>
      <AlertDialogContent className="max-w-[420px] rounded-card border-border bg-card">
        <AlertDialogTitle className="text-[18px] font-semibold tracking-tight text-foreground">{request?.title ?? ""}</AlertDialogTitle>
        {request?.body !== undefined ? (
          <AlertDialogDescription className="text-[13.5px] leading-6 text-muted-foreground">{request.body}</AlertDialogDescription>
        ) : (
          <AlertDialogDescription className="sr-only">{request?.title ?? ""}</AlertDialogDescription>
        )}
        {request?.kind === "text" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              close(true);
            }}
          >
            <input
              ref={inputRef}
              value={text}
              maxLength={request.maxLength}
              onChange={(event) => setText(event.target.value)}
              aria-label={request.title}
              placeholder={request.placeholder}
              className="h-11 w-full rounded-[10px] border border-input bg-background px-3 text-[16px] md:text-[15px] outline-none focus:border-personal"
            />
          </form>
        ) : null}
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="press h-11 whitespace-nowrap rounded-[10px]">
            {request?.cancelLabel ?? "Huỷ"}
          </AlertDialogCancel>
          <button
            type="button"
            disabled={request?.kind === "text" && text.trim() === ""}
            onClick={() => close(true)}
            className={cn(
              "press flex h-11 items-center justify-center whitespace-nowrap rounded-[10px] px-5 text-[14px] font-semibold transition-colors disabled:opacity-50",
              request?.kind === "confirm" && request.danger
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-personal text-personal-foreground hover:bg-personal/90",
            )}
          >
            {request?.confirmLabel ?? "Đồng ý"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
