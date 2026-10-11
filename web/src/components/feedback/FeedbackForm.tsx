import { ImagePlus, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  FEEDBACK_KINDS,
  FEEDBACK_MAX_CHARS,
  feedbackShotRejection,
  type FeedbackDraft,
  type FeedbackKind,
} from "@/lib/feedback";
import { cn } from "@/lib/utils";

type Props = {
  /** `app`: may carry one screenshot. `web` (`/gop-y`): an optional email instead, and the bot trap. */
  variant: "app" | "web";
  onSubmit: (draft: FeedbackDraft & { email: string; trap: string }) => Promise<void>;
  className?: string;
};

/**
 * The one feedback sheet — Lỗi · Ý tưởng · Khó dùng, one text field (≤ 2.000), and in the app
 * one optional screenshot. A note to the sender says what is attached on its own, so nobody wonders
 * whether their messages went too. Enter adds a line; only the button sends.
 */
export function FeedbackForm({ variant, onSubmit, className }: Props) {
  const [kind, setKind] = useState<FeedbackKind>("loi");
  const [body, setBody] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [trap, setTrap] = useState<string>("");
  const [shot, setShot] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const preview = useMemo<string | null>(() => (shot !== null ? URL.createObjectURL(shot) : null), [shot]);

  useEffect(() => () => {
    if (preview !== null) URL.revokeObjectURL(preview);
  }, [preview]);

  const left = FEEDBACK_MAX_CHARS - body.length;
  const canSend = body.trim().length > 0 && left >= 0 && !isSending;

  const pick = (file: File | undefined): void => {
    if (file === undefined) return;
    const reason = feedbackShotRejection(file);
    if (reason !== null) {
      setError(reason);
      return;
    }
    setError(null);
    setShot(file);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSend) return;
    setIsSending(true);
    setError(null);
    try {
      await onSubmit({ kind, body, shot: variant === "app" ? shot : null, email, trap });
      setBody("");
      setShot(null);
      setEmail("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className={cn("space-y-s-4", className)} data-feedback-form={variant}>
      <div role="radiogroup" aria-label="Loại góp ý" className="flex gap-2">
        {FEEDBACK_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={kind === k.id}
            data-feedback-kind={k.id}
            onClick={() => setKind(k.id)}
            className={cn(
              "press h-11 flex-1 rounded-control border text-[15px] font-medium transition-colors",
              kind === k.id ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-secondary",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div>
        <label htmlFor={`feedback-body-${variant}`} className="sr-only">
          Nội dung góp ý
        </label>
        <textarea
          id={`feedback-body-${variant}`}
          data-feedback-body=""
          value={body}
          onChange={(event) => setBody(event.target.value.slice(0, FEEDBACK_MAX_CHARS + 50))}
          rows={6}
          placeholder={kind === "loi" ? "Bạn đang làm gì thì gặp lỗi? Mong đợi điều gì?" : kind === "y_tuong" ? "Điều gì sẽ giúp bạn hơn?" : "Chỗ nào làm bạn khựng lại?"}
          className="block w-full resize-y rounded-card border border-border bg-card px-4 py-3 text-[16px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/70 md:text-[15px]"
        />
        <p className={cn("mt-1 text-right text-[12px] tabular-nums", left < 0 ? "text-destructive" : "text-muted-foreground")} data-feedback-left="">
          {left < 0 ? `Dài hơn ${-left} ký tự` : `Còn ${left.toLocaleString("vi-VN")} ký tự`}
        </p>
      </div>

      {variant === "app" ? (
        <div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" data-feedback-file="" onChange={(event) => { pick(event.target.files?.[0]); event.target.value = ""; }} />
          {shot !== null && preview !== null ? (
            <div className="flex items-center gap-3 rounded-card border border-border bg-card p-2" data-feedback-shot="">
              <img src={preview} alt="Ảnh màn hình đính kèm" className="h-16 w-16 rounded-lg object-cover" />
              <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{shot.name}</span>
              <button type="button" onClick={() => setShot(null)} aria-label="Bỏ ảnh" className="icon-btn h-11 w-11 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} className="press inline-flex min-h-11 items-center gap-2 rounded-control border border-dashed border-border px-4 text-[14.5px] text-muted-foreground hover:text-foreground">
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              Đính kèm một ảnh màn hình
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="feedback-email" className="block text-[14px] font-medium text-foreground">
            Email <span className="font-normal text-muted-foreground">(không bắt buộc — để chúng tôi hỏi lại)</span>
          </label>
          <input
            id="feedback-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-12 w-full rounded-control border border-border bg-card px-4 text-[16px] text-foreground outline-none focus:border-primary/70 md:text-[15px]"
          />
          {/* A field no person sees or reaches; a form-filling bot fills it and is dropped. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
            <label htmlFor="feedback-website">Website</label>
            <input id="feedback-website" name="website" tabIndex={-1} autoComplete="off" value={trap} onChange={(event) => setTrap(event.target.value)} data-feedback-trap="" />
          </div>
        </div>
      )}

      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Gửi kèm tự động: phiên bản app, loại máy / trình duyệt, khổ màn hình, trang đang mở và ngôn ngữ. Không bao giờ kèm tin nhắn hay dữ liệu của bạn.
      </p>

      {error !== null ? (
        <p role="alert" className="text-[14px] text-destructive" data-feedback-error="">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canSend}
        data-feedback-send=""
        className="press inline-flex h-12 w-full items-center justify-center gap-2 rounded-control bg-primary text-[15.5px] font-semibold text-primary-foreground disabled:opacity-50 md:w-auto md:px-8"
      >
        {isSending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Gửi góp ý
      </button>
    </form>
  );
}
